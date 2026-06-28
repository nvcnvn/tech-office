/**
 * Employee Import Dialog
 * Modal dialog for bulk importing employees
 * 
 * @deprecated This dialog-based approach has been replaced with a dedicated page
 * at /workspace/organization/import-employees for better UX in complex workflows.
 * This file is kept for reference but should not be used in new code.
 * 
 * See: frontend/apps/web/src/app/workspace/organization/import-employees/page.tsx
 */

'use client';

import React, { useState } from 'react';
import { useRequireAuth } from '@/lib/auth/hooks';
import {
	previewEmployeeImport,
	executeEmployeeImport,
	type EmployeeData,
	type PreviewEmployeeImportResponse,
	type ExecuteEmployeeImportResponse,
} from 'apis';
import ManualEntryForm from './import/ManualEntryForm';
import FileUploadForm from './import/FileUploadForm';
import PreviewTable from './import/PreviewTable';
import ResultsDisplay from './import/ResultsDisplay';

// Plain interface for form data (not proto message)
interface EmployeeFormData {
	email: string;
	givenName: string;
	familyName: string;
}

const steps = ['Enter Data', 'Preview & Confirm', 'Results'];

interface EmployeeImportDialogProps {
	onClose: () => void;
	onSuccess: () => void;
}

export default function EmployeeImportDialog({ onClose, onSuccess }: EmployeeImportDialogProps) {
	const { user } = useRequireAuth();
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
						<h3 className="text-lg font-semibold text-gray-900 mb-2">Step 1: Enter Employee Data</h3>
						<p className="text-sm text-gray-600 mb-4">
							You can either manually enter employee details or upload an Excel file (.xlsx) with email, given name, and family name columns.
						</p>

						{/* Custom Tabs */}
						<div className="border-b border-gray-200 mb-6">
							<div className="flex gap-4">
								<button
									onClick={() => setEntryTab(0)}
									className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${entryTab === 0
										? 'border-blue-600 text-blue-600'
										: 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
										}`}
								>
									Manual Entry
								</button>
								<button
									onClick={() => setEntryTab(1)}
									className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${entryTab === 1
										? 'border-blue-600 text-blue-600'
										: 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
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
						<h3 className="text-lg font-semibold text-gray-900 mb-2">Step 2: Preview & Confirm</h3>
						<p className="text-sm text-gray-600 mb-4">
							Review the employee data. Duplicates and validation errors are highlighted.
						</p>
						{previewData ? (
							<PreviewTable previewData={previewData} />
						) : (
							<div className="bg-white border border-gray-200 rounded-lg p-6 mt-4">
								<p className="text-gray-600">Loading preview...</p>
							</div>
						)}
					</div>
				);
			case 2:
				return (
					<div>
						<h3 className="text-lg font-semibold text-gray-900 mb-2">Step 3: Import Results</h3>
						{importResults ? (
							<ResultsDisplay importResults={importResults} />
						) : (
							<div className="bg-white border border-gray-200 rounded-lg p-6 mt-4">
								<p className="text-gray-600">Loading results...</p>
							</div>
						)}
					</div>
				);
			default:
				return <p className="text-gray-600">Unknown step</p>;
		}
	};

	return (
		<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
			<div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col">
				{/* Header */}
				<div className="p-6 border-b border-gray-200">
					<div className="flex items-center justify-between">
						<div>
							<h2 className="text-2xl font-bold text-gray-900">Import Employees</h2>
							<p className="text-sm text-gray-600 mt-1">
								Bulk import employees to your organization. Maximum 100 employees per batch.
							</p>
						</div>
						<button
							onClick={onClose}
							className="text-gray-400 hover:text-gray-600"
						>
							<span className="text-2xl">×</span>
						</button>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-auto p-6">
					<div className="max-w-5xl mx-auto">
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
														: 'bg-gray-200 text-gray-600'
													}`}
											>
												{index < activeStep ? '✓' : index + 1}
											</div>
											<div className="ml-3">
												<p
													className={`text-sm font-medium ${index <= activeStep ? 'text-gray-900' : 'text-gray-500'
														}`}
												>
													{label}
												</p>
											</div>
										</div>
										{index < steps.length - 1 && (
											<div
												className={`flex-1 h-1 mx-4 ${index < activeStep ? 'bg-green-500' : 'bg-gray-200'
													}`}
											/>
										)}
									</React.Fragment>
								))}
							</div>
						</div>

						{/* Error Display */}
						{error && (
							<div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
								<p className="text-red-700">{error}</p>
							</div>
						)}

						{/* Step Content */}
						{renderStepContent(activeStep)}
					</div>
				</div>

				{/* Footer with Navigation */}
				<div className="p-6 border-t border-gray-200">
					<div className="flex justify-between">
						<button
							disabled={activeStep === 0 || loading}
							onClick={handleBack}
							className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							Back
						</button>
						<div className="flex gap-3">
							{activeStep === steps.length - 1 ? (
								<>
									<button
										onClick={() => {
											onSuccess();
											onClose();
										}}
										className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
									>
										Done
									</button>
									<button
										onClick={handleReset}
										className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
									>
										Import More
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
									className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{loading ? 'Loading...' : activeStep === 1 ? 'Confirm Import' : 'Next: Preview'}
								</button>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
