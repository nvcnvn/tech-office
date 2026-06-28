/**
 * Department Tree View
 * Hierarchical tree visualization for departments
 * Uses collapsible tree structure with depth-based indentation
 */

'use client';

import { useState, useEffect } from 'react';
import DepartmentNode from './DepartmentNode';
import type { department } from 'apis';

interface DepartmentTreeViewProps {
	departments: department.Department[];
	expandAll: boolean;
	onEdit: (departmentId: string) => void;
	onMove: (departmentId: string) => void;
	onAddEmployee: (departmentId: string) => void;
	onAssignManager: (departmentId: string) => void;
	onCreateChild: (parentId: string) => void;
}

export default function DepartmentTreeView({
	departments,
	expandAll,
	onEdit,
	onMove,
	onAddEmployee,
	onAssignManager,
	onCreateChild,
}: DepartmentTreeViewProps) {
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

	// Handle expand/collapse all
	useEffect(() => {
		if (expandAll) {
			setExpandedIds(new Set(departments.map(d => d.id)));
		} else {
			setExpandedIds(new Set());
		}
	}, [expandAll, departments]);

	const toggleExpand = (departmentId: string) => {
		const newExpanded = new Set(expandedIds);
		if (newExpanded.has(departmentId)) {
			newExpanded.delete(departmentId);
		} else {
			newExpanded.add(departmentId);
		}
		setExpandedIds(newExpanded);
	};

	// Build tree structure from flat list
	const buildTree = (departments: department.Department[]): department.Department[] => {
		const rootDepartments = departments.filter(d => !d.parentDepartmentId);
		return rootDepartments;
	};

	const getChildren = (parentId: string): department.Department[] => {
		return departments.filter(d => d.parentDepartmentId === parentId);
	};

	const renderDepartment = (dept: department.Department) => {
		const children = getChildren(dept.id);
		const hasChildren = children.length > 0;
		const isExpanded = expandedIds.has(dept.id);

		return (
			<div key={dept.id}>
				<DepartmentNode
					department={dept}
					depth={dept.depth || 0}
					hasChildren={hasChildren}
					isExpanded={isExpanded}
					onToggleExpand={() => toggleExpand(dept.id)}
					onEdit={onEdit}
					onMove={onMove}
					onAddEmployee={onAddEmployee}
					onAssignManager={onAssignManager}
					onCreateChild={onCreateChild}
				/>
				{hasChildren && isExpanded && (
					<div>
						{children.map(child => renderDepartment(child))}
					</div>
				)}
			</div>
		);
	};

	const rootDepartments = buildTree(departments);

	if (rootDepartments.length === 0) {
		return (
			<div className="p-8 text-center text-sm text-gray-600">
				No departments to display
			</div>
		);
	}

	return (
		<div className="divide-y divide-gray-100">
			{rootDepartments.map(dept => renderDepartment(dept))}
		</div>
	);
}
