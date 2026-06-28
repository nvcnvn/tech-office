/**
 * Employees Tab
 * Manage organization employees with import functionality and listing
 * Optimized for wide screens with compact spacing
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth/hooks';
import { useThemeColors } from '@/theme/useThemeColors';
import {
	listEmployees,
	type ListEmployeesOptions,
	type EmployeeListItem,
	type PaginationMetadata,
	SortField,
	SortDirection,
} from 'apis';
import { UserCard, usePopulateUserCache } from '@/components/user';
import CreateSingleEmployeeDialog from './CreateSingleEmployeeDialog';
import EmployeeDetailDialog from './EmployeeDetailDialog';

export default function EmployeesTab() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { user } = useRequireAuth();
	const populateCache = usePopulateUserCache();

	// Extract organization ID and roles from user profile
	const organizationId = user?.organizationId || '';
	const userRoleNames = user?.roleNames ?? [];

	// Role-based column visibility
	const canSeeSensitiveFields = userRoleNames.includes('Owner') || userRoleNames.includes('Operator');
	const hasAdminAccess = userRoleNames.includes('Owner') || userRoleNames.includes('Operator');

	// State from URL query params for persistence
	const [emailSearch, setEmailSearch] = useState(searchParams.get('email') || '');
	const [sortField, setSortField] = useState<SortField>(
		(searchParams.get('sort') === 'date_of_birth' ? SortField.DATE_OF_BIRTH : SortField.HIRE_DATE)
	);
	const [sortDirection, setSortDirection] = useState<SortDirection>(
		(searchParams.get('order') === 'desc' ? SortDirection.DESC : SortDirection.ASC)
	);
	const [pageNumber, setPageNumber] = useState(parseInt(searchParams.get('page') || '1'));
	const [pageSize, setPageSize] = useState<number>(parseInt(searchParams.get('pageSize') || '50'));

	// Data loading state
	const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
	const [pagination, setPagination] = useState<PaginationMetadata | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	// Fetch employees
	useEffect(() => {
		if (!organizationId) return;

		const fetchEmployees = async () => {
			setIsLoading(true);
			setError(null);
			try {
				const options: ListEmployeesOptions = {
					emailFilter: emailSearch || undefined,
					sortBy: sortField,
					sortDirection: sortDirection,
					pageNumber,
					pageSize,
				};
				const result = await listEmployees(organizationId, options);
				setEmployees(result.employees);
				setPagination(result.pagination || null);					// Seed the user profile cache so UserCard resolves instantly
					populateCache(result.employees.map(e => ({
						id: e.id,
						givenName: e.givenName,
						familyName: e.familyName,
						email: e.email,
						isActive: e.isActive,
					})));			} catch (err) {
				console.error('Failed to load employees:', err);
				setError(err as Error);
			} finally {
				setIsLoading(false);
			}
		};

		fetchEmployees();
	}, [organizationId, emailSearch, sortField, sortDirection, pageNumber, pageSize]);

	// Update URL when filters change
	const updateURL = () => {
		const params = new URLSearchParams(searchParams.toString());
		if (emailSearch) params.set('email', emailSearch);
		else params.delete('email');

		params.set('sort', sortField === SortField.DATE_OF_BIRTH ? 'date_of_birth' : 'hire_date');
		params.set('order', sortDirection === SortDirection.DESC ? 'desc' : 'asc');
		params.set('page', pageNumber.toString());
		params.set('pageSize', pageSize.toString());

		router.replace(`?${params.toString()}`, { scroll: false });
	};

	// Sort handlers
	const handleSort = (field: SortField) => {
		if (sortField === field) {
			// Toggle direction
			setSortDirection(sortDirection === SortDirection.ASC ? SortDirection.DESC : SortDirection.ASC);
		} else {
			// New field, default ASC
			setSortField(field);
			setSortDirection(SortDirection.ASC);
		}
		setPageNumber(1); // Reset to first page
		updateURL();
	};

	// Search handler
	const handleSearch = (e: React.FormEvent) => {
		e.preventDefault();
		setPageNumber(1); // Reset to first page
		updateURL();
	};

	const handleClearSearch = () => {
		setEmailSearch('');
		setPageNumber(1);
		updateURL();
	};

	// Pagination handlers
	const handlePageChange = (newPage: number) => {
		setPageNumber(newPage);
		updateURL();
	};

	const handlePageSizeChange = (newSize: number) => {
		setPageSize(newSize);
		// Auto-redirect to valid page if current page exceeds new total
		const newTotalPages = Math.ceil((pagination?.totalCount || 0) / newSize);
		if (pageNumber > newTotalPages) {
			setPageNumber(1);
		}
		updateURL();
	};

	const [showCreateDialog, setShowCreateDialog] = useState(false);
	const [selectedEmployee, setSelectedEmployee] = useState<EmployeeListItem | null>(null);

	const refetch = () => {
		// Trigger refetch by updating a dependency
		setPageNumber(p => p);
	};

	const colors = useThemeColors();

	return (
		<div className="space-y-4">
			{/* Quick Actions - Compact */}
			{hasAdminAccess && (
				<div className={`${colors.card.info.bg} ${colors.card.info.border} border rounded-lg p-4`}>
					<h2 className={`text-sm font-semibold mb-3`} style={colors.text.primary.style}>Quick Actions</h2>
					<div className="flex gap-2">
						<button
							className={`h-9 px-4 ${colors.button.secondary.bg} ${colors.button.secondary.border} border ${colors.button.secondary.text} text-sm rounded-lg flex items-center gap-2`}
							onClick={() => setShowCreateDialog(true)}
							data-testid="add-single-employee-btn"
						>
							<span>👤</span>
							<span>Add Single Employee</span>
						</button>
						<button
							className={`h-9 px-4 ${colors.button.primary.bg} ${colors.button.primary.text} text-sm rounded-lg flex items-center gap-2`}
							onClick={() => router.push('/workspace/organization/import-employees')}
						>
							<span>👥</span>
							<span>Import Employees</span>
						</button>
					</div>
				</div>
			)}

			{/* Search and Filters - Horizontal layout */}
			<div className="flex gap-4 items-center">
				<form onSubmit={handleSearch} className="flex-1 max-w-md flex gap-2">
					<input
						type="email"
						placeholder="Search by email (exact match)..."
						value={emailSearch}
						onChange={(e) => setEmailSearch(e.target.value)}
						className={`flex-1 h-10 px-3 text-sm border rounded-lg ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text} ${colors.input.base.placeholder} ${colors.input.base.focus}`}
					/>
					{emailSearch && (
						<button
							type="button"
							onClick={handleClearSearch}
							className={`h-10 px-3 text-sm ${colors.text.secondary.className} hover:opacity-80`}
						>
							Clear
						</button>
					)}
					<button
						type="submit"
						className={`h-10 px-4 ${colors.button.primary.bg} ${colors.button.primary.text} text-sm rounded-lg`}
					>
						Search
					</button>
				</form>

				<div className="ml-auto flex gap-2 items-center">
					<span className="text-sm" style={colors.text.secondary.style}>Show:</span>
					<select
						value={pageSize}
						onChange={(e) => handlePageSizeChange(parseInt(e.target.value))}
						className={`h-10 px-3 text-sm border rounded-lg ${colors.input.base.bg} ${colors.input.base.border} ${colors.input.base.text}`}
					>
						<option value="20">20</option>
						<option value="50">50</option>
						<option value="100">100</option>
						<option value="200">200</option>
					</select>
				</div>
			</div>

			{/* Employee Table */}
			<div className={`border rounded-lg overflow-hidden`} style={{ ...colors.bg.paper.style, ...colors.border.default.style }}>
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead style={{ ...colors.bg.active.style, ...colors.border.default.style, borderBottomWidth: '1px' }}>
							<tr>
								<th className="px-4 py-3 text-left font-semibold" style={colors.text.primary.style}>Name</th>
								<th className="px-4 py-3 text-left font-semibold" style={colors.text.primary.style}>Email</th>
								<th
									className={`px-4 py-3 text-left font-semibold cursor-pointer ${colors.bg.hover}`}
									style={colors.text.primary.style}
									onClick={() => handleSort(SortField.HIRE_DATE)}
								>
									<div className="flex items-center gap-1">
										Hire Date
										{sortField === SortField.HIRE_DATE && (
											<span>{sortDirection === SortDirection.ASC ? '↑' : '↓'}</span>
										)}
									</div>
								</th>
								{canSeeSensitiveFields && (
									<th
										className={`px-4 py-3 text-left font-semibold cursor-pointer ${colors.bg.hover}`}
										style={colors.text.primary.style}
										onClick={() => handleSort(SortField.DATE_OF_BIRTH)}
									>
										<div className="flex items-center gap-1">
											Date of Birth
											{sortField === SortField.DATE_OF_BIRTH && (
												<span>{sortDirection === SortDirection.ASC ? '↑' : '↓'}</span>
											)}
										</div>
									</th>
								)}
								<th className="px-4 py-3 text-left font-semibold" style={colors.text.primary.style}>Phone</th>
								{canSeeSensitiveFields && (
									<th className="px-4 py-3 text-left font-semibold" style={colors.text.primary.style}>Home Address</th>
								)}
								<th className="px-4 py-3 text-left font-semibold" style={colors.text.primary.style}>Roles</th>
								<th className="px-4 py-3 text-left font-semibold" style={colors.text.primary.style}>Status</th>
							</tr>
						</thead>
						<tbody>
							{isLoading && (
								<tr>
									<td colSpan={canSeeSensitiveFields ? 8 : 6} className="px-4 py-12 text-center">
										<div className="flex flex-col items-center gap-3">
											<div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
											<p className="text-sm text-gray-600">Loading employees...</p>
										</div>
									</td>
								</tr>
							)}
							{error && (
								<tr>
									<td colSpan={canSeeSensitiveFields ? 8 : 6} className="px-4 py-12 text-center">
										<div className="flex flex-col items-center gap-3">
											<span className="text-4xl">⚠️</span>
											<p className="text-sm text-red-600">Failed to load employees</p>
											<p className="text-xs text-gray-500">{error.message}</p>
											<button
												onClick={refetch}
												className="h-9 px-4 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
											>
												Retry
											</button>
										</div>
									</td>
								</tr>
							)}
							{!isLoading && !error && employees.length === 0 && (
								<tr>
									<td colSpan={canSeeSensitiveFields ? 8 : 6} className="px-4 py-12 text-center">
										<div className="flex flex-col items-center gap-3">
											<span className="text-4xl">👥</span>
											<p className="text-sm text-gray-600">
												{emailSearch ? 'No employees found for this email' : 'No employees yet'}
											</p>
											{emailSearch && (
												<button
													onClick={handleClearSearch}
													className="text-sm text-blue-600 hover:underline"
												>
													Clear search
												</button>
											)}
										</div>
									</td>
								</tr>
							)}
							{!isLoading && !error && employees.map((emp: EmployeeListItem) => (
								<tr
									key={emp.id}
									className={`border-b border-gray-100 cursor-pointer ${colors.bg.hover} ${!emp.isActive ? 'opacity-50 text-gray-500' : ''
										}`}
									onClick={() => setSelectedEmployee(emp)}
									data-testid={`employee-row-${emp.id}`}
								>
									<td className="px-4 py-3 font-medium">
									<UserCard
										employeeId={emp.id}
										variant="compact"
										avatarSize="sm"
										showPresence
									/>
									</td>
									<td className="px-4 py-3">
									{emp.email ? (
										emp.email
									) : emp.loginIdentifier ? (
										<div className="flex items-center gap-1.5">
											<span className="inline-flex px-1.5 py-0.5 text-[10px] font-semibold rounded bg-purple-100 text-purple-700">PIN</span>
											<span style={colors.text.secondary.style}>{emp.loginIdentifier}</span>
										</div>
									) : emp.userAccountEmail ? (
										<span style={colors.text.secondary.style}>{emp.userAccountEmail}</span>
									) : (
										<span className="text-xs" style={colors.text.secondary.style}>—</span>
									)}
								</td>
									<td className="px-4 py-3">{emp.hireDate || 'N/A'}</td>
									{canSeeSensitiveFields && (
										<td className="px-4 py-3">{emp.dateOfBirth || 'N/A'}</td>
									)}
									<td className="px-4 py-3">{emp.phoneNumber || '-'}</td>
									{canSeeSensitiveFields && (
										<td className="px-4 py-3 max-w-xs truncate">{emp.homeAddress || '-'}</td>
									)}
									<td className="px-4 py-3">
										<div className="flex flex-wrap gap-1">
											{emp.roleNames.length > 0 ? emp.roleNames.map((role) => (
												<span
													key={role}
													className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800"
												>
													{role}
												</span>
											)) : (
												<span className="text-xs" style={colors.text.secondary.style}>—</span>
											)}
										</div>
									</td>
									<td className="px-4 py-3">
										<span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${emp.isActive
											? 'bg-green-100 text-green-800'
											: 'bg-gray-100 text-gray-800'
											}`}>
											{emp.isActive ? 'Active' : 'Inactive'}
										</span>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{/* Pagination */}
				{pagination && pagination.totalCount > 0 && (
					<div className="flex items-center justify-between px-4 py-3" style={{ ...colors.bg.active.style, ...colors.border.default.style, borderTopWidth: '1px' }}>
						<div className="text-sm" style={colors.text.secondary.style}>
							Showing {((pagination.pageNumber - 1) * pagination.pageSize) + 1} to{' '}
							{Math.min(pagination.pageNumber * pagination.pageSize, pagination.totalCount)} of{' '}
							{pagination.totalCount} employees
						</div>
						<div className="flex gap-2">
							<button
								onClick={() => handlePageChange(pageNumber - 1)}
								disabled={!pagination.hasPreviousPage}
								className={`h-9 px-3 text-sm border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
							>
								Previous
							</button>
							<span className="h-9 px-3 flex items-center text-sm" style={colors.text.primary.style}>
								Page {pagination.pageNumber} of {pagination.totalPages}
							</span>
							<button
								onClick={() => handlePageChange(pageNumber + 1)}
								disabled={!pagination.hasNextPage}
								className={`h-9 px-3 text-sm border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
							>
								Next
							</button>
						</div>
					</div>
				)}
			</div>

			<CreateSingleEmployeeDialog
				isOpen={showCreateDialog}
				onClose={() => setShowCreateDialog(false)}
				onSuccess={refetch}
			/>

			{selectedEmployee && (
				<EmployeeDetailDialog
					employee={selectedEmployee}
					hasAdminAccess={hasAdminAccess}
					onClose={() => setSelectedEmployee(null)}
					onRolesChanged={refetch}
				/>
			)}
		</div>
	);
}
