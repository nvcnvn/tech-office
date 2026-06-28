/**
 * Move Employee To Department Dialog
 * Removes employee from current department and assigns to the selected target department.
 * Preserves the employee's role (member/manager) when moving.
 */

'use client';

import { useState } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { useThemeColors } from '@/theme/useThemeColors';
import {
	getDepartmentTree,
	removeEmployeeFromDepartment,
	assignEmployeeToDepartment,
} from 'apis';
import { UserCard } from '@/components/user';

interface MoveEmployeeToDepartmentDialogProps {
	isOpen: boolean;
	onClose: () => void;
	employeeId: string;
	currentRole: string;
	fromDepartmentId: string;
}

export default function MoveEmployeeToDepartmentDialog({
	isOpen,
	onClose,
	employeeId,
	currentRole,
	fromDepartmentId,
}: MoveEmployeeToDepartmentDialogProps) {
	const colors = useThemeColors();
	const queryClient = useQueryClient();
	const [targetDepartmentId, setTargetDepartmentId] = useState<string>('');
	const [error, setError] = useState<string | null>(null);

	const { data: treeData, isLoading } = useQuery({
		queryKey: ['departmentTree'],
		queryFn: getDepartmentTree,
		enabled: isOpen,
	});

	const mutation = useMutation({
		mutationFn: async () => {
			// Step 1: Remove from current department
			await removeEmployeeFromDepartment(employeeId);
			// Step 2: Assign to target department with same role
			await assignEmployeeToDepartment({
				departmentId: targetDepartmentId,
				employeeId,
				role: currentRole,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['departmentTree'] });
			queryClient.invalidateQueries({ queryKey: ['departmentMembers'] });
			queryClient.invalidateQueries({ queryKey: ['unassignedEmployees'] });
			onClose();
			setTargetDepartmentId('');
			setError(null);
		},
		onError: (err: Error) => {
			setError(err.message || 'Failed to move employee');
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!targetDepartmentId) {
			setError('Please select a target department');
			return;
		}
		setError(null);
		mutation.mutate();
	};

	if (!isOpen) return null;

	const departments = (treeData?.departments || []).filter(
		(d) => d.id !== fromDepartmentId,
	);

	return (
		<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
			<div className="rounded-lg shadow-xl max-w-md w-full mx-4" style={colors.bg.paper.style}>
				{/* Header */}
				<div
					className="h-12 px-4 flex items-center justify-between"
					style={{ ...colors.border.default.style, borderBottomWidth: '1px' }}
				>
					<h2 className="text-lg font-semibold" style={colors.text.primary.style}>
						Move Employee
					</h2>
					<button
						onClick={onClose}
						className={`${colors.text.disabled.className} hover:opacity-70 transition-colors`}
					>
						✕
					</button>
				</div>

				{/* Form */}
				<form onSubmit={handleSubmit} className="p-4">
					{/* Employee preview */}
					<div className="mb-4">
						<p className="text-xs mb-1.5" style={colors.text.secondary.style}>Employee</p>
						<UserCard employeeId={employeeId} variant="compact" avatarSize="sm" showPresence />
					</div>

					{isLoading ? (
						<div className="py-6 text-center text-sm" style={colors.text.secondary.style}>
							Loading departments...
						</div>
					) : (
						<div className="space-y-3">
							<div>
								<label
									htmlFor="target-dept"
									className="block text-sm font-medium mb-1"
									style={colors.text.primary.style}
								>
									Move to Department
								</label>
								<select
									id="target-dept"
									data-testid="move-employee-target-dept"
									value={targetDepartmentId}
									onChange={(e) => setTargetDepartmentId(e.target.value)}
									className={`w-full h-10 px-3 border rounded-lg text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.focus}`}
								>
									<option value="">-- Select department --</option>
									{departments.map((dept) => (
										<option key={dept.id} value={dept.id}>
											{dept.fullPath || dept.name}
										</option>
									))}
								</select>
							</div>

							{error && (
								<div
									className={`p-3 border rounded-lg text-sm ${colors.status.error.bg} ${colors.status.error.border} ${colors.status.error.text}`}
								>
									{error}
								</div>
							)}
						</div>
					)}

					{/* Actions */}
					<div
						className="flex items-center justify-end gap-2 mt-4 pt-4"
						style={{ ...colors.border.default.style, borderTopWidth: '1px' }}
					>
						<button
							type="button"
							onClick={onClose}
							className={`h-9 px-4 border rounded-lg text-sm transition-colors ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={mutation.isPending || isLoading || !targetDepartmentId}
							className={`h-9 px-4 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${colors.button.primary.bg} ${colors.button.primary.text}`}
						>
							{mutation.isPending ? 'Moving...' : 'Move Employee'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
