/**
 * Move Department Dialog
 * Select new parent department for restructuring hierarchy
 * Excludes current department and its descendants to prevent circular references
 */

'use client';

import { useState } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { useThemeColors } from '@/theme/useThemeColors';
import { getDepartmentTree, moveDepartment } from 'apis';

interface MoveDepartmentDialogProps {
	isOpen: boolean;
	onClose: () => void;
	departmentId: string;
}

export default function MoveDepartmentDialog({
	isOpen,
	onClose,
	departmentId,
}: MoveDepartmentDialogProps) {
	const colors = useThemeColors();
	const queryClient = useQueryClient();
	const [newParentId, setNewParentId] = useState<string>('');
	const [error, setError] = useState<string | null>(null);

	// Fetch department tree to show parent options
	const { data: treeData, isLoading } = useQuery({
		queryKey: ['departmentTree'],
		queryFn: getDepartmentTree,
		enabled: isOpen,
	});

	const mutation = useMutation({
		mutationFn: moveDepartment,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['departmentTree'] });
			onClose();
			setError(null);
		},
		onError: (err: Error) => {
			setError(err.message || 'Failed to move department. This may cause a circular reference.');
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		mutation.mutate({
			departmentId,
			newParentId: newParentId || undefined,
		});
	};

	// Filter out current department and its descendants
	const getValidParents = () => {
		if (!treeData?.departments) return [];

		// Get all descendant IDs by traversing the path
		const currentDept = treeData.departments.find(d => d.id === departmentId);
		if (!currentDept) return treeData.departments;

		const descendantIds = new Set<string>([departmentId]);
		treeData.departments.forEach(dept => {
			if (dept.path?.includes(departmentId)) {
				descendantIds.add(dept.id);
			}
		});

		return treeData.departments.filter(d => !descendantIds.has(d.id));
	};

	if (!isOpen) return null;

	const validParents = getValidParents();

	return (
		<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
			<div className="rounded-lg shadow-xl max-w-2xl w-full mx-4" style={colors.bg.paper.style}>
				{/* Header */}
				<div className="h-12 px-4 flex items-center justify-between" style={{ ...colors.border.default.style, borderBottomWidth: '1px' }}>
					<h2 className="text-lg font-semibold" style={colors.text.primary.style}>Move Department</h2>
					<button
						onClick={onClose}
						className={`${colors.text.disabled.className} hover:opacity-70 transition-colors`}
					>
						✕
					</button>
				</div>

				{/* Form */}
				<form onSubmit={handleSubmit} className="p-4">
					{isLoading ? (
						<div className="py-8 text-center text-sm" style={colors.text.secondary.style}>Loading departments...</div>
					) : (
						<div className="space-y-3">
							{/* Parent Selection */}
							<div>
								<label htmlFor="parent" className="block text-sm font-medium mb-1" style={colors.text.primary.style}>
									New Parent Department
								</label>
								<select
									id="parent"
									value={newParentId}
									onChange={(e) => setNewParentId(e.target.value)}
									className={`w-full h-10 px-3 border rounded-lg text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.focus}`}
								>
									<option value="">-- Make Root Department (no parent) --</option>
									{validParents.map((dept) => (
										<option key={dept.id} value={dept.id}>
											{dept.fullPath || dept.name}
										</option>
									))}
								</select>
								<p className="text-xs mt-1" style={colors.text.hint.style}>
									Select a new parent or choose no parent to make this a root department
								</p>
							</div>

							{/* Error Message */}
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
						<button
							type="submit"
							disabled={mutation.isPending || isLoading}
							className={`h-9 px-4 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${colors.button.primary.bg} ${colors.button.primary.text}`}
						>
							{mutation.isPending ? 'Moving...' : 'Move Department'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
