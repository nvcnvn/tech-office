/**
 * Permissions Tab
 *
 * List view: two-column — roles left (compact rows), permissions right (small text grouped by domain).
 * Edit / Create views replace the list entirely (breadcrumb header + back button).
 */

'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useRequireAuth } from '@/lib/auth/hooks';
import { useThemeColors } from '@/theme/useThemeColors';
import {
	assignRole,
	createRole,
	deleteRole,
	listEmployees,
	listPermissions,
	listRoles,
	updateRole,
	type EmployeeListItem,
	type IAMOrgRole,
	type IAMPermissionGroup,
} from 'apis';

type Notice = { type: 'success' | 'error'; text: string };

const EMPLOYEE_PAGE_SIZE = 200;

function formatPermLabel(permId: string): string {
	const [, action = permId] = permId.split('.');
	return action
		.replace(/([A-Z])/g, ' $1')
		.replace(/^./, (v) => v.toUpperCase())
		.trim();
}

function formatDomainLabel(domain: string): string {
	return domain.replace(/^./, (v) => v.toUpperCase());
}

function formatEmployeeName(emp: EmployeeListItem): string {
	const name = `${emp.givenName} ${emp.familyName}`.trim();
	return name || emp.email;
}

// ─── Edit Role view ───────────────────────────────────────────────────────────

interface EditRoleViewProps {
	role: IAMOrgRole;
	permissionGroups: IAMPermissionGroup[];
	employees: EmployeeListItem[];
	onBack: () => void;
}

function EditRoleView({ role, permissionGroups, employees, onBack }: EditRoleViewProps) {
	const colors = useThemeColors();

	const [roleName, setRoleName] = useState(role.name);
	const [roleDesc, setRoleDesc] = useState(role.description);
	const [savingInfo, setSavingInfo] = useState(false);

	const [permIds, setPermIds] = useState<string[]>([...role.permissionIds]);
	const [permSearch, setPermSearch] = useState('');
	const [savingPerms, setSavingPerms] = useState(false);

	const [empSearch, setEmpSearch] = useState('');
	const [assigningEmpId, setAssigningEmpId] = useState('');

	const [deletingRole, setDeletingRole] = useState(false);
	const [notice, setNotice] = useState<Notice | null>(null);

	const deferredPermSearch = useDeferredValue(permSearch);
	const deferredEmpSearch = useDeferredValue(empSearch);

	const filteredPermGroups = useMemo(() => {
		const q = deferredPermSearch.trim().toLowerCase();
		if (!q) return permissionGroups;
		return permissionGroups
			.map((g) => ({ ...g, permissions: g.permissions.filter((p) => `${p.id} ${p.description}`.toLowerCase().includes(q)) }))
			.filter((g) => g.permissions.length > 0);
	}, [deferredPermSearch, permissionGroups]);

	const filteredEmployees = useMemo(() => {
		const q = deferredEmpSearch.trim().toLowerCase();
		if (!q) return employees;
		return employees.filter((e) => `${formatEmployeeName(e)} ${e.email}`.toLowerCase().includes(q));
	}, [deferredEmpSearch, employees]);

	const permsDirty = useMemo(
		() => [...role.permissionIds].sort().join(',') !== [...permIds].sort().join(','),
		[role.permissionIds, permIds],
	);
	const infoDirty = roleName !== role.name || roleDesc !== role.description;

	const togglePerm = (permId: string) =>
		setPermIds((prev) => (prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]));

	const handleSaveInfo = async () => {
		setSavingInfo(true);
		setNotice(null);
		try {
			await updateRole(role.id, roleName.trim() || role.name, roleDesc.trim());
			setNotice({ type: 'success', text: 'Role info updated.' });
		} catch (err) {
			setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save.' });
		} finally {
			setSavingInfo(false);
		}
	};

	const handleSavePerms = async () => {
		setSavingPerms(true);
		setNotice(null);
		try {
			await updateRole(role.id, undefined, undefined, permIds);
			setNotice({ type: 'success', text: 'Permissions saved.' });
		} catch (err) {
			setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save permissions.' });
		} finally {
			setSavingPerms(false);
		}
	};

	const handleDelete = async () => {
		if (!window.confirm(`Delete "${role.name}"? This removes it from all assigned employees.`)) return;
		setDeletingRole(true);
		try {
			await deleteRole(role.id);
			onBack();
		} catch (err) {
			setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to delete.' });
			setDeletingRole(false);
		}
	};

	const handleAssign = async (empId: string) => {
		setAssigningEmpId(empId);
		setNotice(null);
		try {
			const emp = employees.find((e) => e.id === empId);
			await assignRole(empId, role.id);
			setNotice({ type: 'success', text: `Assigned to ${emp ? formatEmployeeName(emp) : 'employee'}.` });
		} catch (err) {
			setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to assign.' });
		} finally {
			setAssigningEmpId('');
		}
	};

	return (
		<div className="space-y-6 max-w-4xl">
			{/* Breadcrumb header */}
			<div className="flex flex-wrap items-center gap-2">
				<button
					onClick={onBack}
					className="text-sm hover:underline"
					style={colors.text.hint.style}
					data-testid="back-to-list"
				>
					← Roles
				</button>
				<span style={colors.text.hint.style}>/</span>
				<span className="text-sm font-semibold" style={colors.text.primary.style}>
					{role.name}
				</span>
				<span
					className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
						role.isSystem ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'
					}`}
				>
					{role.isSystem ? 'System' : 'Custom'}
				</span>
			</div>

			{/* Notice */}
			{notice && (
				<div
					className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
						notice.type === 'success'
							? `${colors.status.success.bg} ${colors.status.success.text}`
							: `${colors.status.error.bg} ${colors.status.error.text}`
					}`}
					data-testid="edit-notice"
				>
					<span>{notice.text}</span>
					<button onClick={() => setNotice(null)} className="ml-3 opacity-60 hover:opacity-100">
						✕
					</button>
				</div>
			)}

			{/* ── Info section ── */}
			<section className="space-y-2">
				<p className="text-xs font-semibold uppercase tracking-widest" style={colors.text.hint.style}>
					Role Info
				</p>
				<div className="grid gap-2 sm:grid-cols-2">
					<div className="space-y-1">
						<label className="text-xs" style={colors.text.secondary.style}>
							Name
						</label>
						<input
							type="text"
							value={roleName}
							onChange={(e) => setRoleName(e.target.value)}
							disabled={role.isSystem}
							className={`h-9 w-full rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.focus} disabled:opacity-60`}
							data-testid="edit-role-name"
						/>
					</div>
					<div className="space-y-1">
						<label className="text-xs" style={colors.text.secondary.style}>
							Description
						</label>
						<input
							type="text"
							value={roleDesc}
							onChange={(e) => setRoleDesc(e.target.value)}
							disabled={role.isSystem}
							className={`h-9 w-full rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.focus} disabled:opacity-60`}
							data-testid="edit-role-desc"
						/>
					</div>
				</div>
				{!role.isSystem && (
					<div className="flex gap-2">
						<button
							onClick={handleSaveInfo}
							disabled={savingInfo || !infoDirty}
							className={`h-8 rounded-lg px-4 text-xs font-medium ${colors.button.primary.bg} ${colors.button.primary.text} disabled:opacity-40`}
							data-testid="save-info-btn"
						>
							{savingInfo ? 'Saving…' : 'Save info'}
						</button>
						<button
							onClick={handleDelete}
							disabled={deletingRole}
							className={`h-8 rounded-lg border px-4 text-xs font-medium ${colors.button.danger.bg} ${colors.button.danger.border} border ${colors.button.danger.text} disabled:opacity-50`}
							data-testid="delete-role-btn"
						>
							{deletingRole ? 'Deleting…' : 'Delete role'}
						</button>
					</div>
				)}
			</section>

			{/* ── Permissions section ── */}
			<section className="space-y-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<p className="text-xs font-semibold uppercase tracking-widest" style={colors.text.hint.style}>
							Permissions
						</p>
						<p className="text-xs" style={colors.text.hint.style}>
							{permIds.length} selected{role.isSystem && ' · read-only'}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<input
							type="search"
							value={permSearch}
							onChange={(e) => setPermSearch(e.target.value)}
							placeholder="Filter…"
							className={`h-8 w-40 rounded-lg border px-2.5 text-xs ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.focus}`}
							data-testid="perm-search"
						/>
						{!role.isSystem && permsDirty && (
							<button
								onClick={handleSavePerms}
								disabled={savingPerms}
								className={`h-8 rounded-lg px-3 text-xs font-medium ${colors.button.primary.bg} ${colors.button.primary.text} disabled:opacity-50`}
								data-testid="save-perms-btn"
							>
								{savingPerms ? 'Saving…' : 'Save'}
							</button>
						)}
					</div>
				</div>

				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{filteredPermGroups.map((group) => {
						const checkedCount = group.permissions.filter((p) => permIds.includes(p.id)).length;
						return (
							<div key={group.domain} className="space-y-0.5">
								<div className="flex items-center justify-between pb-0.5 border-b" style={colors.border.light.style}>
									<p className="text-[11px] font-semibold" style={colors.text.secondary.style}>
										{formatDomainLabel(group.domain)}
									</p>
									<span className="text-[10px]" style={colors.text.hint.style}>
										{checkedCount}/{group.permissions.length}
									</span>
								</div>
								{group.permissions.map((perm) => {
									const checked = permIds.includes(perm.id);
									return (
										<label
											key={perm.id}
											className={`flex items-center gap-1.5 py-0.5 text-xs ${role.isSystem ? 'cursor-default' : 'cursor-pointer'}`}
											data-testid={`perm-${perm.id}`}
										>
											<input
												type="checkbox"
												checked={checked}
												disabled={role.isSystem}
												onChange={() => togglePerm(perm.id)}
												className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-blue-600 disabled:opacity-50"
											/>
											<span style={checked ? colors.text.primary.style : colors.text.secondary.style}>
												{formatPermLabel(perm.id)}
											</span>
										</label>
									);
								})}
							</div>
						);
					})}
				</div>

				{!role.isSystem && permsDirty && (
					<div className="flex gap-2 pt-1 border-t" style={colors.border.light.style}>
						<button
							onClick={() => setPermIds([...role.permissionIds])}
							className={`h-7 rounded-md border px-3 text-xs ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
						>
							Discard
						</button>
						<button
							onClick={handleSavePerms}
							disabled={savingPerms}
							className={`h-7 rounded-md px-3 text-xs font-medium ${colors.button.primary.bg} ${colors.button.primary.text} disabled:opacity-50`}
							data-testid="save-perms-footer"
						>
							{savingPerms ? 'Saving…' : 'Save changes'}
						</button>
					</div>
				)}
			</section>

			{/* ── Assign member section ── */}
			<section className="space-y-2">
				<p className="text-xs font-semibold uppercase tracking-widest" style={colors.text.hint.style}>
					Assign Member
				</p>
				<input
					type="search"
					value={empSearch}
					onChange={(e) => setEmpSearch(e.target.value)}
					placeholder="Search name or email…"
					className={`h-8 w-64 rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.focus}`}
					data-testid="emp-search"
				/>
				<div className="max-h-72 overflow-y-auto">
					{filteredEmployees.length === 0 && (
						<p className="py-4 text-center text-xs" style={colors.text.hint.style}>
							No employees match.
						</p>
					)}
					{filteredEmployees.map((emp) => (
						<div
							key={emp.id}
							className="flex items-center justify-between gap-3 border-b py-1.5"
							style={colors.border.light.style}
							data-testid={`emp-row-${emp.id}`}
						>
							<div className="min-w-0">
								<p className="text-xs font-medium truncate" style={colors.text.primary.style}>
									{formatEmployeeName(emp)}
								</p>
								<p className="text-[11px] truncate" style={colors.text.hint.style}>
									{emp.email}
								</p>
							</div>
							<button
								onClick={() => handleAssign(emp.id)}
								disabled={assigningEmpId === emp.id}
								className={`shrink-0 h-6 rounded-md px-2.5 text-xs ${colors.button.primary.bg} ${colors.button.primary.text} disabled:opacity-50`}
								data-testid={`assign-btn-${emp.id}`}
							>
								{assigningEmpId === emp.id ? '…' : 'Assign'}
							</button>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}

// ─── Create Role view ─────────────────────────────────────────────────────────

interface CreateRoleViewProps {
	permissionGroups: IAMPermissionGroup[];
	onBack: (createdId?: string) => void;
}

function CreateRoleView({ permissionGroups, onBack }: CreateRoleViewProps) {
	const colors = useThemeColors();

	const [roleName, setRoleName] = useState('');
	const [roleDesc, setRoleDesc] = useState('');
	const [permIds, setPermIds] = useState<string[]>([]);
	const [permSearch, setPermSearch] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');

	const deferredPermSearch = useDeferredValue(permSearch);

	const filteredPermGroups = useMemo(() => {
		const q = deferredPermSearch.trim().toLowerCase();
		if (!q) return permissionGroups;
		return permissionGroups
			.map((g) => ({ ...g, permissions: g.permissions.filter((p) => `${p.id} ${p.description}`.toLowerCase().includes(q)) }))
			.filter((g) => g.permissions.length > 0);
	}, [deferredPermSearch, permissionGroups]);

	const togglePerm = (permId: string) =>
		setPermIds((prev) => (prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]));

	const handleCreate = async () => {
		const name = roleName.trim();
		if (!name) { setError('Role name is required.'); return; }
		setSaving(true);
		setError('');
		try {
			const created = await createRole(name, roleDesc.trim(), permIds);
			onBack(created.id);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create role.');
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-6 max-w-4xl">
			{/* Breadcrumb header */}
			<div className="flex flex-wrap items-center gap-2">
				<button
					onClick={() => onBack()}
					className="text-sm hover:underline"
					style={colors.text.hint.style}
					data-testid="back-from-create"
				>
					← Roles
				</button>
				<span style={colors.text.hint.style}>/</span>
				<span className="text-sm font-semibold" style={colors.text.primary.style}>
					New Role
				</span>
			</div>

			{error && (
				<div className={`rounded-md px-3 py-2 text-sm ${colors.status.error.bg} ${colors.status.error.text}`}>
					{error}
				</div>
			)}

			{/* ── Info ── */}
			<section className="space-y-2">
				<p className="text-xs font-semibold uppercase tracking-widest" style={colors.text.hint.style}>
					Role Info
				</p>
				<div className="grid gap-2 sm:grid-cols-2">
					<div className="space-y-1">
						<label className="text-xs" style={colors.text.secondary.style}>
							Name *
						</label>
						<input
							type="text"
							value={roleName}
							onChange={(e) => setRoleName(e.target.value)}
							onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
							placeholder="e.g. Finance Analyst"
							autoFocus
							className={`h-9 w-full rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.focus}`}
							data-testid="create-role-name"
						/>
					</div>
					<div className="space-y-1">
						<label className="text-xs" style={colors.text.secondary.style}>
							Description
						</label>
						<input
							type="text"
							value={roleDesc}
							onChange={(e) => setRoleDesc(e.target.value)}
							onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
							placeholder="Optional description"
							className={`h-9 w-full rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.focus}`}
							data-testid="create-role-desc"
						/>
					</div>
				</div>
			</section>

			{/* ── Permissions ── */}
			<section className="space-y-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<p className="text-xs font-semibold uppercase tracking-widest" style={colors.text.hint.style}>
							Permissions
						</p>
						<p className="text-xs" style={colors.text.hint.style}>
							{permIds.length} selected
						</p>
					</div>
					<input
						type="search"
						value={permSearch}
						onChange={(e) => setPermSearch(e.target.value)}
						placeholder="Filter…"
						className={`h-8 w-40 rounded-lg border px-2.5 text-xs ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.focus}`}
						data-testid="create-perm-search"
					/>
				</div>
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{filteredPermGroups.map((group) => (
						<div key={group.domain} className="space-y-0.5">
							<div className="pb-0.5 border-b" style={colors.border.light.style}>
								<p className="text-[11px] font-semibold" style={colors.text.secondary.style}>
									{formatDomainLabel(group.domain)}
								</p>
							</div>
							{group.permissions.map((perm) => {
								const checked = permIds.includes(perm.id);
								return (
									<label
										key={perm.id}
										className="flex items-center gap-1.5 cursor-pointer py-0.5 text-xs"
										data-testid={`create-perm-${perm.id}`}
									>
										<input
											type="checkbox"
											checked={checked}
											onChange={() => togglePerm(perm.id)}
											className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-blue-600"
										/>
										<span style={checked ? colors.text.primary.style : colors.text.secondary.style}>
											{formatPermLabel(perm.id)}
										</span>
									</label>
								);
							})}
						</div>
					))}
				</div>
			</section>

			{/* ── Actions ── */}
			<div className="flex gap-2 pt-2 border-t" style={colors.border.light.style}>
				<button
					onClick={handleCreate}
					disabled={saving}
					className={`h-9 rounded-lg px-5 text-sm font-medium ${colors.button.primary.bg} ${colors.button.primary.text} disabled:opacity-50`}
					data-testid="confirm-create-role"
				>
					{saving ? 'Creating…' : 'Create role'}
				</button>
				<button
					onClick={() => onBack()}
					className={`h-9 rounded-lg border px-4 text-sm ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
				>
					Cancel
				</button>
			</div>
		</div>
	);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function PermissionsTab() {
	const colors = useThemeColors();
	const { user } = useRequireAuth();
	const organizationId = user?.organizationId || '';

	// ── Remote data ──
	const [roles, setRoles] = useState<IAMOrgRole[]>([]);
	const [permissionGroups, setPermissionGroups] = useState<IAMPermissionGroup[]>([]);
	const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState('');
	const [dataVersion, setDataVersion] = useState(0);

	// ── Navigation ──
	const [view, setView] = useState<'list' | 'edit' | 'create'>('list');
	const [editRoleId, setEditRoleId] = useState('');

	// ── List UI ──
	const [selectedRoleId, setSelectedRoleId] = useState('');
	const [roleSearch, setRoleSearch] = useState('');
	const [notice, setNotice] = useState<Notice | null>(null);

	// Load data
	useEffect(() => {
		if (!organizationId) return;
		let cancelled = false;

		const load = async () => {
			setLoading(true);
			setLoadError('');
			try {
				const [loadedRoles, loadedPerms, empResp] = await Promise.all([
					listRoles(),
					listPermissions(),
					listEmployees(organizationId, { pageNumber: 1, pageSize: EMPLOYEE_PAGE_SIZE }),
				]);
				if (cancelled) return;
				setRoles(loadedRoles);
				setPermissionGroups(loadedPerms.groups);
				setEmployees(empResp.employees);
			} catch (err) {
				if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load data.');
			} finally {
				if (!cancelled) setLoading(false);
			}
		};

		load();
		return () => { cancelled = true; };
	}, [organizationId, dataVersion]);

	// Auto-select first role
	useEffect(() => {
		if (!roles.length) { setSelectedRoleId(''); return; }
		if (!roles.some((r) => r.id === selectedRoleId)) setSelectedRoleId(roles[0].id);
	}, [roles, selectedRoleId]);

	const deferredSearch = useDeferredValue(roleSearch);

	const selectedRole = useMemo(
		() => roles.find((r) => r.id === selectedRoleId) ?? null,
		[roles, selectedRoleId],
	);

	const filteredRoles = useMemo(() => {
		const q = deferredSearch.trim().toLowerCase();
		if (!q) return roles;
		return roles.filter((r) => `${r.name} ${r.description}`.toLowerCase().includes(q));
	}, [deferredSearch, roles]);

	// Permissions for selected role, grouped by domain (only domains with ≥1 assigned perm)
	const selectedPermGroups = useMemo(() => {
		if (!selectedRole) return [];
		return permissionGroups
			.map((g) => ({ ...g, permissions: g.permissions.filter((p) => selectedRole.permissionIds.includes(p.id)) }))
			.filter((g) => g.permissions.length > 0);
	}, [selectedRole, permissionGroups]);

	const refresh = () => setDataVersion((v) => v + 1);

	const goToEdit = (roleId: string) => {
		setEditRoleId(roleId);
		setView('edit');
		setNotice(null);
	};

	const backToList = () => {
		setView('list');
		setEditRoleId('');
		refresh();
	};

	// ── Edit view ──
	if (view === 'edit') {
		const role = roles.find((r) => r.id === editRoleId);
		if (!role) {
			return (
				<div className="space-y-3">
					<button onClick={backToList} className="text-sm" style={colors.text.hint.style}>
						← Roles
					</button>
					<p style={colors.text.hint.style}>Role not found.</p>
				</div>
			);
		}
		return (
			<EditRoleView
				role={role}
				permissionGroups={permissionGroups}
				employees={employees}
				onBack={backToList}
			/>
		);
	}

	// ── Create view ──
	if (view === 'create') {
		return (
			<CreateRoleView
				permissionGroups={permissionGroups}
				onBack={(createdId) => {
					if (createdId) {
						setSelectedRoleId(createdId);
						setNotice({ type: 'success', text: 'Role created.' });
					}
					setView('list');
					refresh();
				}}
			/>
		);
	}

	// ── List view ──
	return (
		<div className="space-y-3">
			{/* Toolbar */}
			<div className="flex items-center justify-between gap-3">
				<input
					type="search"
					value={roleSearch}
					onChange={(e) => setRoleSearch(e.target.value)}
					placeholder="Search roles…"
					className={`h-8 w-44 rounded-lg border px-3 text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
					data-testid="search-roles"
				/>
				<button
					onClick={() => { setView('create'); setNotice(null); }}
					className={`h-8 rounded-lg px-3 text-sm font-medium ${colors.button.primary.bg} ${colors.button.primary.text}`}
					data-testid="add-role-btn"
				>
					+ Add role
				</button>
			</div>

			{/* Notice */}
			{notice && (
				<div
					className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
						notice.type === 'success'
							? `${colors.status.success.bg} ${colors.status.success.text}`
							: `${colors.status.error.bg} ${colors.status.error.text}`
					}`}
					data-testid="permissions-notice"
				>
					<span>{notice.text}</span>
					<button onClick={() => setNotice(null)} className="ml-3 opacity-60 hover:opacity-100">
						✕
					</button>
				</div>
			)}

			{loadError && (
				<div className={`rounded-md px-3 py-2 text-sm ${colors.status.error.bg} ${colors.status.error.text}`}>
					{loadError}
				</div>
			)}

			{loading ? (
				<p className="py-8 text-center text-sm" style={colors.text.hint.style}>Loading…</p>
			) : (
				<div className="grid gap-x-10 lg:grid-cols-[220px_minmax(0,1fr)]">
					{/* Left: role list */}
					<div data-testid="role-list">
						{filteredRoles.length === 0 ? (
							<p className="py-4 text-sm" style={colors.text.hint.style}>No roles found.</p>
						) : (
							filteredRoles.map((role) => {
								const sel = role.id === selectedRoleId;
								return (
									<div
										key={role.id}
										className="group flex items-start justify-between gap-2 border-b py-2 cursor-pointer"
										style={colors.border.light.style}
										onClick={() => setSelectedRoleId(role.id)}
										data-testid={`role-row-${role.id}`}
									>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-1.5">
												<span
													className={`h-1.5 w-1.5 shrink-0 rounded-full ${sel ? 'bg-blue-500' : 'bg-transparent'}`}
												/>
												<p
													className="text-sm font-medium truncate"
													style={sel ? colors.text.primary.style : colors.text.secondary.style}
												>
													{role.name}
												</p>
												<span
													className={`shrink-0 rounded-full px-1.5 py-0 text-[10px] font-medium ${
														role.isSystem ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'
													}`}
												>
													{role.isSystem ? 'Sys' : 'Custom'}
												</span>
											</div>
											<p className="ml-3 text-[11px]" style={colors.text.hint.style}>
												{role.permissionIds.length} perm{role.permissionIds.length !== 1 ? 's' : ''} ·{' '}
												{role.employeeCount} member{role.employeeCount !== 1 ? 's' : ''}
											</p>
										</div>
										<button
											onClick={(e) => { e.stopPropagation(); goToEdit(role.id); }}
											className={`shrink-0 h-6 rounded px-2 text-xs opacity-0 group-hover:opacity-100 border ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
											data-testid={`edit-role-${role.id}`}
										>
											Edit
										</button>
									</div>
								);
							})
						)}
					</div>

					{/* Right: permissions for selected role */}
					<div>
						{selectedRole ? (
							<div>
								<div
									className="flex items-center justify-between mb-3 pb-2 border-b"
									style={colors.border.light.style}
								>
									<div>
										<p className="text-sm font-semibold" style={colors.text.primary.style}>
											{selectedRole.name}
										</p>
										{selectedRole.description && (
											<p className="text-xs" style={colors.text.hint.style}>
												{selectedRole.description}
											</p>
										)}
									</div>
									<button
										onClick={() => goToEdit(selectedRole.id)}
										className={`h-6 rounded px-2 text-xs border ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
										data-testid="edit-selected-role"
									>
										Edit
									</button>
								</div>

								{selectedPermGroups.length === 0 ? (
									<p className="text-xs italic" style={colors.text.hint.style}>No permissions assigned.</p>
								) : (
									<div className="space-y-2">
										{selectedPermGroups.map((group) => (
											<div key={group.domain}>
												<p
													className="text-[10px] font-semibold uppercase tracking-widest mb-0.5"
													style={colors.text.hint.style}
												>
													{formatDomainLabel(group.domain)}
												</p>
												<p className="text-xs leading-relaxed" style={colors.text.secondary.style}>
													{group.permissions.map((p) => formatPermLabel(p.id)).join(' · ')}
												</p>
											</div>
										))}
									</div>
								)}
							</div>
						) : (
							!loading && (
								<p className="text-sm" style={colors.text.hint.style}>
									Select a role to view its permissions.
								</p>
							)
						)}
					</div>
				</div>
			)}
		</div>
	);
}
