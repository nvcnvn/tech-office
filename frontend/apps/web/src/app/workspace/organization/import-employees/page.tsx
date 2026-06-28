/**
 * Employee Import Page
 * Dedicated page for bulk importing employees
 */

'use client';

// Force dynamic rendering for this page
export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth/hooks';
import TabLink from '@/components/TabLink';
import { useThemeColors } from '@/theme/useThemeColors';
import {
	previewEmployeeImport,
	executeEmployeeImport,
	type EmployeeData,
	type PreviewEmployeeImportResponse,
	type ExecuteEmployeeImportResponse,
} from 'apis';
import ManualEntryForm from '../components/import/ManualEntryForm';
import FileUploadForm from '../components/import/FileUploadForm';
import PreviewTable from '../components/import/PreviewTable';
import ResultsDisplay from '../components/import/ResultsDisplay';

// Plain interface for form data (not proto message)
interface EmployeeFormData {
	email: string;
	givenName: string;
	familyName: string;
}

const steps = ['Enter Data', 'Preview & Confirm', 'Results'];

export default function ImportEmployeesPage() {
	const router = useRouter();
	const { user } = useRequireAuth();
	const colors = useThemeColors();
	const organizationId = user?.organizationId;
	const [activeStep, setActiveStep] = useState(0);
	const [entryTab, setEntryTab] = useState(0); // 0 = manual, 1 = file upload
	const [employees, setEmployees] = useState<EmployeeFormData[]>([]);
	const [previewData, setPreviewData] = useState<PreviewEmployeeImportResponse | null>(null);
	const [importResults, setImportResults] = useState<ExecuteEmployeeImportResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleNext = () => {
		setActiveStep((prevActiveStep) => prevActiveStep + 1);
	};

	const handleBack = () => {
		setActiveStep((prevActiveStep) => prevActiveStep - 1);
	};

	const handleReset = () => {
		setActiveStep(0);
		setEntryTab(0);
		setEmployees([]);
		setPreviewData(null);
		setImportResults(null);
		setError(null);
	};

	const handleCancel = () => {
		router.push('/workspace/organization?tab=employees');
	};

	const handleManualEntryChange = (employeeData: EmployeeFormData[]) => {
		setEmployees(employeeData);
	};

	const handleFileUploadChange = (employeeData: EmployeeFormData[]) => {
		setEmployees(employeeData);
	};

	const handlePreview = async () => {
		if (!organizationId) {
			setError('Organization ID not found');
			return;
		}

		if (employees.length === 0) {
			setError('No employee data to preview');
			return;
		}

		setLoading(true);
		setError(null);

		try {
			const response = await previewEmployeeImport(organizationId, employees as EmployeeData[]);
			setPreviewData(response);
			handleNext();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to preview employee data');
		} finally {
			setLoading(false);
		}
	};

	const handleConfirmImport = async () => {
		if (!organizationId) {
			setError('Organization ID not found');
			return;
		}

		if (!previewData || (previewData.stats?.validCount || 0) === 0) {
			setError('No valid employees to import');
			return;
		}

		setLoading(true);
		setError(null);

		try {
			// Use the parsed and validated employee data from preview response
			// PreviewEmployeeImport already handled date format parsing and validation
			const validEmployees = previewData.items
				?.filter(item => item.willBeImported)
				.map(item => item.employee as EmployeeData) || [];

			const response = await executeEmployeeImport(organizationId, validEmployees);
			setImportResults(response);
			handleNext();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to import employees');
		} finally {
			setLoading(false);
		}
	};

	const renderStepContent = (step: number) => {
		switch (step) {
			case 0:
				return (
					<div>
						<h3 className="text-lg font-semibold mb-2" style={colors.text.primary.style}>Step 1: Enter Employee Data</h3>
						<p className="text-sm mb-4" style={colors.text.secondary.style}>
							You can either manually enter employee details or upload an Excel file (.xlsx) with email, given name, and family name columns.
						</p>

						{/* Custom Tabs */}
						<div className="mb-6" style={{ ...colors.border.default.style, borderBottomWidth: '1px' }}>
							<div className="flex gap-4">
								<button
									onClick={() => setEntryTab(0)}
									className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${entryTab === 0
										? colors.primary.text.className + ' border-current'
										: colors.text.secondary.className + ' border-transparent hover:opacity-80'
										}`}
								>
									Manual Entry
								</button>
								<button
									onClick={() => setEntryTab(1)}
									className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${entryTab === 1
										? colors.primary.text.className + ' border-current'
										: colors.text.secondary.className + ' border-transparent hover:opacity-80'
										}`}
								>
									File Upload
								</button>
							</div>
						</div>

						{entryTab === 0 ? (
							<ManualEntryForm onChange={handleManualEntryChange} />
						) : (
							<FileUploadForm onChange={handleFileUploadChange} />
						)}
					</div>
				);
			case 1:
				return (
					<div>
						<h3 className="text-lg font-semibold mb-2" style={colors.text.primary.style}>Step 2: Preview & Confirm</h3>
						<p className="text-sm mb-4" style={colors.text.secondary.style}>
							Review the employee data. Duplicates and validation errors are highlighted.
						</p>
						{previewData ? (
							<PreviewTable previewData={previewData} />
						) : (
							<div className="rounded-lg p-6 mt-4" style={{ ...colors.bg.paper.style, ...colors.border.default.style, borderWidth: '1px' }}>
								<p style={colors.text.secondary.style}>Loading preview...</p>
							</div>
						)}
					</div>
				);
			case 2:
				return (
					<div>
						<h3 className="text-lg font-semibold mb-2" style={colors.text.primary.style}>Step 3: Import Results</h3>
						{importResults ? (
							<ResultsDisplay importResults={importResults} />
						) : (
							<div className="rounded-lg p-6 mt-4" style={{ ...colors.bg.paper.style, ...colors.border.default.style, borderWidth: '1px' }}>
								<p style={colors.text.secondary.style}>Loading results...</p>
							</div>
						)}
					</div>
				);
			default:
				return <p style={colors.text.secondary.style}>Unknown step</p>;
		}
	};

	// Organization tabs configuration
	const organizationTabs = [
		{ id: 'overview', label: 'Overview', icon: '📊' },
		{ id: 'employees', label: 'Employees', icon: '👥' },
		{ id: 'departments', label: 'Departments', icon: '🏢' },
		{ id: 'permissions', label: 'Permissions', icon: '🔑' },
	];

	return (
		<div className="h-full flex flex-col overflow-auto" style={colors.bg.paper.style}>
			{/* Header with Organization Tabs */}
			<div className="p-6" style={{ ...colors.border.default.style, borderBottomWidth: '1px' }}>
				<div className="flex items-center justify-between mb-4">
					<div>
						<h1 className="text-2xl font-bold" style={colors.text.primary.style}>Organization</h1>
						<p className="text-sm" style={colors.text.secondary.style}>Manage your organization settings and team</p>
					</div>
					<div className="flex gap-2">
						<button className={`px-4 py-2 border rounded-lg text-sm ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}>
							Settings
						</button>
					</div>
				</div>
				{/* Tab Navigation - same as Organization page */}
				<div className="flex gap-2">
					{organizationTabs.map((tab) => (
						<TabLink
							key={tab.id}
							id={tab.id}
							label={tab.label}
							icon={tab.icon}
							href={`/workspace/organization?tab=${tab.id}`}
							isActive={tab.id === 'employees'}
						/>
					))}
				</div>
			</div>

			{/* Page Title - Import Employees */}
			<div className="px-6 pt-6">
				<div className="max-w-6xl mx-auto">
					<button
						onClick={handleCancel}
						className={`text-sm mb-2 flex items-center gap-1 ${colors.text.secondary.className} hover:opacity-80`}
					>
						<span>←</span>
						<span>Back to Employees</span>
					</button>
					<h2 className="text-xl font-semibold mb-1" style={colors.text.primary.style}>Import Employees</h2>
					<p className="text-sm" style={colors.text.secondary.style}>
						Bulk import employees to your organization. Maximum 100 employees per batch.
					</p>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-auto p-6">
				<div className="max-w-6xl mx-auto">
					<div className="rounded-lg shadow-sm p-8" style={{ ...colors.bg.paper.style, ...colors.border.default.style, borderWidth: '1px' }}>
						{/* Stepper */}
						<div className="mb-8">
							<div className="flex items-center justify-between">
								{steps.map((label, index) => (
									<React.Fragment key={label}>
										<div className="flex items-center">
											<div
												className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${index < activeStep
													? 'bg-green-500 text-white'
													: index === activeStep
														? 'bg-blue-600 text-white'
														: ''
													}`}
												style={index >= activeStep && index !== activeStep ? { ...colors.bg.active.style, ...colors.text.secondary.style } : {}}
											>
												{index < activeStep ? '✓' : index + 1}
											</div>
											<div className="ml-3">
												<p
													className="text-sm font-medium"
													style={index <= activeStep ? colors.text.primary.style : colors.text.hint.style}
												>
													{label}
												</p>
											</div>
										</div>
										{index < steps.length - 1 && (
											<div
												className={`flex-1 h-1 mx-4 ${index < activeStep ? 'bg-green-500' : ''}`}
												style={index >= activeStep ? colors.bg.active.style : {}}
											/>
										)}
									</React.Fragment>
								))}
							</div>
						</div>

						{/* Error Display */}
						{error && (
							<div className={`mb-6 p-4 rounded-lg ${colors.status.error.bg} ${colors.status.error.border} border`}>
								<p className={colors.status.error.text}>{error}</p>
							</div>
						)}

						{/* Step Content */}
						<div className="mb-8">{renderStepContent(activeStep)}</div>

						{/* Footer with Navigation */}
						<div className="flex justify-between pt-6" style={{ ...colors.border.default.style, borderTopWidth: '1px' }}>
							<button
								disabled={activeStep === 0 || loading}
								onClick={handleBack}
								className={`px-6 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
							>
								Back
							</button>
							<div className="flex gap-3">
								{activeStep !== steps.length - 1 && (
									<button
										onClick={handleCancel}
										className={`px-6 py-2 border rounded-lg ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
									>
										Cancel
									</button>
								)}
								{activeStep === steps.length - 1 ? (
									<>
										<button
											onClick={handleReset}
											className={`px-6 py-2 border rounded-lg ${colors.button.secondary.bg} ${colors.button.secondary.border} ${colors.button.secondary.text}`}
										>
											Import More
										</button>
										<button
											onClick={() => router.push('/workspace/organization?tab=employees')}
											className={`px-6 py-2 rounded-lg ${colors.button.primary.bg} ${colors.button.primary.text}`}
										>
											Done
										</button>
									</>
								) : (
									<button
										onClick={activeStep === 0 ? handlePreview : handleConfirmImport}
										disabled={
											loading ||
											(activeStep === 0 && employees.length === 0) ||
											(activeStep === 1 && (previewData?.stats?.validCount || 0) === 0)
										}
										className={`px-6 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${colors.button.primary.bg} ${colors.button.primary.text}`}
									>
										{loading ? 'Loading...' : activeStep === 1 ? 'Confirm Import' : 'Next: Preview'}
									</button>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
