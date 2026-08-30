/**
 * HealthDashboard Component
 * Operational health view: date range picker, summary cards, compliance table, CSV export
 * Feature: 022-recurring-ritual-tasks-system-for
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
	Box,
	Typography,
	Button,
	Alert,
	CircularProgress,
	Card,
	CardContent,
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
	Paper,
	TextField,
	LinearProgress,
	Chip,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import {
	getOperationalHealth,
	getRitualComplianceSummary,
	exportRitualComplianceCSV,
	type OperationalHealthResult,
	type RitualHealthDetail,
	type EmployeeComplianceSummary,
} from 'apis';

// =============================================================================
// Summary Card
// =============================================================================

interface SummaryCardProps {
	label: string;
	value: string | number;
	color?: 'success' | 'error' | 'warning' | 'default';
	testId: string;
}

function SummaryCard({ label, value, color, testId }: SummaryCardProps) {
	const colors = useThemeColors();
	return (
		<Card variant="outlined" sx={{ flex: 1 }} data-testid={testId}>
			<CardContent>
				<Typography variant="h4" sx={{ fontWeight: 700, color: `${color ?? 'text'}.main` }}>
					{value}
				</Typography>
				<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
					{label}
				</Typography>
			</CardContent>
		</Card>
	);
}

// =============================================================================
// Main Component
// =============================================================================

export default function HealthDashboard() {
	const colors = useThemeColors();
	const router = useRouter();
	const { project } = useProjectContext();

	const defaultEnd = new Date();
	const defaultStart = new Date(defaultEnd);
	defaultStart.setDate(defaultStart.getDate() - 30);

	const [startDate, setStartDate] = useState(defaultStart.toISOString().slice(0, 10));
	const [endDate, setEndDate] = useState(defaultEnd.toISOString().slice(0, 10));
	const [health, setHealth] = useState<OperationalHealthResult | null>(null);
	const [compliance, setCompliance] = useState<EmployeeComplianceSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [exporting, setExporting] = useState(false);

	const load = useCallback(async () => {
		if (!project) return;
		setLoading(true);
		setError(null);
		try {
			const start = new Date(startDate);
			const end = new Date(endDate);
			const [h, c] = await Promise.all([
				getOperationalHealth(project.id, start, end),
				getRitualComplianceSummary(project.id, start, end),
			]);
			setHealth(h);
			setCompliance(c);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load health data');
		} finally {
			setLoading(false);
		}
	}, [project, startDate, endDate]);

	useEffect(() => {
		load();
	}, [load]);

	const topExceptions = useMemo(() => {
		if (!health) {
			return [];
		}

		return health.ritualDetails
			.filter((detail) => detail.overdueCount > 0 || detail.missedCount > 0)
			.sort(
				(left, right) =>
					right.overdueCount + right.missedCount - (left.overdueCount + left.missedCount)
			)
			.slice(0, 5);
	}, [health]);

	const reviewHref = project ? `/workspace/tasks/${project.id}?view=review` : '/workspace';
	const operationsHref = project
		? project.collaborationMode === 'ritual'
			? `/workspace/tasks/${project.id}?view=worklist`
			: `/workspace/tasks/${project.id}?view=today`
		: '/workspace';

	const handleExport = async () => {
		if (!project) return;
		setExporting(true);
		try {
			const blob = await exportRitualComplianceCSV(
				project.id,
				new Date(startDate),
				new Date(endDate)
			);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `compliance-${project.id}-${startDate}-${endDate}.csv`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Export failed');
		} finally {
			setExporting(false);
		}
	};

	return (
		<Box sx={{ p: 3 }} data-testid="health-dashboard">
			{/* Header */}
			<Box
				sx={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					mb: 2,
					flexWrap: 'wrap',
					gap: 1,
				}}
			>
				<Box>
					<Typography variant="h6" sx={{ ...colors.text.primary.style }}>
						Operational Health
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style, mt: 0.5 }}>
						Start with the exception summary below, then drill into the live ritual runs that need owner or reviewer attention.
					</Typography>
				</Box>
				<Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
					<TextField
						label="Start"
						type="date"
						size="small"
						value={startDate}
						onChange={(e) => setStartDate(e.target.value)}
						InputLabelProps={{ shrink: true }}
						inputProps={{ 'data-testid': 'health-start-date' }}
					/>
					<TextField
						label="End"
						type="date"
						size="small"
						value={endDate}
						onChange={(e) => setEndDate(e.target.value)}
						InputLabelProps={{ shrink: true }}
						inputProps={{ 'data-testid': 'health-end-date' }}
					/>
					<Button
						variant="outlined"
						startIcon={<DownloadIcon />}
						onClick={handleExport}
						disabled={exporting}
						data-testid="export-csv-btn"
					>
						{exporting ? <CircularProgress size={16} /> : 'Export CSV'}
					</Button>
				</Box>
			</Box>

			{error && (
				<Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
					{error}
				</Alert>
			)}

			{loading && <LinearProgress sx={{ mb: 2 }} />}

			{health && (
				<>
					{(health.summary.overdueCount > 0 || health.summary.missedCount > 0 || health.summary.pendingReviewCount > 0) && (
						<Alert
							severity={health.summary.missedCount > 0 || health.summary.overdueCount > 0 ? 'warning' : 'info'}
							sx={{ mb: 2.5 }}
							icon={<WarningAmberIcon fontSize="inherit" />}
							data-testid="health-owner-attention-alert"
							action={
								<Box sx={{ display: 'flex', gap: 1 }}>
									<Button color="inherit" size="small" onClick={() => router.push(reviewHref)} data-testid="health-open-review-btn">
										Open Review
									</Button>
									<Button color="inherit" size="small" onClick={() => router.push(operationsHref)} data-testid="health-open-operations-btn">
										Open Operations
									</Button>
								</Box>
							}
						>
							{health.summary.overdueCount} overdue, {health.summary.missedCount} missed, and {health.summary.pendingReviewCount} item{health.summary.pendingReviewCount === 1 ? '' : 's'} waiting for review across this project.
						</Alert>
					)}

					{/* Summary Cards */}
					<Box
						sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}
						data-testid="health-summary-cards"
					>
						<SummaryCard
							label="On-Time Rate"
							value={`${Math.round(health.summary.onTimeRate * 100)}%`}
							color={
								health.summary.onTimeRate >= 0.8
									? 'success'
									: health.summary.onTimeRate >= 0.5
									? 'warning'
									: 'error'
							}
							testId="compliance-rate-card"
						/>
						<SummaryCard
							label="Total Instances"
							value={health.summary.totalInstances}
							testId="total-instances-card"
						/>
						<SummaryCard
							label="On-Time"
							value={health.summary.onTimeCount}
							color="success"
							testId="completed-instances-card"
						/>
						<SummaryCard
							label="Missed"
							value={health.summary.missedCount}
							color={health.summary.missedCount > 0 ? 'error' : 'default'}
							testId="missed-instances-card"
						/>
						<SummaryCard
							label="Pending Review"
							value={health.summary.pendingReviewCount}
							color={health.summary.pendingReviewCount > 0 ? 'warning' : 'default'}
							testId="pending-review-card"
						/>
					</Box>

					{topExceptions.length > 0 && (
						<Box sx={{ mb: 3 }} data-testid="ritual-health-exceptions">
							<Typography
								variant="subtitle1"
								sx={{ ...colors.text.primary.style, fontWeight: 600, mb: 1 }}
							>
								Biggest Operational Exceptions
							</Typography>
							<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 1.5 }}>
								These ritual templates are driving the most overdue or missed live runs right now.
							</Typography>
							<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
								{topExceptions.map((detail) => (
									<Paper key={detail.ritualDefinitionId} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }} data-testid={`ritual-health-exception-${detail.ritualDefinitionId}`}>
										<Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
											<Box>
												<Typography variant="subtitle2" sx={{ ...colors.text.primary.style, fontWeight: 600 }}>
													{detail.ritualName}
												</Typography>
												<Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.75 }}>
													<Chip icon={<CancelIcon />} label={`${detail.overdueCount} overdue`} size="small" color={detail.overdueCount > 0 ? 'warning' : 'default'} />
													<Chip icon={<SkipNextIcon />} label={`${detail.missedCount} missed`} size="small" color={detail.missedCount > 0 ? 'error' : 'default'} />
													<Chip icon={<CheckCircleIcon />} label={`${detail.verifiedCount} verified`} size="small" variant="outlined" />
													<Chip label={`Health ${Math.round(detail.healthScore * 100)}%`} size="small" variant="outlined" />
												</Box>
											</Box>
											<Button size="small" variant="outlined" onClick={() => router.push(operationsHref)}>
												Inspect Runs
											</Button>
										</Box>
									</Paper>
								))}
							</Box>
						</Box>
					)}

					{/* Per-ritual health table */}
					{health.ritualDetails && health.ritualDetails.length > 0 && (
						<Box sx={{ mb: 3 }}>
							<Typography
								variant="subtitle1"
								sx={{ ...colors.text.primary.style, fontWeight: 600, mb: 1 }}
							>
								By Ritual Template
							</Typography>
							<TableContainer
								component={Paper}
								variant="outlined"
								data-testid="ritual-health-table"
							>
								<Table size="small">
									<TableHead>
										<TableRow>
											<TableCell>Ritual</TableCell>
											<TableCell align="right">Health Score</TableCell>
											<TableCell align="right">Verified</TableCell>
											<TableCell align="right">Overdue</TableCell>
											<TableCell align="right">Missed</TableCell>
										</TableRow>
									</TableHead>
									<TableBody>
										{health.ritualDetails.map((rd: RitualHealthDetail) => (
											<TableRow
												key={rd.ritualDefinitionId}
												data-testid={`ritual-health-row-${rd.ritualDefinitionId}`}
											>
												<TableCell>{rd.ritualName}</TableCell>
												<TableCell align="right">
													<Chip
														label={`${Math.round(rd.healthScore * 100)}%`}
														color={
															rd.healthScore >= 0.8
																? 'success'
																: rd.healthScore >= 0.5
																? 'warning'
																: 'error'
														}
														size="small"
													/>
												</TableCell>
												<TableCell align="right">
													<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
														<CheckCircleIcon color="success" sx={{ fontSize: 16 }} />
														{rd.verifiedCount}
													</Box>
												</TableCell>
												<TableCell align="right">
													<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
														<CancelIcon color="error" sx={{ fontSize: 16 }} />
														{rd.overdueCount}
													</Box>
												</TableCell>
												<TableCell align="right">
													<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
														<SkipNextIcon color="warning" sx={{ fontSize: 16 }} />
														{rd.missedCount}
													</Box>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</TableContainer>
						</Box>
					)}
				</>
			)}

			{/* Per-employee compliance table */}
			{compliance.length > 0 && (
				<Box>
					<Typography
						variant="subtitle1"
						sx={{ ...colors.text.primary.style, fontWeight: 600, mb: 1 }}
					>
						Employee Compliance
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 1.5 }}>
						Use this table after triaging exceptions to see which assignees need follow-up across the selected range.
					</Typography>
					<TableContainer
						component={Paper}
						variant="outlined"
						data-testid="employee-compliance-table"
					>
						<Table size="small">
							<TableHead>
								<TableRow>
									<TableCell>Employee</TableCell>
									<TableCell align="right">Assigned</TableCell>
									<TableCell align="right">Completed</TableCell>
									<TableCell align="right">Missed</TableCell>
									<TableCell align="right">Rate</TableCell>
								</TableRow>
							</TableHead>
							<TableBody>
								{compliance.map((emp) => (
									<TableRow
										key={emp.employeeId}
										data-testid={`employee-compliance-row-${emp.employeeId}`}
									>
										<TableCell>{emp.employeeName || 'Unknown employee'}</TableCell>
										<TableCell align="right">{emp.totalAssigned}</TableCell>
										<TableCell align="right">{emp.completedOnTime + emp.completedLate}</TableCell>
										<TableCell align="right">{emp.missedCount}</TableCell>
										<TableCell align="right">
											<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
												<LinearProgress
													variant="determinate"
													value={emp.complianceRate * 100}
													color={
														emp.complianceRate >= 0.8
															? 'success'
															: emp.complianceRate >= 0.5
															? 'warning'
															: 'error'
													}
													sx={{ flex: 1, height: 6, borderRadius: 3 }}
												/>
												<Typography variant="caption">
													{Math.round(emp.complianceRate * 100)}%
												</Typography>
											</Box>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableContainer>
				</Box>
			)}

			{!loading && !health && !error && (
				<Box
					sx={{ textAlign: 'center', py: 6, ...colors.text.secondary.style }}
					data-testid="health-empty"
				>
					<PendingActionsIcon sx={{ fontSize: 48, mb: 2, opacity: 0.4 }} />
					<Typography>No health data for the selected range.</Typography>
				</Box>
			)}
		</Box>
	);
}
