/**
 * Create Department Dialog
 * Form for creating new departments with optional parent selection
 * Compact modal design for efficient space usage
 */

'use client';

import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useThemeColors } from '@/theme/useThemeColors';
import { createDepartment } from 'apis';

interface CreateDepartmentDialogProps {
	isOpen: boolean;
	onClose: () => void;
	parentDepartmentId?: string | null;
}

export default function CreateDepartmentDialog({
	isOpen,
	onClose,
	parentDepartmentId,
}: CreateDepartmentDialogProps) {
	const colors = useThemeColors();
	const queryClient = useQueryClient();
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [error, setError] = useState<string | null>(null);

	const mutation = useMutation({
		mutationFn: createDepartment,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['departmentTree'] });
			onClose();
			setName('');
			setDescription('');
			setError(null);
		},
		onError: (err: Error) => {
			setError(err.message || 'Failed to create department');
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) {
			setError('Department name is required');
			return;
		}
		mutation.mutate({
			name: name.trim(),
			description: description.trim() || undefined,
			parentDepartmentId: parentDepartmentId || undefined,
		});
	};

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
			<div className="rounded-lg shadow-xl max-w-2xl w-full mx-4" style={colors.bg.paper.style}>
				{/* Header */}
				<div className="h-12 px-4 flex items-center justify-between" style={{ ...colors.border.default.style, borderBottomWidth: '1px' }}>
					<h2 className="text-lg font-semibold" style={colors.text.primary.style}>
						Create {parentDepartmentId ? 'Sub-' : ''}Department
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
					<div className="space-y-3">
						{/* Name Field */}
						<div>
							<label htmlFor="name" className="block text-sm font-medium mb-1" style={colors.text.primary.style}>
								Department Name *
							</label>
							<input
								id="name"
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								className={`w-full h-10 px-3 border rounded-lg text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
								placeholder="e.g., Engineering, Sales, Marketing"
								required
							/>
						</div>

						{/* Description Field */}
						<div>
							<label htmlFor="description" className="block text-sm font-medium mb-1" style={colors.text.primary.style}>
								Description (optional)
							</label>
							<textarea
								id="description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								className={`w-full h-20 px-3 py-2 border rounded-lg text-sm ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
								placeholder="Describe the department's purpose and responsibilities"
							/>
						</div>

						{/* Error Message */}
						{error && (
							<div className={`p-3 border rounded-lg text-sm ${colors.status.error.bg} ${colors.status.error.border} ${colors.status.error.text}`}>
								{error}
							</div>
						)}
					</div>

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
							disabled={mutation.isPending}
							className={`h-9 px-4 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${colors.button.primary.bg} ${colors.button.primary.text}`}
						>
							{mutation.isPending ? 'Creating...' : 'Create Department'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
