/**
 * Assign Manager Dialog
 * Select an employee from department members to designate as manager
 * Shows option to clear manager if one exists
 */

'use client';

import { useState } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { useThemeColors } from '@/theme/useThemeColors';
import { getDepartmentMembers, setDepartmentManager, clearDepartmentManager } from 'apis';

interface AssignManagerDialogProps {
	isOpen: boolean;
	onClose: () => void;
	departmentId: string;
}

export default function AssignManagerDialog({
	isOpen,
	onClose,
	departmentId,
}: AssignManagerDialogProps) {
	const colors = useThemeColors();
	const queryClient = useQueryClient();
	const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
	const [error, setError] = useState<string | null>(null);

	// Fetch department members
	const { data: membersData, isLoading } = useQuery({
		queryKey: ['departmentMembers', departmentId],
		queryFn: () => getDepartmentMembers(departmentId),
		enabled: isOpen && !!departmentId,
	});

	const setManagerMutation = useMutation({
		mutationFn: setDepartmentManager,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['departmentTree'] });
			queryClient.invalidateQueries({ queryKey: ['departmentMembers', departmentId] });
			onClose();
			setError(null);
		},
		onError: (err: Error) => {
			setError(err.message || 'Failed to set manager');
		},
	});

	const clearManagerMutation = useMutation({
		mutationFn: clearDepartmentManager,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['departmentTree'] });
			queryClient.invalidateQueries({ queryKey: ['departmentMembers', departmentId] });
			onClose();
			setError(null);
		},
		onError: (err: Error) => {
			setError(err.message || 'Failed to clear manager');
		},
	});

	const handleSetManager = (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedEmployeeId) {
			setError('Please select an employee');
			return;
		}
		setManagerMutation.mutate({
			departmentId,
			employeeId: selectedEmployeeId,
		});
	};

	const handleClearManager = () => {
		if (confirm('Are you sure you want to remove the manager designation? The employee will remain a member.')) {
			clearManagerMutation.mutate(departmentId);
		}
	};

	if (!isOpen) return null;

	const members = membersData?.members || [];
	const currentManager = members.find(m => m.role === 'manager');
	const eligibleMembers = members.filter(m => m.role !== 'manager');

	return (
		<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
			<div className="rounded-lg shadow-xl max-w-2xl w-full mx-4" style={colors.bg.paper.style}>
				{/* Header */}
				<div className="h-12 px-4 flex items-center justify-between" style={{ ...colors.border.default.style, borderBottomWidth: '1px' }}>
					<h2 className="text-lg font-semibold" style={colors.text.primary.style}>Assign Manager</h2>
					<button
						onClick={onClose}
						className={`${colors.text.disabled.className} hover:opacity-70 transition-colors`}
					>
						✕
					</button>
				</div>

				{/* Content */}
				<div className="p-4">
					{isLoading ? (
						<div className="py-8 text-center text-sm" style={colors.text.secondary.style}>Loading members...</div>
					) : (
						<>
							{/* Current Manager */}
							{currentManager && (
								<div className={`mb-4 p-3 border rounded-lg ${colors.status.info.bg} ${colors.status.info.border}`}>
									<div className="flex items-center justify-between">
										<div>
											<p className="text-sm font-medium" style={colors.text.primary.style}>Current Manager</p>
											<p className="text-sm" style={colors.text.secondary.style}>
												{currentManager.employeeFirstName} {currentManager.employeeLastName}
												{currentManager.employeeEmail && (
													<span className="text-xs ml-2" style={colors.text.hint.style}>
														({currentManager.employeeEmail})
													</span>
												)}
											</p>
										</div>
										<button
											onClick={handleClearManager}
											disabled={clearManagerMutation.isPending}
											className={`h-8 px-3 border rounded-lg text-xs font-medium disabled:opacity-50 transition-colors ${colors.status.error.border} ${colors.status.error.text}`}
											style={{ backgroundColor: 'transparent' }}
										>
											Clear Manager
										</button>
									</div>
								</div>
							)}

							{/* Select New Manager */}
							{eligibleMembers.length > 0 ? (
								<form onSubmit={handleSetManager} className="space-y-3">
									<div>
										<label htmlFor="employee" className="block text-sm font-medium mb-1" style={colors.text.primary.style}>
											Select Employee to Designate as Manager
										</label>
										<select
											id="employee"
											value={selectedEmployeeId}
											onChange={(e) => setSelectedEmployeeId(e.target.value)}
											className={`w-full h-10 px-3 border rounded-lg text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.focus}`}
											required
										>
											<option value="">-- Select an employee --</option>
											{eligibleMembers.map((member) => (
												<option key={member.employeeId} value={member.employeeId}>
													{member.employeeFirstName} {member.employeeLastName}
													{member.employeeEmail && ` (${member.employeeEmail})`}
												</option>
											))}
										</select>
									</div>

									{error && (
										<div className={`p-3 border rounded-lg text-sm ${colors.status.error.bg} ${colors.status.error.border} ${colors.status.error.text}`}>
											{error}
										</div>
									)}

									<div className="flex items-center justify-end gap-2 pt-4" style={{ ...colors.border.default.style, borderTopWidth: '1px' }}>
										<button
											type="button"
											onClick={onClose}
											className={`h-9 px-4 border rounded-lg text-sm transition-colors ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
										>
											Cancel
										</button>
										<button
											type="submit"
											disabled={setManagerMutation.isPending}
											className={`h-9 px-4 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${colors.button.primary.bg} ${colors.button.primary.text}`}
										>
											{setManagerMutation.isPending ? 'Setting...' : 'Set as Manager'}
										</button>
									</div>
								</form>
							) : (
								<div className="py-8 text-center">
									<p className="text-sm" style={colors.text.secondary.style}>
										No eligible employees. Add members to this department first.
									</p>
								</div>
							)}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
