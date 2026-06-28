/**
 * DepartmentOrgNode
 * Custom React Flow node for the department org chart.
 * Displays department name, manager section (lazy-loaded), counts, and a kebab menu for actions.
 * All colors use useThemeColors() — no hardcoded hex/rgb values.
 */

'use client';

import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import { useThemeColors } from '@/theme/useThemeColors';
import type { department } from 'apis';
import { getDepartmentMembers } from 'apis';
import { UserCard, usePopulateUserCache } from '@/components/user';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

export interface DepartmentNodeData extends Record<string, unknown> {
	department: department.Department;
	onEdit: (departmentId: string) => void;
	onMove: (departmentId: string) => void;
	onAddEmployee: (departmentId: string) => void;
	onAssignManager: (departmentId: string) => void;
	onCreateChild: (parentId: string) => void;
	onMoveMember: (employeeId: string, currentRole: string, fromDepartmentId: string) => void;
	onDropDepartment: (departmentId: string, newParentId: string) => void;
	onDropMember: (employeeId: string, role: string, fromDepartmentId: string, toDepartmentId: string) => void;
	isExpanded: boolean;
	onToggleExpand: (departmentId: string) => void;
	isDropTarget: boolean;
	onDragOverNode: (departmentId: string | null) => void;
}

/** React Flow node type for a department — used for type-safe node registration. */
export type DepartmentFlowNode = Node<DepartmentNodeData, 'departmentNode'>;

/** Node dimensions — must match what dagre uses for layout computation. */
export const ORG_NODE_WIDTH = 220;
export const ORG_NODE_HEIGHT = 110;

/** Height of each member row inside the expanded member list. */
const MEMBER_ROW_HEIGHT = 36;
/** Maximum number of members visible before scrolling. */
const MAX_VISIBLE_MEMBERS = 5;
/** Extra padding for the expand toggle button + spacing. */
const EXPAND_SECTION_PADDING = 32;

/** Compute the expanded node height based on visible member count. */
export function getExpandedNodeHeight(memberCount: number): number {
	const visibleCount = Math.min(memberCount, MAX_VISIBLE_MEMBERS);
	return ORG_NODE_HEIGHT + EXPAND_SECTION_PADDING + visibleCount * MEMBER_ROW_HEIGHT;
}

const MENU_ITEMS = [
	{ id: 'edit', icon: EditIcon, label: 'Edit department', actionKey: 'onEdit' as const },
	{ id: 'move', icon: DriveFileMoveIcon, label: 'Move department', actionKey: 'onMove' as const },
	{ id: 'add-sub', icon: AccountTreeIcon, label: 'Add sub-department', actionKey: 'onCreateChild' as const },
	{ id: 'add-employee', icon: PersonAddIcon, label: 'Add employee', actionKey: 'onAddEmployee' as const },
	{ id: 'assign-manager', icon: ManageAccountsIcon, label: 'Assign manager', actionKey: 'onAssignManager' as const },
];

export default function DepartmentOrgNode({ data }: NodeProps<DepartmentFlowNode>) {
	const { department, onEdit, onMove, onAddEmployee, onAssignManager, onCreateChild, onMoveMember, onDropDepartment, onDropMember, isExpanded, onToggleExpand, isDropTarget, onDragOverNode } = data;
	const colors = useThemeColors();
	const populateCache = usePopulateUserCache();
	const noManager = (department.managerCount || 0) === 0;
	const hasMembers = (department.memberCount || 0) > 0;
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	const [localDragOver, setLocalDragOver] = useState(false);

	const actions = { onEdit, onMove, onAddEmployee, onAssignManager, onCreateChild };

	// Close menu on click outside
	useEffect(() => {
		if (!menuOpen) return;
		const handler = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) {
				setMenuOpen(false);
			}
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [menuOpen]);

	// Lazily fetch members — needed for manager display AND expanded member list
	const { data: membersData, isLoading: loadingMembers } = useQuery({
		queryKey: ['departmentMembers', department.id],
		queryFn: () => getDepartmentMembers(department.id),
		enabled: !noManager || isExpanded, // fetch when there's a manager to show OR node is expanded
	});

	const members = useMemo(() => membersData?.members || [], [membersData?.members]);
	const managers = members.filter((m) => m.role === 'manager');
	const regularMembers = members.filter((m) => m.role !== 'manager');

	// Seed user cache so UserCard can render immediately
	useEffect(() => {
		if (!members.length) return;
		populateCache(members.map(m => ({
			id: m.employeeId,
			givenName: m.employeeFirstName,
			familyName: m.employeeLastName,
			email: m.employeeEmail,
		})));
	}, [members, populateCache]);

	const handleMenuToggle = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		setMenuOpen((prev) => !prev);
	}, []);

	const handleMenuAction = useCallback(
		(actionFn: (id: string) => void) => (e: React.MouseEvent) => {
			e.stopPropagation();
			setMenuOpen(false);
			actionFn(department.id);
		},
		[department.id],
	);

	const handleToggleExpand = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			onToggleExpand(department.id);
		},
		[department.id, onToggleExpand],
	);

	// --- Drag-and-drop: department node as drag source ---
	const handleDragStart = useCallback(
		(e: React.DragEvent) => {
			e.dataTransfer.setData('application/x-dept-id', department.id);
			e.dataTransfer.effectAllowed = 'move';
		},
		[department.id],
	);

	// --- Drag-and-drop: department node as drop target ---
	const handleDragOver = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			// Accept both department drops and member drops
			if (
				e.dataTransfer.types.includes('application/x-dept-id') ||
				e.dataTransfer.types.includes('application/x-member-employee-id')
			) {
				e.dataTransfer.dropEffect = 'move';
				setLocalDragOver(true);
				onDragOverNode(department.id);
			}
		},
		[department.id, onDragOverNode],
	);

	const handleDragLeave = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setLocalDragOver(false);
			onDragOverNode(null);
		},
		[onDragOverNode],
	);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setLocalDragOver(false);
			onDragOverNode(null);

			// Case 1: A department node was dropped onto this node → reparent
			const draggedDeptId = e.dataTransfer.getData('application/x-dept-id');
			if (draggedDeptId && draggedDeptId !== department.id) {
				onDropDepartment(draggedDeptId, department.id);
				return;
			}

			// Case 2: A member was dropped onto this node → reassign
			const employeeId = e.dataTransfer.getData('application/x-member-employee-id');
			const memberRole = e.dataTransfer.getData('application/x-member-role');
			const fromDeptId = e.dataTransfer.getData('application/x-member-from-dept');
			if (employeeId && fromDeptId && fromDeptId !== department.id) {
				onDropMember(employeeId, memberRole || 'member', fromDeptId, department.id);
			}
		},
		[department.id, onDropDepartment, onDropMember, onDragOverNode],
	);

	// --- Drag-and-drop: member row as drag source ---
	const handleMemberDragStart = useCallback(
		(employeeId: string, role: string) => (e: React.DragEvent) => {
			e.stopPropagation(); // prevent node drag
			e.dataTransfer.setData('application/x-member-employee-id', employeeId);
			e.dataTransfer.setData('application/x-member-role', role);
			e.dataTransfer.setData('application/x-member-from-dept', department.id);
			e.dataTransfer.effectAllowed = 'move';
		},
		[department.id],
	);

	return (
		<div
			data-testid={`org-node-${department.id}`}
			draggable
			onDragStart={handleDragStart}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			className={`nopan group relative rounded-lg border shadow-sm transition-all hover:shadow-md cursor-grab active:cursor-grabbing ${
				localDragOver || isDropTarget
					? 'ring-2 ring-blue-400 border-blue-400 shadow-blue-100 dark:shadow-blue-900/30'
					: ''
			}`}
			style={{
				width: ORG_NODE_WIDTH,
				minHeight: ORG_NODE_HEIGHT,
				...colors.bg.paper.style,
				...(localDragOver || isDropTarget ? {} : colors.border.default.style),
			}}
		>
			{/* React Flow connection handles */}
			<Handle
				type="target"
				position={Position.Top}
				style={{ background: 'transparent', border: 'none' }}
			/>
			<Handle
				type="source"
				position={Position.Bottom}
				style={{ background: 'transparent', border: 'none' }}
			/>

			{/* Kebab menu trigger — appears on hover at top-right */}
			<div ref={menuRef} className="nopan absolute top-1.5 right-1.5 z-20">
				<button
					data-testid={`org-node-menu-${department.id}`}
					onClick={handleMenuToggle}
					className="w-6 h-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-all hover:bg-black/5 dark:hover:bg-white/10"
					style={colors.text.secondary.style}
					title="Actions"
				>
					<MoreVertIcon sx={{ fontSize: 16 }} />
				</button>

				{/* Dropdown menu */}
				{menuOpen && (
					<div
						data-testid={`org-node-actions-${department.id}`}
						className="absolute right-0 top-7 w-48 rounded-lg border shadow-lg py-1"
						style={{
							...colors.bg.paper.style,
							...colors.border.default.style,
						}}
					>
						{MENU_ITEMS.map((item) => {
							const Icon = item.icon;
							return (
								<button
									key={item.id}
									data-testid={`org-node-${item.id}-${department.id}`}
									onClick={handleMenuAction(actions[item.actionKey])}
									className="w-full h-8 px-3 flex items-center gap-2.5 text-xs cursor-pointer transition-colors hover:bg-black/10 dark:hover:bg-white/15"
									style={colors.text.primary.style}
								>
									<Icon sx={{ fontSize: 15, ...colors.text.secondary.style }} />
									{item.label}
								</button>
							);
						})}
					</div>
				)}
			</div>

			{/* Node content */}
			<div className="px-3 pt-3 pb-2">
				{/* Department name */}
				<p
					data-testid={`org-node-name-${department.id}`}
					className="text-sm font-semibold leading-tight truncate pr-6"
					style={colors.text.primary.style}
					title={department.name}
				>
					{department.name}
				</p>

				{/* Manager row */}
				<div className="mt-1 flex items-center min-h-6">
					{noManager ? (
						<span
							data-testid={`org-node-no-manager-${department.id}`}
							className="text-xs font-medium text-amber-500"
						>
							⚠ No manager
						</span>
					) : managers.length > 0 ? (
						<div data-testid={`org-node-manager-${department.id}`}>
							<UserCard
								employeeId={managers[0].employeeId}
								variant="compact"
								avatarSize="xs"
								showPresence
							/>
						</div>
					) : (
						// Loading placeholder — keeps layout stable
						<span className="text-xs" style={colors.text.disabled.style}>
							Loading…
						</span>
					)}
				</div>

				{/* Counts row — member count is clickable to toggle expand */}
				<div className="mt-1.5 flex items-center gap-3 text-xs" style={colors.text.disabled.style}>
					{hasMembers ? (
						<button
							data-testid={`org-node-expand-${department.id}`}
							onClick={handleToggleExpand}
							className="nopan flex items-center gap-0.5 cursor-pointer transition-colors hover:opacity-80"
							style={colors.text.secondary.style}
						>
							{isExpanded ? (
								<ExpandLessIcon sx={{ fontSize: 14 }} />
							) : (
								<ExpandMoreIcon sx={{ fontSize: 14 }} />
							)}
							<span>
								{department.memberCount || 0}{' '}
								{(department.memberCount || 0) === 1 ? 'member' : 'members'}
							</span>
						</button>
					) : (
						<span data-testid={`org-node-members-${department.id}`}>
							0 members
						</span>
					)}
					{(department.childCount || 0) > 0 && (
						<span data-testid={`org-node-children-${department.id}`}>
							{department.childCount} sub-depts
						</span>
					)}
				</div>
			</div>

			{/* Expanded member list */}
			{isExpanded && hasMembers && (
				<div
					data-testid={`org-node-member-list-${department.id}`}
					className="nopan border-t px-2 py-1"
					style={{
						...colors.border.default.style,
						maxHeight: MAX_VISIBLE_MEMBERS * MEMBER_ROW_HEIGHT,
						overflowY: 'auto',
					}}
				>
					{loadingMembers ? (
						<div className="h-8 flex items-center justify-center text-xs" style={colors.text.hint.style}>
							Loading…
						</div>
					) : (
						<>
							{managers.map((member) => (
								<div
									key={member.id}
									draggable
									onDragStart={handleMemberDragStart(member.employeeId, member.role)}
									className="h-9 flex items-center gap-1.5 px-1 cursor-grab active:cursor-grabbing"
								>
									<UserCard
										employeeId={member.employeeId}
										variant="compact"
										avatarSize="xs"
										showPresence
									/>
									<span
										className="text-[10px] font-medium shrink-0 px-1 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 ml-auto"
									>
										MGR
									</span>
									<button
										data-testid={`org-node-move-member-${member.employeeId}`}
										onClick={(e) => { e.stopPropagation(); onMoveMember(member.employeeId, member.role, department.id); }}
										className="nopan shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/5 dark:hover:bg-white/10"
										style={colors.text.disabled.style}
										title="Move to another department"
									>
										<DriveFileMoveIcon sx={{ fontSize: 12 }} />
									</button>
								</div>
							))}
							{regularMembers.map((member) => (
								<div
									key={member.id}
									draggable
									onDragStart={handleMemberDragStart(member.employeeId, member.role)}
									className="h-9 flex items-center gap-1.5 px-1 cursor-grab active:cursor-grabbing"
								>
									<UserCard
										employeeId={member.employeeId}
										variant="compact"
										avatarSize="xs"
										showPresence
									/>
									<button
										data-testid={`org-node-move-member-${member.employeeId}`}
										onClick={(e) => { e.stopPropagation(); onMoveMember(member.employeeId, member.role, department.id); }}
										className="nopan shrink-0 ml-auto w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/5 dark:hover:bg-white/10"
										style={colors.text.disabled.style}
										title="Move to another department"
									>
										<DriveFileMoveIcon sx={{ fontSize: 12 }} />
									</button>
								</div>
							))}
							{members.length === 0 && (
								<div className="h-8 flex items-center text-xs" style={colors.text.hint.style}>
									No members found
								</div>
							)}
						</>
					)}
				</div>
			)}
		</div>
	);
}
