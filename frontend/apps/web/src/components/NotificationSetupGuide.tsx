/**
 * Notification Setup Guide Component
 * Step-by-step modal to guide users through notification permission setup
 * Constitution v5.4.0 compliant - includes data-testid for accessibility testing
 */

'use client';

import { useState } from 'react';
import {
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Button,
	Stepper,
	Step,
	StepLabel,
	StepContent,
	Typography,
	Box,
	Alert,
} from '@mui/material';
import { showTestNotification } from 'apis';

interface NotificationSetupGuideProps {
	open: boolean;
	onClose: () => void;
}

export function NotificationSetupGuide({ open, onClose }: NotificationSetupGuideProps) {
	const [activeStep, setActiveStep] = useState(0);
	const [testResult, setTestResult] = useState<'pending' | 'success' | 'failed'>('pending');

	const isMacOS = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
	const isWindows = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('WIN') >= 0;

	const handleNext = () => {
		setActiveStep((prevActiveStep) => prevActiveStep + 1);
	};

	const handleBack = () => {
		setActiveStep((prevActiveStep) => prevActiveStep - 1);
	};

	const handleReset = () => {
		setActiveStep(0);
		setTestResult('pending');
	};

	const handleTestNotification = async () => {
		const shown = await showTestNotification();
		if (shown) {
			setTestResult('success');
			setTimeout(() => {
				const userSawIt = confirm('Did you see the test notification?\n\nClick OK if yes, Cancel if no.');
				if (userSawIt) {
					setTestResult('success');
				} else {
					setTestResult('failed');
				}
			}, 2000);
		} else {
			setTestResult('failed');
		}
	};

	const handleClose = () => {
		handleReset();
		onClose();
	};

	const steps = [
		{
			label: 'Check Browser Settings',
			content: (
				<Box>
					<Typography variant="body2" sx={{ mb: 2 }}>
						First, check Chrome&apos;s notification settings for this site:
					</Typography>

					<Typography variant="body2" component="div" sx={{ mb: 2 }}>
						<strong>Steps:</strong>
						<ol>
							<li>Click the lock icon 🔒 (or info icon ℹ️) in the address bar (left of the URL)</li>
							<li>Click &quot;Site settings&quot; or &quot;Permissions&quot;</li>
							<li>Find &quot;Notifications&quot; in the list</li>
							<li>Change setting to &quot;Allow&quot;</li>
							<li>Refresh this page</li>
						</ol>
					</Typography>

					<Alert severity="info" sx={{ mt: 2 }}>
						<Typography variant="caption">
							<strong>Alternative:</strong> You can also access this at{' '}
							<code>chrome://settings/content/notifications</code>
						</Typography>
					</Alert>
				</Box>
			),
		},
		{
			label: 'Check System Settings',
			content: (
				<Box>
					{isMacOS && (
						<>
							<Typography variant="body2" sx={{ mb: 2 }}>
								On macOS, you also need to enable notifications at the system level:
							</Typography>

							<Typography variant="body2" component="div" sx={{ mb: 2 }}>
								<strong>Steps for macOS:</strong>
								<ol>
									<li>Open System Settings (click  menu → System Settings)</li>
									<li>Click &quot;Notifications&quot;</li>
									<li>Scroll down and find &quot;Google Chrome&quot; in the app list</li>
									<li>Enable &quot;Allow notifications from Google Chrome&quot;</li>
									<li>
										Make sure the following are enabled:
										<ul>
											<li>✅ Allow notifications</li>
											<li>✅ Show in Notification Center</li>
											<li>✅ Show on lock screen (optional)</li>
											<li>✅ Badge app icon (optional)</li>
											<li>✅ Play sound for notifications (optional)</li>
										</ul>
									</li>
								</ol>
							</Typography>
						</>
					)}

					{isWindows && (
						<>
							<Typography variant="body2" sx={{ mb: 2 }}>
								On Windows, you also need to enable notifications at the system level:
							</Typography>

							<Typography variant="body2" component="div" sx={{ mb: 2 }}>
								<strong>Steps for Windows:</strong>
								<ol>
									<li>Open Settings (Win + I)</li>
									<li>Go to System → Notifications</li>
									<li>Make sure &quot;Notifications&quot; is turned ON at the top</li>
									<li>Scroll down and find &quot;Google Chrome&quot; in the app list</li>
									<li>Click on &quot;Google Chrome&quot; and enable notifications</li>
									<li>
										Make sure the following are enabled:
										<ul>
											<li>✅ Notifications</li>
											<li>✅ Show notification banners</li>
											<li>✅ Show notifications in notification center</li>
											<li>✅ Play a sound when notification arrives (optional)</li>
										</ul>
									</li>
								</ol>
							</Typography>
						</>
					)}

					{!isMacOS && !isWindows && (
						<Typography variant="body2" sx={{ mb: 2 }}>
							Check your operating system&apos;s notification settings and ensure Chrome has permission to show
							notifications.
						</Typography>
					)}
				</Box>
			),
		},
		{
			label: 'Test Notifications',
			content: (
				<Box>
					<Typography variant="body2" sx={{ mb: 2 }}>
						Now let&apos;s test if notifications are working:
					</Typography>

					<Button
						variant="contained"
						onClick={handleTestNotification}
						data-testid="notification-setup-guide-test-btn"
						sx={{ mb: 2 }}
					>
						Send Test Notification
					</Button>

					{testResult === 'success' && (
						<Alert severity="success" sx={{ mt: 2 }}>
							<Typography variant="body2">
								<strong>Success!</strong> Notifications are working correctly. You can close this guide.
							</Typography>
						</Alert>
					)}

					{testResult === 'failed' && (
						<Alert severity="error" sx={{ mt: 2 }}>
							<Typography variant="body2">
								<strong>Test failed.</strong> Please go back and check the previous steps again. Make sure:
								<ul>
									<li>Browser notifications are allowed</li>
									<li>System notifications are enabled for Chrome</li>
									<li>Do Not Disturb mode is OFF</li>
									<li>You&apos;ve refreshed the page after changing settings</li>
								</ul>
							</Typography>
						</Alert>
					)}
				</Box>
			),
		},
	];

	return (
		<Dialog
			open={open}
			onClose={handleClose}
			maxWidth="md"
			fullWidth
			data-testid="notification-setup-guide-dialog"
		>
			<DialogTitle>Notification Setup Guide</DialogTitle>

			<DialogContent>
				<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
					Follow these steps to enable notifications for Tech Office:
				</Typography>

				<Stepper activeStep={activeStep} orientation="vertical">
					{steps.map((step, index) => (
						<Step key={step.label}>
							<StepLabel>{step.label}</StepLabel>
							<StepContent>
								{step.content}

								<Box sx={{ mt: 2 }}>
									{index < steps.length - 1 && (
										<Button
											variant="contained"
											onClick={handleNext}
											data-testid={`notification-setup-guide-next-step-${index}`}
										>
											Next
										</Button>
									)}
									{index > 0 && (
										<Button onClick={handleBack} sx={{ ml: 1 }} data-testid="notification-setup-guide-back-btn">
											Back
										</Button>
									)}
								</Box>
							</StepContent>
						</Step>
					))}
				</Stepper>

				{activeStep === steps.length && testResult === 'success' && (
					<Alert severity="success" sx={{ mt: 2 }}>
						<Typography variant="body2">
							All steps completed! Notifications are now enabled for Tech Office.
						</Typography>
					</Alert>
				)}
			</DialogContent>

			<DialogActions>
				{activeStep === steps.length && testResult === 'success' ? (
					<Button onClick={handleClose} color="primary" data-testid="notification-setup-guide-close-btn">
						Close
					</Button>
				) : (
					<>
						{activeStep === steps.length && (
							<Button onClick={handleReset} data-testid="notification-setup-guide-reset-btn">
								Reset
							</Button>
						)}
						<Button onClick={handleClose} color="inherit" data-testid="notification-setup-guide-cancel-btn">
							Cancel
						</Button>
					</>
				)}
			</DialogActions>
		</Dialog>
	);
}
