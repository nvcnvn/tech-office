/**
 * Employee Detail Dialog
 * Shows full employee details, current roles (with assign/revoke), and PIN reset for org-managed accounts.
 */

'use client';

import { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { useThemeColors } from '@/theme/useThemeColors';
import {
	listEmployeeRoles,
	listRoles,
	assignRole,
	revokeRole,
	resetOrgAccountCredential,
	type IAMOrgRole,
	type EmployeeListItem,
} from 'apis';

interface EmployeeDetailDialogProps {
	employee: EmployeeListItem;
	hasAdminAccess: boolean;
	onClose: () => void;
	onRolesChanged: () => void;
}

export default function EmployeeDetailDialog({
	employee,
	hasAdminAccess,
	onClose,
	onRolesChanged,
}: EmployeeDetailDialogProps) {
	const colors = useThemeColors();

	// Roles state
	const [employeeRoles, setEmployeeRoles] = useState<IAMOrgRole[]>([]);
	const [allRoles, setAllRoles] = useState<IAMOrgRole[]>([]);
	const [rolesLoading, setRolesLoading] = useState(true);

	// Assign role state
	const [showAssignRole, setShowAssignRole] = useState(false);
	const [roleSearch, setRoleSearch] = useState('');
	const deferredRoleSearch = useDeferredValue(roleSearch);
	const [assigningRoleId, setAssigningRoleId] = useState<string | null>(null);

	// Revoke role state
	const [revokingRoleId, setRevokingRoleId] = useState<string | null>(null);

	// PIN reset state
	const [resettingPin, setResettingPin] = useState(false);
	const [resetPinResult, setResetPinResult] = useState<string | null>(null);
	const [pinCopied, setPinCopied] = useState(false);

	// Error state
	const [error, setError] = useState<string | null>(null);

	// Load roles on mount
	useEffect(() => {
		const load = async () => {
			setRolesLoading(true);
			try {
				const [empRoles, orgRoles] = await Promise.all([
					listEmployeeRoles(employee.id),
					hasAdminAccess ? listRoles() : Promise.resolve([]),
				]);
				setEmployeeRoles(empRoles);
				setAllRoles(orgRoles);
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Failed to load roles');
			} finally {
				setRolesLoading(false);
			}
		};
		load();
	}, [employee.id, hasAdminAccess]);

	// Available roles (not yet assigned)
	const availableRoles = useMemo(() => {
		const assignedIds = new Set(employeeRoles.map((r) => r.id));
		return allRoles.filter((r) => !assignedIds.has(r.id));
	}, [allRoles, employeeRoles]);

	// Filtered available roles
	const filteredAvailableRoles = useMemo(() => {
		const q = deferredRoleSearch.trim().toLowerCase();
		if (!q) return availableRoles;
		return availableRoles.filter(
			(r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
		);
	}, [deferredRoleSearch, availableRoles]);

	const handleAssignRole = async (roleId: string) => {
		setAssigningRoleId(roleId);
		setError(null);
		try {
			await assignRole(employee.id, roleId);
			// Refresh employee roles
			const updatedRoles = await listEmployeeRoles(employee.id);
			setEmployeeRoles(updatedRoles);
			onRolesChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to assign role');
		} finally {
			setAssigningRoleId(null);
		}
	};

	const handleRevokeRole = async (roleId: string) => {
		setRevokingRoleId(roleId);
		setError(null);
		try {
			await revokeRole(employee.id, roleId);
			const updatedRoles = await listEmployeeRoles(employee.id);
			setEmployeeRoles(updatedRoles);
			onRolesChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to revoke role');
		} finally {
			setRevokingRoleId(null);
		}
	};

	const handleResetPin = async () => {
		setResettingPin(true);
		setError(null);
		setResetPinResult(null);
		try {
			const result = await resetOrgAccountCredential(employee.id);
			setResetPinResult(result.temporaryPin);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to reset PIN');
		} finally {
			setResettingPin(false);
		}
	};

	const handleCopyPin = async () => {
		if (resetPinResult) {
			await navigator.clipboard.writeText(resetPinResult);
			setPinCopied(true);
			setTimeout(() => setPinCopied(false), 2000);
		}
	};

	const employeeName = `${employee.givenName} ${employee.familyName}`.trim() || employee.email || 'Unknown';

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			data-testid="employee-detail-dialog"
		>
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/50"
				onClick={onClose}
			/>

			{/* Dialog */}
			<div
				className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl border mx-4"
				style={{ ...colors.bg.paper.style, ...colors.border.default.style }}
			>
				{/* Header */}
				<div
					className="flex items-center justify-between px-6 py-4 border-b"
					style={colors.border.default.style}
				>
					<div>
						<h2
							className="text-lg font-semibold"
							style={colors.text.primary.style}
							data-testid="employee-detail-name"
						>
							{employeeName}
						</h2>
						<p className="text-sm" style={colors.text.secondary.style}>
							{employee.isOrgManaged ? 'Managed Account (PIN)' : 'Email Account'}
							{' · '}
							{employee.isActive ? 'Active' : 'Inactive'}
						</p>
					</div>
					<button
						onClick={onClose}
						className="p-2 rounded-lg hover:opacity-80"
						style={colors.text.secondary.style}
						data-testid="employee-detail-close"
					>
						✕
					</button>
				</div>

				{/* Content */}
				<div className="px-6 py-4 space-y-6">
					{/* Error banner */}
					{error && (
						<div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
							{error}
						</div>
					)}

					{/* Employee Info */}
					<section>
						<h3
							className="text-sm font-semibold mb-3"
							style={colors.text.primary.style}
						>
							Details
						</h3>
						<div className="grid grid-cols-2 gap-3 text-sm">
							<div>
								<span style={colors.text.secondary.style}>Name</span>
								<p style={colors.text.primary.style}>
									{employee.givenName} {employee.familyName}
								</p>
							</div>
							<div>
								<span style={colors.text.secondary.style}>Email</span>
								<p style={colors.text.primary.style}>{employee.email || '—'}</p>
							</div>
							{employee.loginIdentifier && (
								<div>
									<span style={colors.text.secondary.style}>Login ID</span>
									<p style={colors.text.primary.style}>{employee.loginIdentifier}</p>
								</div>
							)}
							{employee.userAccountEmail && employee.userAccountEmail !== employee.email && (
								<div>
									<span style={colors.text.secondary.style}>Account Email</span>
									<p style={colors.text.primary.style}>{employee.userAccountEmail}</p>
								</div>
							)}
							{employee.hireDate && (
								<div>
									<span style={colors.text.secondary.style}>Hire Date</span>
									<p style={colors.text.primary.style}>{employee.hireDate}</p>
								</div>
							)}
							{employee.phoneNumber && (
								<div>
									<span style={colors.text.secondary.style}>Phone</span>
									<p style={colors.text.primary.style}>{employee.phoneNumber}</p>
								</div>
							)}
							{employee.dateOfBirth && (
								<div>
									<span style={colors.text.secondary.style}>Date of Birth</span>
									<p style={colors.text.primary.style}>{employee.dateOfBirth}</p>
								</div>
							)}
							{employee.homeAddress && (
								<div className="col-span-2">
									<span style={colors.text.secondary.style}>Home Address</span>
									<p style={colors.text.primary.style}>{employee.homeAddress}</p>
								</div>
							)}
						</div>
					</section>

					{/* Roles Section */}
					<section>
						<div className="flex items-center justify-between mb-3">
							<h3
								className="text-sm font-semibold"
								style={colors.text.primary.style}
							>
								Roles
							</h3>
							{hasAdminAccess && !showAssignRole && (
								<button
									onClick={() => setShowAssignRole(true)}
									className={`text-xs px-3 py-1.5 rounded-lg ${colors.button.primary.bg} ${colors.button.primary.text}`}
									data-testid="assign-role-btn"
								>
									+ Assign Role
								</button>
							)}
						</div>

						{rolesLoading ? (
							<div className="flex items-center gap-2 py-3">
								<div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
								<span className="text-sm" style={colors.text.secondary.style}>
									Loading roles...
								</span>
							</div>
						) : employeeRoles.length === 0 ? (
							<p className="text-sm py-2" style={colors.text.secondary.style}>
								No roles assigned
							</p>
						) : (
							<div className="space-y-2">
								{employeeRoles.map((role) => (
									<div
										key={role.id}
										className="flex items-center justify-between p-2.5 rounded-lg border"
										style={colors.border.default.style}
										data-testid={`role-item-${role.id}`}
									>
										<div>
											<span
												className="text-sm font-medium"
												style={colors.text.primary.style}
											>
												{role.name}
											</span>
											{role.isSystem && (
												<span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
													System
												</span>
											)}
											{role.description && (
												<p
													className="text-xs mt-0.5"
													style={colors.text.secondary.style}
												>
													{role.description}
												</p>
											)}
										</div>
										{hasAdminAccess && !role.isSystem && (
											<button
												onClick={() => handleRevokeRole(role.id)}
												disabled={revokingRoleId === role.id}
												className="text-xs px-2.5 py-1 rounded-lg border text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-50"
												data-testid={`revoke-role-${role.id}`}
											>
												{revokingRoleId === role.id ? 'Removing...' : 'Remove'}
											</button>
										)}
									</div>
								))}
							</div>
						)}

						{/* Assign role panel */}
						{showAssignRole && (
							<div
								className="mt-3 p-3 rounded-lg border"
								style={colors.border.default.style}
							>
								<div className="flex items-center justify-between mb-2">
									<span
										className="text-sm font-medium"
										style={colors.text.primary.style}
									>
										Assign a role
									</span>
									<button
										onClick={() => {
											setShowAssignRole(false);
											setRoleSearch('');
										}}
										className="text-xs"
										style={colors.text.secondary.style}
									>
										Cancel
									</button>
								</div>
								<input
									type="text"
									placeholder="Search roles..."
									value={roleSearch}
									onChange={(e) => setRoleSearch(e.target.value)}
									className={`w-full h-9 px-3 text-sm border rounded-lg mb-2 ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
									data-testid="role-search-input"
								/>
								<div className="max-h-40 overflow-y-auto space-y-1">
									{filteredAvailableRoles.length === 0 ? (
										<p
											className="text-xs py-2 text-center"
											style={colors.text.secondary.style}
										>
											{availableRoles.length === 0
												? 'All roles already assigned'
												: 'No roles match your search'}
										</p>
									) : (
										filteredAvailableRoles.map((role) => (
											<button
												key={role.id}
												onClick={() => handleAssignRole(role.id)}
												disabled={assigningRoleId === role.id}
												className={`w-full text-left p-2 rounded-lg text-sm ${colors.bg.hover} disabled:opacity-50`}
												style={colors.text.primary.style}
												data-testid={`assign-role-option-${role.id}`}
											>
												<span className="font-medium">{role.name}</span>
												{role.description && (
													<span
														className="ml-2 text-xs"
														style={colors.text.secondary.style}
													>
														{role.description}
													</span>
												)}
												{assigningRoleId === role.id && (
													<span className="ml-2 text-xs text-blue-600">
														Assigning...
													</span>
												)}
											</button>
										))
									)}
								</div>
							</div>
						)}
					</section>

					{/* PIN Reset Section — only for org-managed accounts */}
					{employee.isOrgManaged && hasAdminAccess && (
						<section>
							<h3
								className="text-sm font-semibold mb-3"
								style={colors.text.primary.style}
							>
								PIN Management
							</h3>

							{resetPinResult ? (
								<div className="p-3 rounded-lg bg-green-50 border border-green-200">
									<p className="text-sm text-green-800 mb-2">
										New temporary PIN generated. Share this with the employee:
									</p>
									<div className="flex items-center gap-3">
										<code
											className="text-lg font-mono font-bold tracking-widest bg-white px-4 py-2 rounded border border-green-300 text-green-900"
											data-testid="new-temporary-pin"
										>
											{resetPinResult}
										</code>
										<button
											onClick={handleCopyPin}
											className="text-sm px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700"
											data-testid="copy-pin-btn"
										>
											{pinCopied ? 'Copied!' : 'Copy'}
										</button>
									</div>
									<p className="text-xs text-green-700 mt-2">
										This PIN will not be shown again. The employee must change it on next login.
									</p>
								</div>
							) : (
								<div className="flex items-center gap-3">
									<button
										onClick={handleResetPin}
										disabled={resettingPin}
										className="text-sm px-4 py-2 rounded-lg border border-orange-300 text-orange-700 hover:bg-orange-50 disabled:opacity-50"
										data-testid="reset-pin-btn"
									>
										{resettingPin ? 'Resetting...' : 'Reset PIN'}
									</button>
									<span
										className="text-xs"
										style={colors.text.secondary.style}
									>
										Generates a new temporary PIN and invalidates the current one
									</span>
								</div>
							)}
						</section>
					)}
				</div>

				{/* Footer */}
				<div
					className="flex justify-end px-6 py-4 border-t"
					style={colors.border.default.style}
				>
					<button
						onClick={onClose}
						className={`h-9 px-4 text-sm rounded-lg ${colors.button.secondary.bg} ${colors.button.secondary.border} border ${colors.button.secondary.text}`}
						data-testid="employee-detail-done"
					>
						Done
					</button>
				</div>
			</div>
		</div>
	);
}
