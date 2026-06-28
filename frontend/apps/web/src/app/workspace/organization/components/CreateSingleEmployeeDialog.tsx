/**
 * Create Single Employee Dialog
 * Guides admin/owner through creating a single employee account.
 * Two account types:
 *   1. Email / SSO account — for employees who have their own email (self-service sign-in)
 *   2. Managed account — for employees without email/tech access (admin sets a PIN)
 * Also checks for default group, suggests role assignment, and lets admin search custom roles.
 */

'use client';

import { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { useThemeColors } from '@/theme/useThemeColors';
import {
	listRoles,
	assignRole,
	createOrgAccount,
	type IAMOrgRole,
	type CreateOrgAccountRequest,
} from 'apis';
import {
	previewEmployeeImport,
	executeEmployeeImport,
	type EmployeeData,
} from 'apis';

type AccountType = 'email' | 'managed' | null;

interface CreateSingleEmployeeDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess: () => void;
}

type Step = 'choose-type' | 'form' | 'roles' | 'result';

export default function CreateSingleEmployeeDialog({
	isOpen,
	onClose,
	onSuccess,
}: CreateSingleEmployeeDialogProps) {
	const colors = useThemeColors();

	const [step, setStep] = useState<Step>('choose-type');
	const [accountType, setAccountType] = useState<AccountType>(null);

	// Form fields shared
	const [givenName, setGivenName] = useState('');
	const [familyName, setFamilyName] = useState('');

	// Email/SSO fields
	const [email, setEmail] = useState('');

	// Managed account fields
	const [loginIdentifier, setLoginIdentifier] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [dateOfBirth, setDateOfBirth] = useState('');
	const [phoneNumber, setPhoneNumber] = useState('');

	// Role assignment
	const [roles, setRoles] = useState<IAMOrgRole[]>([]);
	const [rolesLoading, setRolesLoading] = useState(false);
	const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
	const [roleSearch, setRoleSearch] = useState('');
	const deferredRoleSearch = useDeferredValue(roleSearch);
	const [showCustomRoles, setShowCustomRoles] = useState(false);

	// Submission state
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Result state
	const [createdId, setCreatedId] = useState('');
	const [temporaryPin, setTemporaryPin] = useState('');
	const [pinCopied, setPinCopied] = useState(false);
	const [roleAssignErrors, setRoleAssignErrors] = useState<string[]>([]);

	// Load roles when moving to role step
	useEffect(() => {
		if (step === 'roles' && roles.length === 0) {
			setRolesLoading(true);
			listRoles()
				.then(setRoles)
				.catch(() => { /* ignore; roles are optional */ })
				.finally(() => setRolesLoading(false));
		}
	}, [step, roles.length]);

	// Auto-select default Employee role
	useEffect(() => {
		if (roles.length > 0 && selectedRoleIds.length === 0) {
			const employeeRole = roles.find(
				(r) => r.isSystem && r.name.toLowerCase() === 'employee',
			);
			if (employeeRole) {
				setSelectedRoleIds([employeeRole.id]);
			}
		}
	}, [roles, selectedRoleIds.length]);

	const defaultGroupRole = useMemo(
		() => roles.find((r) => r.isSystem && r.name.toLowerCase() === 'employee'),
		[roles],
	);

	const systemRoles = useMemo(() => roles.filter((r) => r.isSystem), [roles]);

	const customRoles = useMemo(() => {
		const custom = roles.filter((r) => !r.isSystem);
		if (!deferredRoleSearch.trim()) return custom;
		const q = deferredRoleSearch.trim().toLowerCase();
		return custom.filter(
			(r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
		);
	}, [roles, deferredRoleSearch]);

	const reset = () => {
		setStep('choose-type');
		setAccountType(null);
		setGivenName('');
		setFamilyName('');
		setEmail('');
		setLoginIdentifier('');
		setDisplayName('');
		setDateOfBirth('');
		setPhoneNumber('');
		setRoles([]);
		setSelectedRoleIds([]);
		setRoleSearch('');
		setShowCustomRoles(false);
		setIsSubmitting(false);
		setError(null);
		setCreatedId('');
		setTemporaryPin('');
		setPinCopied(false);
		setRoleAssignErrors([]);
	};

	const handleClose = () => {
		reset();
		onClose();
	};

	const handleChooseType = (type: AccountType) => {
		setAccountType(type);
		setStep('form');
	};

	const canSubmitForm =
		accountType === 'email'
			? email.trim() && givenName.trim() && familyName.trim()
			: loginIdentifier.trim() && givenName.trim() && familyName.trim();

	const handleFormNext = () => {
		setError(null);
		setStep('roles');
	};

	const toggleRole = (roleId: string) => {
		setSelectedRoleIds((ids) =>
			ids.includes(roleId) ? ids.filter((id) => id !== roleId) : [...ids, roleId],
		);
	};

	const handleSubmit = async () => {
		setIsSubmitting(true);
		setError(null);
		setRoleAssignErrors([]);

		try {
			let employeeId = '';

			if (accountType === 'managed') {
				// Create org-managed account
				const result = await createOrgAccount({
					loginIdentifier: loginIdentifier.trim(),
					displayName: displayName.trim() || `${givenName.trim()} ${familyName.trim()}`,
					givenName: givenName.trim(),
					familyName: familyName.trim(),
					dateOfBirth: dateOfBirth || undefined,
					phoneNumber: phoneNumber || undefined,
				});
				employeeId = result.id;
				setCreatedId(result.id);
				setTemporaryPin(result.temporaryPin);
			} else {
				// Email/SSO: use import flow for single employee
				const empData: EmployeeData[] = [{
					email: email.trim(),
					givenName: givenName.trim(),
					familyName: familyName.trim(),
				}];

				const preview = await previewEmployeeImport('', empData);
				if (preview.stats.validCount === 0) {
					setError(
						preview.items?.[0]?.validationErrors?.join(', ')
						|| 'Validation failed for this employee.',
					);
					setIsSubmitting(false);
					return;
				}

				const result = await executeEmployeeImport('', empData);
				if (result.failedCount > 0) {
					setError(
						result.results?.[0]?.errorMessage || 'Failed to create employee.',
					);
					setIsSubmitting(false);
					return;
				}

				employeeId = result.results?.[0]?.identityId ?? '';
				setCreatedId(employeeId);
			}

			// Assign selected roles (skip default employee role if already auto-assigned by backend)
			if (employeeId && selectedRoleIds.length > 0) {
				const errors: string[] = [];
				for (const roleId of selectedRoleIds) {
					try {
						await assignRole(employeeId, roleId);
					} catch (err) {
						const role = roles.find((r) => r.id === roleId);
						errors.push(
							`Failed to assign "${role?.name ?? roleId}": ${err instanceof Error ? err.message : 'Unknown error'}`,
						);
					}
				}
				if (errors.length > 0) setRoleAssignErrors(errors);
			}

			setStep('result');
			onSuccess();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create employee');
		} finally {
			setIsSubmitting(false);
		}
	};

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" data-testid="create-employee-dialog">
			<div
				className="rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
				style={colors.bg.paper.style}
			>
				{/* Header */}
				<div
					className="h-14 px-6 flex items-center justify-between shrink-0"
					style={{ ...colors.border.default.style, borderBottomWidth: '1px' }}
				>
					<h2 className="text-lg font-semibold" style={colors.text.primary.style}>
						{step === 'choose-type' && 'Add Employee'}
						{step === 'form' && (accountType === 'email' ? 'Email / SSO Account' : 'Managed Account')}
						{step === 'roles' && 'Assign Roles'}
						{step === 'result' && 'Employee Created'}
					</h2>
					<button
						onClick={handleClose}
						className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:opacity-70"
						style={colors.text.secondary.style}
						data-testid="create-employee-close"
					>
						✕
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto px-6 py-5">
					{/* Step 1: Choose account type */}
					{step === 'choose-type' && (
						<div className="space-y-4">
							<p className="text-sm" style={colors.text.secondary.style}>
								Choose the right account type based on the employee&apos;s technology access.
							</p>

							{/* Email/SSO card */}
							<button
								onClick={() => handleChooseType('email')}
								className="w-full text-left rounded-xl border p-5 transition-all hover:-translate-y-0.5"
								style={{ ...colors.bg.paper.style, ...colors.border.default.style }}
								data-testid="choose-email-account"
							>
								<div className="flex items-start gap-4">
									<div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-blue-100 text-blue-700 text-lg">
										📧
									</div>
									<div>
										<p className="text-base font-semibold" style={colors.text.primary.style}>
											Email / SSO Account
										</p>
										<p className="mt-1.5 text-sm" style={colors.text.secondary.style}>
											For employees who have their own email address. They sign in using
											email &amp; password or single sign-on (Google, Microsoft, etc.).
										</p>
										<div
											className="mt-3 rounded-lg border px-3 py-2 text-xs"
											style={{ ...colors.border.light.style, ...colors.text.hint.style }}
										>
											<span className="font-medium">Best for:</span> Office staff, managers, or anyone
											with a personal or work email who can manage their own credentials.
										</div>
									</div>
								</div>
							</button>

							{/* Managed account card */}
							<button
								onClick={() => handleChooseType('managed')}
								className="w-full text-left rounded-xl border p-5 transition-all hover:-translate-y-0.5"
								style={{ ...colors.bg.paper.style, ...colors.border.default.style }}
								data-testid="choose-managed-account"
							>
								<div className="flex items-start gap-4">
									<div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-amber-100 text-amber-700 text-lg">
										🔑
									</div>
									<div>
										<p className="text-base font-semibold" style={colors.text.primary.style}>
											Managed Account (PIN Login)
										</p>
										<p className="mt-1.5 text-sm" style={colors.text.secondary.style}>
											For employees without email access. You create a login ID and
											a temporary 6-digit PIN. The employee signs in with their PIN and
											sets a personal one on first login.
										</p>
										<div
											className="mt-3 rounded-lg border px-3 py-2 text-xs"
											style={{ ...colors.border.light.style, ...colors.text.hint.style }}
										>
											<span className="font-medium">Best for:</span> Warehouse workers, factory
											floor staff, field crews, or anyone who doesn&apos;t regularly use email
											or computers.
										</div>
									</div>
								</div>
							</button>
						</div>
					)}

					{/* Step 2: Employee details form */}
					{step === 'form' && (
						<div className="space-y-4">
							{/* Type reminder badge */}
							<div
								className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
									accountType === 'email'
										? 'bg-blue-50 border-blue-200 text-blue-700'
										: 'bg-amber-50 border-amber-200 text-amber-700'
								}`}
							>
								{accountType === 'email' ? '📧 Email / SSO' : '🔑 Managed (PIN)'}
								<button
									onClick={() => { setStep('choose-type'); setAccountType(null); }}
									className="opacity-60 hover:opacity-100"
									data-testid="change-account-type"
								>
									Change
								</button>
							</div>

							{/* Name fields */}
							<div className="grid grid-cols-2 gap-3">
								<label className="block space-y-1.5 text-sm">
									<span className="font-medium" style={colors.text.primary.style}>
										Given Name <span className="text-red-500">*</span>
									</span>
									<input
										type="text"
										value={givenName}
										onChange={(e) => setGivenName(e.target.value)}
										placeholder="Jane"
										className={`h-10 w-full rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
										data-testid="input-given-name"
									/>
								</label>
								<label className="block space-y-1.5 text-sm">
									<span className="font-medium" style={colors.text.primary.style}>
										Family Name <span className="text-red-500">*</span>
									</span>
									<input
										type="text"
										value={familyName}
										onChange={(e) => setFamilyName(e.target.value)}
										placeholder="Doe"
										className={`h-10 w-full rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
										data-testid="input-family-name"
									/>
								</label>
							</div>

							{accountType === 'email' ? (
								<label className="block space-y-1.5 text-sm">
									<span className="font-medium" style={colors.text.primary.style}>
										Email Address <span className="text-red-500">*</span>
									</span>
									<input
										type="email"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										placeholder="jane.doe@company.com"
										className={`h-10 w-full rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
										data-testid="input-email"
									/>
									<p className="text-xs" style={colors.text.hint.style}>
										An invitation will be sent. The employee will set their own password or use SSO.
									</p>
								</label>
							) : (
								<>
									<label className="block space-y-1.5 text-sm">
										<span className="font-medium" style={colors.text.primary.style}>
											Login Identifier <span className="text-red-500">*</span>
										</span>
										<input
											type="text"
											value={loginIdentifier}
											onChange={(e) => setLoginIdentifier(e.target.value)}
											placeholder="e.g., EMP001, badge number, or username"
											className={`h-10 w-full rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
											data-testid="input-login-id"
										/>
										<p className="text-xs" style={colors.text.hint.style}>
											This is what the employee types to log in. Must be unique within your organization.
										</p>
									</label>

									<label className="block space-y-1.5 text-sm">
										<span className="font-medium" style={colors.text.primary.style}>Display Name</span>
										<input
											type="text"
											value={displayName}
											onChange={(e) => setDisplayName(e.target.value)}
											placeholder={givenName || familyName ? `${givenName} ${familyName}`.trim() : 'Auto-generated from name'}
											className={`h-10 w-full rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
											data-testid="input-display-name"
										/>
									</label>

									<div className="grid grid-cols-2 gap-3">
										<label className="block space-y-1.5 text-sm">
											<span className="font-medium" style={colors.text.secondary.style}>
												Date of Birth
											</span>
											<input
												type="date"
												value={dateOfBirth}
												onChange={(e) => setDateOfBirth(e.target.value)}
												className={`h-10 w-full rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
												data-testid="input-dob"
											/>
										</label>
										<label className="block space-y-1.5 text-sm">
											<span className="font-medium" style={colors.text.secondary.style}>
												Phone Number
											</span>
											<input
												type="tel"
												value={phoneNumber}
												onChange={(e) => setPhoneNumber(e.target.value)}
												placeholder="+1 555-123-4567"
												className={`h-10 w-full rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
												data-testid="input-phone"
											/>
										</label>
									</div>

									<div
										className={`rounded-lg border px-4 py-3 text-xs ${colors.status.info.bg} ${colors.status.info.border} ${colors.status.info.text}`}
									>
										<p className="font-medium">How PIN login works</p>
										<p className="mt-1 opacity-80">
											A temporary 6-digit PIN will be generated automatically.
											Share it with the employee — they&apos;ll be asked to set a personal PIN on first login.
										</p>
									</div>
								</>
							)}

							{error && (
								<div className={`rounded-lg border px-4 py-3 text-sm ${colors.status.error.bg} ${colors.status.error.border} ${colors.status.error.text}`}>
									{error}
								</div>
							)}
						</div>
					)}

					{/* Step 3: Role assignment */}
					{step === 'roles' && (
						<div className="space-y-4">
							{/* Default group check */}
							{!rolesLoading && !defaultGroupRole && (
								<div className={`rounded-lg border px-4 py-3 text-sm ${colors.status.warning.bg} ${colors.status.warning.border} ${colors.status.warning.text}`}>
									<p className="font-medium">Default &quot;Employee&quot; role not found</p>
									<p className="mt-1 text-xs opacity-80">
										The system Employee role may have been removed or renamed.
										Please assign at least one role manually so this employee has access.
									</p>
								</div>
							)}

							{defaultGroupRole && (
								<div className={`rounded-lg border px-4 py-3 text-sm ${colors.status.success.bg} ${colors.status.success.border} ${colors.status.success.text}`}>
									<p className="font-medium">Default &quot;Employee&quot; role will be assigned</p>
									<p className="mt-1 text-xs opacity-80">
										This role provides basic access to the workspace. You can add
										additional roles below.
									</p>
								</div>
							)}

							{rolesLoading ? (
								<div className="py-8 text-center text-sm" style={colors.text.secondary.style}>
									Loading available roles...
								</div>
							) : (
								<>
									{/* System roles */}
									<div>
										<p className="text-xs font-semibold uppercase tracking-widest mb-2" style={colors.text.hint.style}>
											System Roles
										</p>
										<div className="space-y-2">
											{systemRoles.map((role) => {
												const checked = selectedRoleIds.includes(role.id);
												return (
													<label
														key={role.id}
														className="flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors"
														style={checked
															? { ...colors.bg.active.style, ...colors.border.primary.style }
															: { ...colors.bg.paper.style, ...colors.border.default.style }}
														data-testid={`role-${role.name.toLowerCase().replace(/\s+/g, '-')}`}
													>
														<input
															type="checkbox"
															checked={checked}
															onChange={() => toggleRole(role.id)}
															className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
														/>
														<div className="flex-1 min-w-0">
															<div className="flex items-center gap-2">
																<p className="text-sm font-medium" style={colors.text.primary.style}>
																	{role.name}
																</p>
																<span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-900">
																	System
																</span>
															</div>
															<p className="mt-0.5 text-xs" style={colors.text.secondary.style}>
																{role.description || 'No description'}
															</p>
														</div>
														<span className="text-xs shrink-0" style={colors.text.hint.style}>
															{role.permissionIds.length} permissions
														</span>
													</label>
												);
											})}
										</div>
									</div>

									{/* Custom roles toggle */}
									<div>
										<button
											onClick={() => setShowCustomRoles(!showCustomRoles)}
											className="flex items-center gap-2 text-sm font-medium transition-colors"
											style={colors.text.secondary.style}
											data-testid="toggle-custom-roles"
										>
											<span>{showCustomRoles ? '▾' : '▸'}</span>
											<span>Custom Roles ({roles.filter((r) => !r.isSystem).length})</span>
										</button>

										{showCustomRoles && (
											<div className="mt-3 space-y-2">
												{roles.filter((r) => !r.isSystem).length > 3 && (
													<input
														type="search"
														value={roleSearch}
														onChange={(e) => setRoleSearch(e.target.value)}
														placeholder="Search custom roles..."
														className={`h-9 w-full rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
														data-testid="search-custom-roles"
													/>
												)}
												{customRoles.length === 0 ? (
													<p className="text-sm py-3 text-center" style={colors.text.hint.style}>
														{roleSearch ? 'No custom roles match your search.' : 'No custom roles created yet.'}
													</p>
												) : (
													customRoles.map((role) => {
														const checked = selectedRoleIds.includes(role.id);
														return (
															<label
																key={role.id}
																className="flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors"
																style={checked
																	? { ...colors.bg.active.style, ...colors.border.primary.style }
																	: { ...colors.bg.paper.style, ...colors.border.default.style }}
																data-testid={`role-custom-${role.id}`}
															>
																<input
																	type="checkbox"
																	checked={checked}
																	onChange={() => toggleRole(role.id)}
																	className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
																/>
																<div className="flex-1 min-w-0">
																	<div className="flex items-center gap-2">
																		<p className="text-sm font-medium" style={colors.text.primary.style}>
																			{role.name}
																		</p>
																		<span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-900">
																			Custom
																		</span>
																	</div>
																	<p className="mt-0.5 text-xs" style={colors.text.secondary.style}>
																		{role.description || 'No description'}
																	</p>
																</div>
																<span className="text-xs shrink-0" style={colors.text.hint.style}>
																	{role.permissionIds.length} permissions
																</span>
															</label>
														);
													})
												)}
											</div>
										)}
									</div>
								</>
							)}

							{error && (
								<div className={`rounded-lg border px-4 py-3 text-sm ${colors.status.error.bg} ${colors.status.error.border} ${colors.status.error.text}`}>
									{error}
								</div>
							)}
						</div>
					)}

					{/* Step 4: Result */}
					{step === 'result' && (
						<div className="space-y-4">
							<div className={`rounded-lg border px-4 py-4 ${colors.status.success.bg} ${colors.status.success.border}`}>
								<p className={`font-semibold ${colors.status.success.text}`}>
									Employee created successfully
								</p>
								<p className="mt-1 text-sm" style={colors.text.secondary.style}>
									{givenName} {familyName}
									{accountType === 'email' ? ` (${email})` : ` (${loginIdentifier})`}
								</p>
							</div>

							{temporaryPin && (
								<div className="rounded-lg border-2 border-amber-300 bg-amber-50 px-5 py-4">
									<p className="font-semibold text-amber-900">Temporary PIN</p>
									<p className="mt-1 text-xs text-amber-700">
										Share this PIN with the employee. They must change it on first login.
									</p>
									<div className="mt-3 flex items-center gap-3">
										<code
											className="text-2xl font-mono font-bold tracking-[0.3em] text-amber-900 select-all"
											data-testid="temporary-pin"
										>
											{temporaryPin}
										</code>
										<button
											onClick={() => {
												navigator.clipboard.writeText(temporaryPin);
												setPinCopied(true);
												setTimeout(() => setPinCopied(false), 2000);
											}}
											className="h-8 px-3 text-xs rounded-lg border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 transition-colors"
											data-testid="copy-pin"
										>
											{pinCopied ? 'Copied!' : 'Copy'}
										</button>
									</div>
								</div>
							)}

							{accountType === 'email' && (
								<div className={`rounded-lg border px-4 py-3 text-sm ${colors.status.info.bg} ${colors.status.info.border} ${colors.status.info.text}`}>
									An invitation email will be sent. The employee can sign in with
									their email and set their own password or use SSO.
								</div>
							)}

							{roleAssignErrors.length > 0 && (
								<div className={`rounded-lg border px-4 py-3 text-sm ${colors.status.warning.bg} ${colors.status.warning.border} ${colors.status.warning.text}`}>
									<p className="font-medium">Some roles could not be assigned:</p>
									<ul className="mt-1 list-disc list-inside text-xs space-y-0.5">
										{roleAssignErrors.map((err, i) => (
											<li key={i}>{err}</li>
										))}
									</ul>
								</div>
							)}
						</div>
					)}
				</div>

				{/* Footer */}
				<div
					className="h-16 px-6 flex items-center justify-between shrink-0"
					style={{ ...colors.border.default.style, borderTopWidth: '1px' }}
				>
					<div>
						{step === 'form' && (
							<button
								onClick={() => { setStep('choose-type'); setAccountType(null); setError(null); }}
								className={`h-9 px-4 border rounded-lg text-sm ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
								data-testid="back-to-type"
							>
								Back
							</button>
						)}
						{step === 'roles' && (
							<button
								onClick={() => { setStep('form'); setError(null); }}
								className={`h-9 px-4 border rounded-lg text-sm ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
								data-testid="back-to-form"
							>
								Back
							</button>
						)}
					</div>

					<div className="flex items-center gap-2">
						{step !== 'result' && (
							<button
								onClick={handleClose}
								className={`h-9 px-4 border rounded-lg text-sm ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
								data-testid="cancel-create-employee"
							>
								Cancel
							</button>
						)}

						{step === 'form' && (
							<button
								onClick={handleFormNext}
								disabled={!canSubmitForm}
								className={`h-9 px-5 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${colors.button.primary.bg} ${colors.button.primary.text}`}
								data-testid="next-to-roles"
							>
								Next: Assign Roles
							</button>
						)}

						{step === 'roles' && (
							<button
								onClick={handleSubmit}
								disabled={isSubmitting}
								className={`h-9 px-5 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${colors.button.primary.bg} ${colors.button.primary.text}`}
								data-testid="submit-create-employee"
							>
								{isSubmitting ? 'Creating...' : 'Create Employee'}
							</button>
						)}

						{step === 'result' && (
							<button
								onClick={handleClose}
								className={`h-9 px-5 rounded-lg text-sm font-medium ${colors.button.primary.bg} ${colors.button.primary.text}`}
								data-testid="done-create-employee"
							>
								Done
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
