'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { Box, Container, Typography, Paper, Divider, TextField, Button, Alert, CircularProgress, Link as MuiLink } from '@mui/material';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { OrgSelector } from './components/OrgSelector';
import { PinInputBoxes } from './components/PinInputBoxes';
import { login as apiLogin, loginWithPIN, AccountLockedError, setAuthToken, exchangeToken } from 'apis';
import { useAuthContext } from '@/lib/auth/AuthProvider';
import type { Organization, SSOProviderType } from 'apis';

// ---------------------------------------------------------------------------
// Apple Sign-In JS SDK types (loaded via <Script>)
// ---------------------------------------------------------------------------
declare global {
	interface Window {
		AppleID?: {
			auth: {
				init(config: {
					clientId: string;
					scope: string;
					redirectURI: string;
					usePopup: boolean;
				}): void;
				signIn(): Promise<{
					authorization: { code: string; id_token: string; state?: string };
					user?: { email: string; name?: { firstName?: string; lastName?: string } };
				}>;
			};
		};
	}
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const APPLE_CLIENT_ID = process.env.NEXT_PUBLIC_APPLE_CLIENT_ID ?? '';
const PUBLIC_BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
const SSO_BUTTON_MAX_WIDTH = 400;

/**
 * Detect whether the identifier looks like an email address.
 * Simple heuristic: contains '@' with text on both sides.
 */
function isEmailLike(value: string): boolean {
	return /^[^@\s]+@[^@\s]+$/.test(value.trim());
}

type LoginMode = 'undecided' | 'email' | 'pin';

function LoginContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { isAuthenticated, refreshProfile } = useAuthContext();

	const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
	const [identifier, setIdentifier] = useState('');
	const [password, setPassword] = useState('');
	const [pin, setPin] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');
	const [appleSDKReady, setAppleSDKReady] = useState(false);
	const [lockoutInfo, setLockoutInfo] = useState<{
		until: Date | null;
		adminRequired: boolean;
		tier: number;
	} | null>(null);

	const redirect = searchParams.get('redirect') || '/workspace';

	// Derive login mode from the identifier value
	const loginMode: LoginMode = identifier.trim() === ''
		? 'undecided'
		: isEmailLike(identifier)
			? 'email'
			: 'pin';

	// If already authenticated, redirect
	useEffect(() => {
		if (isAuthenticated) {
			router.replace(redirect);
		}
	}, [isAuthenticated, router, redirect]);

	// Lockout countdown timer
	useEffect(() => {
		if (!lockoutInfo?.until) return;
		const timer = setInterval(() => {
			if (lockoutInfo.until && lockoutInfo.until <= new Date()) {
				setLockoutInfo(null);
				setError('');
			}
		}, 1000);
		return () => clearInterval(timer);
	}, [lockoutInfo]);

	const handleOrgChange = (_orgId: string, organization: Organization) => {
		setSelectedOrg(organization);
	};

	const handleEmailLogin = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!identifier || !password) {
			setError('Please enter your email and password');
			return;
		}

		setIsLoading(true);
		setError('');

		try {
			await apiLogin(identifier.trim(), password, selectedOrg?.id);
			await refreshProfile();
			router.push(redirect);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Login failed');
			setIsLoading(false);
		}
	};

	const handlePINLogin = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!identifier.trim()) {
			setError('Please enter your account ID');
			return;
		}
		if (pin.length !== 6) {
			setError('Please enter your 6-digit PIN');
			return;
		}
		if (!selectedOrg) {
			setError('Please select your organization first');
			return;
		}

		setIsLoading(true);
		setError('');
		setLockoutInfo(null);

		try {
			const result = await loginWithPIN(selectedOrg.subdomain, identifier.trim(), pin);

			if (result.pinChangeRequired) {
				router.push(
					`/login/pin/set-pin?token=${encodeURIComponent(result.pinChangeToken)}`
				);
				return;
			}

			setAuthToken(result.accessToken, Number(result.expiresAt));
			await refreshProfile();
			router.push(redirect);
		} catch (err) {
			if (err instanceof AccountLockedError) {
				const detail = err.detail;
				setLockoutInfo({
					until: detail.lockoutUntilUnix > BigInt(0)
						? new Date(Number(detail.lockoutUntilUnix) * 1000)
						: null,
					adminRequired: detail.adminResetRequired,
					tier: detail.lockoutTier,
				});
				setError(err.message);
			} else {
				setError(err instanceof Error ? err.message : 'Login failed');
			}
			setPin('');
		} finally {
			setIsLoading(false);
		}
	};

	const completeSSOSignIn = async (provider: SSOProviderType, idToken: string) => {
		setIsLoading(true);
		setError('');
		try {
			await exchangeToken(provider, idToken);
			await refreshProfile();
			router.push(redirect);
		} catch (err) {
			setError(err instanceof Error ? err.message : `${provider} sign-in failed`);
			setIsLoading(false);
		}
	};

	const handleAppleLogin = async () => {
		if (!window.AppleID) return;
		try {
			const credential = await window.AppleID.auth.signIn();
			await completeSSOSignIn('apple', credential.authorization.id_token);
		} catch (err: unknown) {
			const appleErr = err as { error?: string };
			if (appleErr?.error === 'popup_closed_by_user') return;
			setError(err instanceof Error ? err.message : 'Apple sign-in failed');
		}
	};

	const handleAppleSDKLoad = () => {
		if (!APPLE_CLIENT_ID || !window.AppleID) return;
		const redirectURI = PUBLIC_BASE_URL
			? `${PUBLIC_BASE_URL}/signin`
			: `${window.location.origin}/signin`;
		window.AppleID.auth.init({
			clientId: APPLE_CLIENT_ID,
			scope: 'name email',
			redirectURI,
			usePopup: true,
		});
		setAppleSDKReady(true);
	};

	const formatCountdown = (until: Date): string => {
		const diff = Math.max(0, Math.floor((until.getTime() - Date.now()) / 1000));
		const min = Math.floor(diff / 60);
		const sec = diff % 60;
		return `${min}:${sec.toString().padStart(2, '0')}`;
	};

	return (
		<Container maxWidth="sm">
			<Box
				sx={{
					minHeight: '100vh',
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					py: 4,
				}}
			>
				<Box sx={{ mb: 4, textAlign: 'center' }}>
					<Typography variant="h3" component="h1" gutterBottom fontWeight="bold">
						Tech Office
					</Typography>
					<Typography variant="subtitle1" color="text.secondary">
						Sign in to your workspace
					</Typography>
				</Box>

				<Paper elevation={0} sx={{ p: 4 }}>
					{/* Organization Selection */}
					<Box sx={{ mb: 3 }}>
						<Typography variant="h6" gutterBottom>
							Organization
						</Typography>
						<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
							Enter your organization&apos;s subdomain
						</Typography>
						<OrgSelector onChange={handleOrgChange} />
					</Box>

					<Divider sx={{ my: 3 }} />

					{/* Unified identifier field */}
					<Box component="form" onSubmit={loginMode === 'pin' ? handlePINLogin : handleEmailLogin}>
						<Typography variant="h6" gutterBottom>
							Sign In
						</Typography>

						<TextField
							fullWidth
							label="Email or Account ID"
							type="text"
							value={identifier}
							onChange={(e) => {
								setIdentifier(e.target.value);
								setError('');
								setLockoutInfo(null);
								// Clear password/PIN when switching modes
								if (isEmailLike(e.target.value)) {
									setPin('');
								} else {
									setPassword('');
								}
							}}
							disabled={isLoading}
							sx={{ mb: 2 }}
							autoComplete="username"
							helperText={
								loginMode === 'undecided'
									? 'Enter your email address or account ID assigned by your admin'
									: loginMode === 'email'
										? 'Email detected — enter your password below'
										: 'Account ID detected — enter your 6-digit PIN below'
							}
							inputProps={{ 'data-testid': 'identifier-input' }}
						/>

						{/* Email mode: password field + SSO */}
						{loginMode === 'email' && (
							<>
								<TextField
									fullWidth
									label="Password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									disabled={isLoading}
									sx={{ mb: 1 }}
									autoComplete="current-password"
									inputProps={{ 'data-testid': 'password-input' }}
								/>

								<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
									If your account was invited by email, use that same email here. Google or Apple sign-in with the same email will attach to this account when SSO is enabled.
								</Typography>

								<Box sx={{ textAlign: 'right', mb: 2 }}>
									<MuiLink href="/forgot-password" variant="caption" underline="hover" data-testid="forgot-password-link">
										Forgot password?
									</MuiLink>
								</Box>
							</>
						)}

						{/* PIN mode: 6 individual PIN boxes */}
						{loginMode === 'pin' && (
							<Box sx={{ mb: 2 }}>
								<Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, textAlign: 'center' }}>
									Enter your 6-digit PIN
								</Typography>
								<PinInputBoxes
									value={pin}
									onChange={setPin}
									disabled={isLoading || !!lockoutInfo}
								/>

								{/* Lockout timer */}
								{lockoutInfo && !lockoutInfo.adminRequired && lockoutInfo.until && (
									<Alert severity="warning" sx={{ mt: 2 }} data-testid="pin-lockout-timer">
										Account locked. Try again in {formatCountdown(lockoutInfo.until)}
									</Alert>
								)}

								{/* Admin-required lockout */}
								{lockoutInfo?.adminRequired && (
									<Alert severity="error" sx={{ mt: 2 }} data-testid="pin-lockout-admin">
										Account is permanently locked. Please contact your administrator to unlock your account.
									</Alert>
								)}
							</Box>
						)}

						<Button
							fullWidth
							type="submit"
							variant="contained"
							size="large"
							disabled={isLoading || !!lockoutInfo || loginMode === 'undecided'}
							sx={{ py: 1.5, mb: 2 }}
							data-testid="login-button"
						>
							{isLoading ? <CircularProgress size={24} color="inherit" /> : 'Sign In'}
						</Button>

						{error && !lockoutInfo && (
							<Alert severity="error" sx={{ mb: 2 }} data-testid="login-error">
								{error}
							</Alert>
						)}
					</Box>

					{/* SSO options — only show for email mode or undecided, and only when at least one provider is configured */}
					{loginMode !== 'pin' && (GOOGLE_CLIENT_ID || APPLE_CLIENT_ID) && (
						<>
							<Divider sx={{ my: 2 }}>
								<Typography variant="caption" color="text.secondary">
									OR
								</Typography>
							</Divider>

							<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'stretch' }}>
								{/* Google Sign-In — uses Google Identity Services, renders Google’s branded button */}
								{GOOGLE_CLIENT_ID && (
									<Box
										data-testid="sso-google"
										sx={{
											display: 'flex',
											justifyContent: 'center',
											width: '100%',
											maxWidth: SSO_BUTTON_MAX_WIDTH,
											mx: 'auto',
											opacity: isLoading ? 0.5 : 1,
											pointerEvents: isLoading ? 'none' : 'auto',
										}}
									>
										<GoogleLogin
											onSuccess={(credentialResponse) => {
												if (credentialResponse.credential) {
													void completeSSOSignIn('google', credentialResponse.credential);
												}
											}}
											onError={() => setError('Google sign-in failed. Please try again.')}
											theme="outline"
											size="large"
											shape="rectangular"
											width={String(SSO_BUTTON_MAX_WIDTH)}
											text="signin_with"
										/>
									</Box>
								)}

								{/* Apple Sign-In — uses Apple’s JS SDK loaded via Script */}
								{APPLE_CLIENT_ID && (
									<>
										<Script
											src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"
											strategy="lazyOnload"
											onLoad={handleAppleSDKLoad}
										/>
										<Box sx={{ width: '100%', maxWidth: SSO_BUTTON_MAX_WIDTH, mx: 'auto' }}>
											<Button
												fullWidth
												variant="outlined"
												size="large"
												onClick={() => void handleAppleLogin()}
												disabled={isLoading || !appleSDKReady}
												sx={{ minHeight: 40, textTransform: 'none' }}
												data-testid="sso-apple"
											>
												Sign in with Apple
											</Button>
										</Box>
									</>
								)}
							</Box>
						</>
					)}
				</Paper>

				<Box sx={{ mt: 4, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 1 }}>
					<Typography variant="caption" color="text.secondary">
						New organization?{' '}
						<MuiLink href="/signup" underline="hover">
							Register your organization
						</MuiLink>
					</Typography>
					<Typography variant="caption" color="text.secondary">
						Received an email invitation?{' '}
						<MuiLink href="/accept-invitation" underline="hover">
							Accept invitation
						</MuiLink>
					</Typography>
				</Box>
			</Box>
		</Container>
	);
}

export default function LoginPage() {
	return (
		<GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
			<Suspense fallback={
				<Container maxWidth="sm">
					<Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
						<CircularProgress />
					</Box>
				</Container>
			}>
				<LoginContent />
			</Suspense>
		</GoogleOAuthProvider>
	);
}
