/**
 * Departments Tab
 * Hierarchical department management with org chart (desktop) and tree view (mobile fallback).
 * View toggle allows switching between org chart and list view on any screen size.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { getDepartmentTree, moveDepartment, removeEmployeeFromDepartment, assignEmployeeToDepartment } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import DepartmentTreeView from './DepartmentTreeView';
import DepartmentOrgChart from './DepartmentOrgChart';
import CreateDepartmentDialog from './CreateDepartmentDialog';
import EditDepartmentDialog from './EditDepartmentDialog';
import MoveDepartmentDialog from './MoveDepartmentDialog';
import AssignManagerDialog from './AssignManagerDialog';
import AddEmployeeDialog from './AddEmployeeDialog';
import MoveEmployeeToDepartmentDialog from './MoveEmployeeToDepartmentDialog';

export default function DepartmentsTab() {
	const colors = useThemeColors();
	const queryClient = useQueryClient();
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
	const [isAssignManagerDialogOpen, setIsAssignManagerDialogOpen] = useState(false);
	const [isAddEmployeeDialogOpen, setIsAddEmployeeDialogOpen] = useState(false);
	const [isMoveEmployeeDialogOpen, setIsMoveEmployeeDialogOpen] = useState(false);
	const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
	const [moveEmployeeData, setMoveEmployeeData] = useState<{ employeeId: string; currentRole: string; fromDepartmentId: string } | null>(null);
	const [expandAll, setExpandAll] = useState(false);

	// Mobile detection — auto-switch to list view on narrow screens
	const [isMobile, setIsMobile] = useState(false);
	const [forceListView, setForceListView] = useState(false);
	const showListView = isMobile || forceListView;

	useEffect(() => {
		const mq = window.matchMedia('(max-width: 767px)');
		setIsMobile(mq.matches);
		const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	}, []);

	// Fetch department tree
	const { data: departmentTree, isLoading, error } = useQuery({
		queryKey: ['departmentTree'],
		queryFn: getDepartmentTree,
	});

	const handleCreateDepartment = (parentId?: string) => {
		setSelectedDepartmentId(parentId || null);
		setIsCreateDialogOpen(true);
	};

	const handleEditDepartment = (departmentId: string) => {
		setSelectedDepartmentId(departmentId);
		setIsEditDialogOpen(true);
	};

	const handleMoveDepartment = (departmentId: string) => {
		setSelectedDepartmentId(departmentId);
		setIsMoveDialogOpen(true);
	};

	const handleAssignManager = (departmentId: string) => {
		setSelectedDepartmentId(departmentId);
		setIsAssignManagerDialogOpen(true);
	};

	const handleAddEmployee = (departmentId: string) => {
		setSelectedDepartmentId(departmentId);
		setIsAddEmployeeDialogOpen(true);
	};

	const handleMoveMember = (employeeId: string, currentRole: string, fromDepartmentId: string) => {
		setMoveEmployeeData({ employeeId, currentRole, fromDepartmentId });
		setIsMoveEmployeeDialogOpen(true);
	};

	// --- Drag-and-drop: move department to new parent ---
	const deptMoveMutation = useMutation({
		mutationFn: moveDepartment,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['departmentTree'] });
		},
	});

	const handleDropDepartment = useCallback(
		(departmentId: string, newParentId: string) => {
			deptMoveMutation.mutate({ departmentId, newParentId });
		},
		[deptMoveMutation],
	);

	// --- Drag-and-drop: move employee to another department ---
	const memberMoveMutation = useMutation({
		mutationFn: async ({ employeeId, role, toDepartmentId }: { employeeId: string; role: string; toDepartmentId: string }) => {
			await removeEmployeeFromDepartment(employeeId);
			await assignEmployeeToDepartment({ departmentId: toDepartmentId, employeeId, role });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['departmentTree'] });
			queryClient.invalidateQueries({ queryKey: ['departmentMembers'] });
			queryClient.invalidateQueries({ queryKey: ['unassignedEmployees'] });
		},
	});

	const handleDropMember = useCallback(
		(employeeId: string, role: string, _fromDepartmentId: string, toDepartmentId: string) => {
			memberMoveMutation.mutate({ employeeId, role, toDepartmentId });
		},
		[memberMoveMutation],
	);

	return (
		<div className="space-y-4">
			{/* Action Bar - Horizontal layout for compact vertical spacing */}
			<div className="flex items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<button
						onClick={() => handleCreateDepartment()}
						className={`h-9 px-4 ${colors.button.primary.bg} ${colors.button.primary.text} rounded-lg text-sm font-medium transition-colors`}
					>
						+ Create Root Department
					</button>
					{showListView && (
						<button
							onClick={() => setExpandAll(!expandAll)}
							className={`h-9 px-3 border ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text} rounded-lg text-sm`}
						>
							{expandAll ? 'Collapse All' : 'Expand All'}
						</button>
					)}
				</div>

				<div className="flex items-center gap-3">
					<div className="text-sm" style={colors.text.secondary.style}>
						{departmentTree?.departments?.length || 0} departments
					</div>
					<button
						data-testid="view-toggle-btn"
						onClick={() => setForceListView(!forceListView)}
						className={`h-9 px-3 border ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text} rounded-lg text-sm`}
					>
						{showListView ? 'Switch to Org Chart' : 'Switch to List View'}
					</button>
				</div>
			</div>

			{/* Department View */}
			<div
				className="border rounded-lg overflow-hidden"
				style={{
					...colors.bg.paper.style,
					...colors.border.default.style,
					...(showListView ? {} : { height: '600px' }),
				}}
			>
				{isLoading && (
					<div className="p-8 text-center text-sm" style={colors.text.secondary.style}>
						Loading departments...
					</div>
				)}

				{error && (
					<div className="p-8 text-center">
						<p className={`text-sm ${colors.status.error.text}`}>Failed to load departments</p>
						<p className="text-xs mt-1" style={colors.text.disabled.style}>{(error as Error).message}</p>
					</div>
				)}

				{!isLoading && !error && (!departmentTree?.departments || departmentTree.departments.length === 0) && (
					<div className="py-8 text-center">
						<div className="text-4xl mb-3">🏢</div>
						<p className="text-sm mb-4" style={colors.text.secondary.style}>No departments yet</p>
						<button
							onClick={() => handleCreateDepartment()}
							className={`h-9 px-4 ${colors.button.primary.bg} ${colors.button.primary.text} rounded-lg text-sm font-medium`}
						>
							Create First Department
						</button>
					</div>
				)}

				{!isLoading && !error && departmentTree?.departments && departmentTree.departments.length > 0 && (
					showListView ? (
						<DepartmentTreeView
							departments={departmentTree.departments}
							expandAll={expandAll}
							onEdit={handleEditDepartment}
							onMove={handleMoveDepartment}
							onAddEmployee={handleAddEmployee}
							onAssignManager={handleAssignManager}
							onCreateChild={handleCreateDepartment}
						/>
					) : (
						<DepartmentOrgChart
							departments={departmentTree.departments}
							onEdit={handleEditDepartment}
							onMove={handleMoveDepartment}
							onAddEmployee={handleAddEmployee}
							onAssignManager={handleAssignManager}
							onCreateChild={handleCreateDepartment}
							onMoveMember={handleMoveMember}
							onDropDepartment={handleDropDepartment}
							onDropMember={handleDropMember}
						/>
					)
				)}
			</div>

			{/* Dialogs */}
			{isCreateDialogOpen && (
				<CreateDepartmentDialog
					isOpen={isCreateDialogOpen}
					onClose={() => setIsCreateDialogOpen(false)}
					parentDepartmentId={selectedDepartmentId}
				/>
			)}

			{isEditDialogOpen && selectedDepartmentId && (
				<EditDepartmentDialog
					isOpen={isEditDialogOpen}
					onClose={() => setIsEditDialogOpen(false)}
					departmentId={selectedDepartmentId}
				/>
			)}

			{isMoveDialogOpen && selectedDepartmentId && (
				<MoveDepartmentDialog
					isOpen={isMoveDialogOpen}
					onClose={() => setIsMoveDialogOpen(false)}
					departmentId={selectedDepartmentId}
				/>
			)}

			{isAssignManagerDialogOpen && selectedDepartmentId && (
				<AssignManagerDialog
					isOpen={isAssignManagerDialogOpen}
					onClose={() => setIsAssignManagerDialogOpen(false)}
					departmentId={selectedDepartmentId}
				/>
			)}

			{isAddEmployeeDialogOpen && selectedDepartmentId && (
				<AddEmployeeDialog
					isOpen={isAddEmployeeDialogOpen}
					onClose={() => setIsAddEmployeeDialogOpen(false)}
					departmentId={selectedDepartmentId}
				/>
			)}

			{isMoveEmployeeDialogOpen && moveEmployeeData && (
				<MoveEmployeeToDepartmentDialog
					isOpen={isMoveEmployeeDialogOpen}
					onClose={() => { setIsMoveEmployeeDialogOpen(false); setMoveEmployeeData(null); }}
					employeeId={moveEmployeeData.employeeId}
					currentRole={moveEmployeeData.currentRole}
					fromDepartmentId={moveEmployeeData.fromDepartmentId}
				/>
			)}
		</div>
	);
}
