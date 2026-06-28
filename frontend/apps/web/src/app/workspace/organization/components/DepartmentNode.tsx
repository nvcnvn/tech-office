/**
 * Department Node
 * Individual department row in tree view with inline actions
 * Compact vertical spacing with horizontal action layout
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useThemeColors } from '@/theme/useThemeColors';
import type { department } from 'apis';
import { getDepartmentMembers } from 'apis';
import { UserCard, usePopulateUserCache } from '@/components/user';

interface DepartmentNodeProps {
	department: department.Department;
	depth: number;
	hasChildren: boolean;
	isExpanded: boolean;
	onToggleExpand: () => void;
	onEdit: (departmentId: string) => void;
	onMove: (departmentId: string) => void;
	onAddEmployee: (departmentId: string) => void;
	onAssignManager: (departmentId: string) => void;
	onCreateChild: (parentId: string) => void;
}

export default function DepartmentNode({
	department,
	depth,
	hasChildren,
	isExpanded,
	onToggleExpand,
	onEdit,
	onMove,
	onAddEmployee,
	onAssignManager,
	onCreateChild,
}: DepartmentNodeProps) {
	const colors = useThemeColors();
	const populateCache = usePopulateUserCache();
	const emptyDepartment = (department.memberCount || 0) === 0 && (department.childCount || 0) === 0;
	const noManager = (department.managerCount || 0) === 0;
	const hasMembers = (department.memberCount || 0) > 0;
	const isExpandable = hasChildren || hasMembers; // Can expand if has children OR members
	const [showMembers, setShowMembers] = useState(false);

	// Fetch members when expanded and has members
	const { data: membersData, isLoading: loadingMembers } = useQuery({
		queryKey: ['departmentMembers', department.id],
		queryFn: () => getDepartmentMembers(department.id),
		enabled: isExpanded && hasMembers,
	});

	// Toggle member visibility when expanded state changes
	useEffect(() => {
		if (isExpanded && hasMembers) {
			setShowMembers(true);
		} else {
			setShowMembers(false);
		}
	}, [isExpanded, hasMembers]);

	const members = membersData?.members || [];
	const managers = members.filter(m => m.role === 'manager');
	const regularMembers = members.filter(m => m.role !== 'manager');

	// Seed cache whenever member data arrives
	useEffect(() => {
		if (!members.length) return;
		populateCache(members.map(m => ({
			id: m.employeeId,
			givenName: m.employeeFirstName,
			familyName: m.employeeLastName,
			email: m.employeeEmail,
		})));
	}, [members, populateCache]);

	return (
		<div>
			{/* Department Row */}
			<div
				className={`h-10 flex items-center gap-2 px-3 group transition-colors ${colors.bg.hover}`}
				style={{ paddingLeft: `${depth * 24 + 12}px` }}
			>
				{/* Expand/Collapse Button */}
				<button
					onClick={onToggleExpand}
					className={`w-4 h-4 flex items-center justify-center shrink-0 ${colors.text.disabled.className} hover:opacity-70`}
					disabled={!isExpandable}
				>
					{isExpandable ? (
						isExpanded ? '▼' : '▶'
					) : (
						<span className="opacity-50">•</span>
					)}
				</button>

				{/* Department Name & Info */}
				<div className="flex-1 flex items-center gap-2 min-w-0">
					<span className="font-medium text-sm truncate" style={colors.text.primary.style}>
						{department.name}
					</span>
					{department.description && (
						<span className="text-xs truncate" style={colors.text.hint.style}>
							{department.description}
						</span>
					)}
				</div>

				{/* Counts & Warning Indicators */}
				<div className="flex items-center gap-3 shrink-0 text-xs">
					<span style={colors.text.secondary.style}>
						{department.memberCount || 0} {(department.memberCount || 0) === 1 ? 'member' : 'members'}
					</span>
					{noManager && (
						<span className="text-yellow-600 font-medium" title="No manager assigned">
							⚠️ No manager
						</span>
					)}
					{emptyDepartment && (
						<span className="text-orange-600 font-medium" title="No employees in this department">
							⚠️ Empty
						</span>
					)}
				</div>

				{/* Inline Actions - Show on hover */}
				<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
					<button
						onClick={() => onEdit(department.id)}
						className={`h-7 px-2 text-xs rounded transition-colors ${colors.text.secondary.className} ${colors.primary.hover}`}
						style={{ color: 'inherit' }}
						title="Edit department"
					>
						Edit
					</button>
					<button
						onClick={() => onMove(department.id)}
						className={`h-7 px-2 text-xs rounded transition-colors ${colors.text.secondary.className} ${colors.primary.hover}`}
						style={{ color: 'inherit' }}
						title="Move department"
					>
						Move
					</button>
					<button
						onClick={() => onAddEmployee(department.id)}
						className={`h-7 px-2 text-xs rounded transition-colors ${colors.text.secondary.className} hover:bg-green-50 hover:text-green-600`}
						style={{ color: 'inherit' }}
						title="Add employee"
					>
						+ Employee
					</button>
					<button
						onClick={() => onAssignManager(department.id)}
						className={`h-7 px-2 text-xs rounded transition-colors ${colors.text.secondary.className} hover:bg-purple-50 hover:text-purple-600`}
						style={{ color: 'inherit' }}
						title="Assign manager"
					>
						Manager
					</button>
					<button
						onClick={() => onCreateChild(department.id)}
						className={`h-7 px-2 text-xs rounded transition-colors ${colors.text.secondary.className} ${colors.primary.hover}`}
						style={{ color: 'inherit' }}
						title="Create child department"
					>
						+ Sub-dept
					</button>
				</div>
			</div>

			{/* Members List - Show when expanded and has members */}
			{showMembers && (
				<div style={{ paddingLeft: `${depth * 24 + 48}px` }}>
					{loadingMembers ? (
						<div className="h-8 px-3 text-xs flex items-center" style={colors.text.hint.style}>
							Loading members...
						</div>
					) : (
						<div className="py-1">
							{/* Managers First */}
							{managers.length > 0 && (
								<div className="mb-1">
									{managers.map((member) => (
										<div
											key={member.id}
											className={`h-9 px-3 flex items-center gap-2 text-xs transition-colors ${colors.bg.hover}`}
										>
											<span className="w-16 shrink-0 text-purple-600 font-medium">Manager</span>
											<UserCard
												employeeId={member.employeeId}
												variant="compact"
												avatarSize="xs"
												showPresence
											/>
										</div>
									))}
								</div>
							)}

							{/* Regular Members */}
							{regularMembers.length > 0 && (
								<div>
									{regularMembers.map((member) => (
										<div
											key={member.id}
											className={`h-9 px-3 flex items-center gap-2 text-xs transition-colors ${colors.bg.hover}`}
										>
											<span className="w-16 shrink-0" style={colors.text.hint.style}>Member</span>
											<UserCard
												employeeId={member.employeeId}
												variant="compact"
												avatarSize="xs"
												showPresence
											/>
										</div>
									))}
								</div>
							)}

							{/* No members found (edge case) */}
							{members.length === 0 && (
								<div className="h-8 px-3 text-xs flex items-center" style={colors.text.hint.style}>
									No members found
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
