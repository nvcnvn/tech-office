/**
 * Add Employee Dialog
 * Assign unassigned employees to a department as members
 * Shows list of employees without department membership
 */

'use client';

import { useState } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { useThemeColors } from '@/theme/useThemeColors';
import { getUnassignedEmployees, assignEmployeeToDepartment } from 'apis';

interface AddEmployeeDialogProps {
	isOpen: boolean;
	onClose: () => void;
	departmentId: string;
}

export default function AddEmployeeDialog({
	isOpen,
	onClose,
	departmentId,
}: AddEmployeeDialogProps) {
	const colors = useThemeColors();
	const queryClient = useQueryClient();
	const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
	const [error, setError] = useState<string | null>(null);

	// Fetch unassigned employees
	const { data: unassignedData, isLoading } = useQuery({
		queryKey: ['unassignedEmployees'],
		queryFn: getUnassignedEmployees,
		enabled: isOpen,
	});

	const mutation = useMutation({
		mutationFn: assignEmployeeToDepartment,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['departmentTree'] });
			queryClient.invalidateQueries({ queryKey: ['unassignedEmployees'] });
			queryClient.invalidateQueries({ queryKey: ['departmentMembers', departmentId] });
			onClose();
			setSelectedEmployeeId('');
			setError(null);
		},
		onError: (err: Error) => {
			setError(err.message || 'Failed to add employee to department');
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedEmployeeId) {
			setError('Please select an employee');
			return;
		}
		mutation.mutate({
			departmentId,
			employeeId: selectedEmployeeId,
			role: 'member',
		});
	};

	if (!isOpen) return null;

	const unassignedEmployees = unassignedData?.employees || [];

	return (
		<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
			<div className="rounded-lg shadow-xl max-w-2xl w-full mx-4" style={colors.bg.paper.style}>
				{/* Header */}
				<div className="h-12 px-4 flex items-center justify-between" style={{ ...colors.border.default.style, borderBottomWidth: '1px' }}>
					<h2 className="text-lg font-semibold" style={colors.text.primary.style}>Add Employee to Department</h2>
					<button
						onClick={onClose}
						className={`${colors.text.disabled.className} hover:opacity-70 transition-colors`}
					>
						✕
					</button>
				</div>

				{/* Content */}
				<form onSubmit={handleSubmit} className="p-4">
					{isLoading ? (
						<div className="py-8 text-center text-sm" style={colors.text.secondary.style}>Loading employees...</div>
					) : unassignedEmployees.length === 0 ? (
						<div className="py-8 text-center">
							<p className="text-sm mb-2" style={colors.text.secondary.style}>
								No unassigned employees available
							</p>
							<p className="text-xs" style={colors.text.hint.style}>
								All employees in your organization are already assigned to departments
							</p>
						</div>
					) : (
						<div className="space-y-3">
							<div>
								<label htmlFor="employee" className="block text-sm font-medium mb-1" style={colors.text.primary.style}>
									Select Employee
								</label>
								<select
									id="employee"
									value={selectedEmployeeId}
									onChange={(e) => setSelectedEmployeeId(e.target.value)}
									className={`w-full h-10 px-3 border rounded-lg text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.focus}`}
									required
								>
									<option value="">-- Select an employee --</option>
									{unassignedEmployees.map((employee) => (
										<option key={employee.id} value={employee.id}>
											{employee.firstName} {employee.lastName}
											{employee.email && ` (${employee.email})`}
										</option>
									))}
								</select>
								<p className="text-xs mt-1" style={colors.text.hint.style}>
									{unassignedEmployees.length} unassigned {unassignedEmployees.length === 1 ? 'employee' : 'employees'}
								</p>
							</div>

							{error && (
								<div className={`p-3 border rounded-lg text-sm ${colors.status.error.bg} ${colors.status.error.border} ${colors.status.error.text}`}>
									{error}
								</div>
							)}
						</div>
					)}

					{/* Actions */}
					<div className="flex items-center justify-end gap-2 mt-4 pt-4" style={{ ...colors.border.default.style, borderTopWidth: '1px' }}>
						<button
							type="button"
							onClick={onClose}
							className={`h-9 px-4 border rounded-lg text-sm transition-colors ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
						>
							Cancel
						</button>
						{unassignedEmployees.length > 0 && (
							<button
								type="submit"
								disabled={mutation.isPending}
								className={`h-9 px-4 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${colors.button.primary.bg} ${colors.button.primary.text}`}
							>
								{mutation.isPending ? 'Adding...' : 'Add to Department'}
							</button>
						)}
					</div>
				</form>
			</div>
		</div>
	);
}
