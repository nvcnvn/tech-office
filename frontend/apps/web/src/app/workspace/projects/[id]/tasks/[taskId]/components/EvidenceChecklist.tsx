/**
 * EvidenceChecklist Component
 * Shows evidence requirements for a ritual instance task, handles submission
 * Feature: 022-recurring-ritual-tasks-system-for
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
	Box,
	Typography,
	List,
	ListItem,
	ListItemIcon,
	ListItemText,
	Chip,
	Alert,
	CircularProgress,
	Button,
	Stack,
	TextField,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { useThemeColors } from '@/theme/useThemeColors';
import {
	listEvidenceRequirements,
	listEvidenceSubmissions,
	approveEvidence,
	rejectEvidence,
	getDownloadUrl,
	type EvidenceRequirementDetail,
	type EvidenceSubmission,
	type ApprovalStatus,
} from 'apis';
import EvidenceSubmitForm from './EvidenceSubmitForm';

// =============================================================================
// Approval Status Badge
// =============================================================================

function ApprovalBadge({ status }: { status: ApprovalStatus }) {
	const colorMap: Record<ApprovalStatus, 'default' | 'warning' | 'success' | 'error'> = {
		pending_review: 'warning',
		approved: 'success',
		rejected: 'error',
	};
	const labelMap: Record<ApprovalStatus, string> = {
		pending_review: 'Pending Review',
		approved: 'Approved',
		rejected: 'Rejected',
	};
	return (
		<Chip
			label={labelMap[status]}
			color={colorMap[status]}
			size="small"
			data-testid={`approval-badge-${status}`}
		/>
	);
}

function formatEvidenceTypeLabel(type: EvidenceRequirementDetail['evidenceTypes'][number]): string {
	switch (type) {
		case 'text_note':
			return 'Note';
		case 'gps_checkin':
			return 'GPS';
		case 'voice_memo':
			return 'Voice';
		case 'pdf':
			return 'PDF';
		case 'file':
			return 'File';
		case 'photo':
			return 'Photo';
		case 'link':
			return 'Link';
	}
}

function EvidenceTypeIcon({ type }: { type: EvidenceRequirementDetail['evidenceTypes'][number] }) {
	switch (type) {
		case 'photo':
			return <ImageOutlinedIcon sx={{ fontSize: 14 }} />;
		case 'link':
			return <LinkOutlinedIcon sx={{ fontSize: 14 }} />;
		case 'gps_checkin':
			return <PlaceOutlinedIcon sx={{ fontSize: 14 }} />;
		case 'text_note':
			return <DescriptionOutlinedIcon sx={{ fontSize: 14 }} />;
		default:
			return <AttachFileOutlinedIcon sx={{ fontSize: 14 }} />;
	}
}

function formatSubmissionHelper(submission: EvidenceSubmission | undefined, required: boolean): string {
	if (!submission) {
		return required ? 'Still missing proof for this ritual step.' : 'Optional proof you can add if it helps reviewers.';
	}

	if (submission.approvalStatus === 'pending_review') {
		return 'Proof received and waiting for review on this task instance.';
	}

	if (submission.approvalStatus === 'approved') {
		return 'Proof approved for this task instance.';
	}

	return submission.reviewerComment || 'Rejected proof needs an updated submission.';
}

function formatSubmissionSummary(submission: EvidenceSubmission): string {
	if (submission.linkUrl) {
		return submission.linkUrl;
	}

	if (submission.textContent) {
		return submission.textContent;
	}

	if (submission.fileId) {
		return 'File evidence attached';
	}

	if (submission.gpsCoordinates) {
		return `GPS check-in at ${submission.gpsCoordinates.latitude.toFixed(4)}, ${submission.gpsCoordinates.longitude.toFixed(4)}`;
	}

	return 'Submission ready for review';
}

function formatSubmissionTimestamp(submission: EvidenceSubmission): string | null {
	if (!submission.serverTimestamp) {
		return null;
	}

	return submission.serverTimestamp.toLocaleString();
}

function formatSubmissionDetail(submission: EvidenceSubmission): string {
	if (submission.textContent?.trim()) {
		return submission.textContent.trim();
	}

	if (submission.linkUrl?.trim()) {
		return submission.linkUrl.trim();
	}

	if (submission.gpsCoordinates) {
		if (Number.isFinite(submission.gpsCoordinates.accuracyMeters) && submission.gpsCoordinates.accuracyMeters > 0) {
			return `Pinned location, accurate to about ${Math.round(submission.gpsCoordinates.accuracyMeters)} m.`;
		}

		return 'Pinned check-in location recorded for this task instance.';
	}

	if (submission.fileId) {
		return submission.evidenceType === 'photo' ? 'Photo attached for this task instance.' : 'File attached for this task instance.';
	}

	return 'Submission ready for review';
}

function buildGpsMapUrl(submission: EvidenceSubmission): string | null {
	if (!submission.gpsCoordinates) {
		return null;
	}

	const { latitude, longitude } = submission.gpsCoordinates;
	return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

function formatReviewExpectation(submission: EvidenceSubmission): string {
	if (submission.fileId && submission.gpsCoordinates) {
		return 'Check both the pinned location and the uploaded proof before approving this step.';
	}

	if (submission.fileId) {
		return 'Open the attached proof and confirm it matches the work claimed for this step.';
	}

	if (submission.gpsCoordinates) {
		return 'Open the pinned location and confirm the check-in happened where this step was expected.';
	}

	if (submission.linkUrl) {
		return 'Open the submitted link and confirm it supports the required evidence for this step.';
	}

	if (submission.textContent) {
		return 'Read the submitted note and confirm it is enough proof for this ritual step.';
	}

	return 'Review the submitted evidence and decide whether this ritual step is proven.';
}

function formatEvidenceKindLabel(submission: EvidenceSubmission): string {
	switch (submission.evidenceType) {
		case 'photo':
			return 'Photo proof';
		case 'gps_checkin':
			return 'GPS check-in';
		case 'link':
			return 'Link evidence';
		case 'text_note':
			return 'Written note';
		case 'file':
			return 'File attachment';
		case 'voice_memo':
			return 'Voice memo';
		case 'pdf':
			return 'PDF document';
		default:
			return 'Submitted evidence';
	}
}

// =============================================================================
// Per-requirement row
// =============================================================================

interface RequirementRowProps {
	req: EvidenceRequirementDetail;
	taskId: string;
	submission?: EvidenceSubmission;
	onSubmitted: () => void;
	canSubmit: boolean;
	canReview: boolean;
	autoOpen?: boolean;
	highlighted?: boolean;
}

function RequirementRow({
	req,
	taskId,
	submission,
	onSubmitted,
	canSubmit,
	canReview,
	autoOpen,
	highlighted = false,
}: RequirementRowProps) {
	const colors = useThemeColors();
	const [submitOpen, setSubmitOpen] = useState(false);
	const [reviewNote, setReviewNote] = useState('');
	const [reviewLoading, setReviewLoading] = useState(false);
	const [reviewError, setReviewError] = useState<string | null>(null);
	const [openingAttachment, setOpeningAttachment] = useState(false);

	useEffect(() => {
		if (autoOpen && canSubmit && (!submission || submission.approvalStatus === 'rejected')) {
			setSubmitOpen(true);
		}
	}, [autoOpen, canSubmit, submission]);

	const submitted = !!submission;
	const approved =
		submission?.approvalStatus === 'approved';
	const rejected = submission?.approvalStatus === 'rejected';
	const pending = submission?.approvalStatus === 'pending_review';
	const borderColor = approved
		? 'success.main'
		: rejected
			? 'error.main'
			: pending
				? 'warning.main'
				: 'divider';
	const actionLabel = rejected ? 'Resubmit Proof' : 'Submit Proof';

	const handleOpenAttachment = async () => {
		if (!submission?.fileId || openingAttachment) {
			return;
		}

		setOpeningAttachment(true);
		setReviewError(null);
		try {
			const { downloadUrl } = await getDownloadUrl(submission.fileId);
			window.open(downloadUrl, '_blank', 'noopener,noreferrer');
		} catch (err) {
			setReviewError(err instanceof Error ? err.message : 'Could not open submission');
		} finally {
			setOpeningAttachment(false);
		}
	};

	const handleReviewAction = async (action: 'approve' | 'reject') => {
		if (!submission) {
			return;
		}

		setReviewLoading(true);
		setReviewError(null);
		try {
			if (action === 'approve') {
				await approveEvidence(submission.id, reviewNote);
			} else {
				await rejectEvidence(submission.id, reviewNote);
			}
			setReviewNote('');
			onSubmitted();
		} catch (err) {
			setReviewError(err instanceof Error ? err.message : 'Review action failed');
		} finally {
			setReviewLoading(false);
		}
	};

	return (
		<ListItem
			alignItems="flex-start"
			sx={{
				flexDirection: 'column',
				px: 1.5,
				py: 1.5,
				mb: 1,
				borderRadius: 1.5,
				border: '1px solid',
				borderColor: highlighted ? 'primary.main' : borderColor,
				boxShadow: highlighted ? '0 0 0 1px rgba(25, 118, 210, 0.24)' : 'none',
				...colors.bg.paper.style,
			}}
			data-testid={`evidence-req-row-${req.id}`}
			data-highlighted-requirement={highlighted ? 'true' : undefined}
		>
			<Box sx={{ display: 'flex', alignItems: 'flex-start', width: '100%', gap: 1 }}>
				<ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>
					{approved ? (
						<CheckCircleIcon color="success" />
					) : rejected ? (
						<ErrorOutlineIcon color="error" />
					) : (
						<RadioButtonUncheckedIcon sx={{ ...colors.text.secondary.style }} />
					)}
				</ListItemIcon>
				<ListItemText
					primary={
						<Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
							<Typography variant="subtitle2" sx={{ ...colors.text.primary.style }}>
								{req.name}
							</Typography>
							{req.evidenceTypes.map((type) => (
								<Chip
									key={`${req.id}-${type}`}
									icon={<EvidenceTypeIcon type={type} />}
									label={formatEvidenceTypeLabel(type)}
									size="small"
									variant="outlined"
									data-testid={`evidence-type-chip-${req.id}-${type}`}
								/>
							))}
							{req.isRequired && (
								<Chip label="Required" color="error" size="small" />
							)}
							{!submission && (
								<Chip label="Missing Proof" size="small" color="default" />
							)}
						</Box>
					}
					secondary={
						<Box>
							{req.description && (
								<Typography
									variant="body2"
									sx={{ ...colors.text.secondary.style, mt: 0.25 }}
								>
									{req.description}
								</Typography>
							)}
							<Typography variant="body2" sx={{ ...colors.text.secondary.style, mt: 0.75 }}>
								{formatSubmissionHelper(submission, req.isRequired)}
							</Typography>
							{submission && (
								<Stack direction="row" spacing={1} sx={{ mt: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
									<ApprovalBadge status={submission.approvalStatus} />
									{formatSubmissionTimestamp(submission) && (
										<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
											Updated {formatSubmissionTimestamp(submission)}
										</Typography>
									)}
								{submission.reviewerComment && (
									<Typography
										variant="caption"
										sx={{ ...colors.text.secondary.style }}
									>
										Note: {submission.reviewerComment}
										</Typography>
									)}
								</Stack>
							)}
							{submission && (
								<Box
									sx={{
										mt: 1,
										p: 1.5,
										borderRadius: 2,
										background: pending
											? 'linear-gradient(180deg, rgba(255,248,230,0.95) 0%, rgba(255,255,255,1) 100%)'
											: 'linear-gradient(180deg, rgba(246,248,250,1) 0%, rgba(255,255,255,1) 100%)',
										border: '1px solid',
										borderColor: pending ? 'warning.light' : 'divider',
										boxShadow: pending ? '0 10px 24px rgba(245, 158, 11, 0.12)' : 'none',
									}}
									data-testid={`submission-preview-${submission.id}`}
								>
									<Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.25 }}>
										<Box>
											<Typography variant="caption" sx={{ ...colors.text.secondary.style, display: 'block', fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
												{pending ? 'Reviewer action needed' : 'Latest submission'}
											</Typography>
											<Typography variant="subtitle2" sx={{ ...colors.text.primary.style, mt: 0.25, fontWeight: 700 }}>
												{formatEvidenceKindLabel(submission)}
											</Typography>
										</Box>
										{pending ? (
											<Chip
												icon={<FactCheckOutlinedIcon sx={{ fontSize: 16 }} />}
												label="Awaiting decision"
												size="small"
												color="warning"
												variant="filled"
											/>
										) : null}
									</Stack>

									{pending ? (
										<Box
											sx={{
												mb: 1.25,
												p: 1,
												borderRadius: 1.5,
												backgroundColor: 'rgba(255,255,255,0.82)',
												border: '1px dashed',
												borderColor: 'warning.light',
											}}
										>
											<Typography variant="caption" sx={{ color: 'warning.dark', fontWeight: 700, display: 'block', mb: 0.25 }}>
												What to verify
											</Typography>
											<Typography variant="body2" sx={{ ...colors.text.primary.style }}>
												{formatReviewExpectation(submission)}
											</Typography>
										</Box>
									) : null}

									<Box
										sx={{
											p: 1.25,
											borderRadius: 1.5,
											backgroundColor: 'rgba(255,255,255,0.82)',
											border: '1px solid',
											borderColor: 'divider',
										}}
					>
										<Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.75, flexWrap: 'wrap' }}>
											<Typography variant="caption" sx={{ ...colors.text.secondary.style, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>
												Submitted content
											</Typography>
											{formatSubmissionTimestamp(submission) && (
												<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
													Updated {formatSubmissionTimestamp(submission)}
												</Typography>
											)}
										</Stack>
										<Typography variant="body2" sx={{ ...colors.text.primary.style, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
											{formatSubmissionDetail(submission)}
										</Typography>
										<Stack direction="row" spacing={1} sx={{ mt: 1.25, flexWrap: 'wrap' }}>
											{submission.gpsCoordinates && buildGpsMapUrl(submission) && (
												<Button
													size="small"
													variant="outlined"
													component="a"
													href={buildGpsMapUrl(submission) ?? undefined}
													target="_blank"
													rel="noreferrer"
													startIcon={<PlaceOutlinedIcon />}
													endIcon={<OpenInNewRoundedIcon />}
												>
													Open pinned location
												</Button>
											)}
											{submission.linkUrl && (
												<Button
													size="small"
													variant="outlined"
													component="a"
													href={submission.linkUrl}
													target="_blank"
													rel="noreferrer"
													startIcon={<LinkOutlinedIcon />}
													endIcon={<OpenInNewRoundedIcon />}
												>
													Open submitted link
												</Button>
											)}
											{submission.fileId && (
												<Button
													size="small"
													variant="contained"
													color={pending ? 'warning' : 'primary'}
													onClick={() => void handleOpenAttachment()}
													disabled={openingAttachment}
													startIcon={submission.evidenceType === 'photo' ? <ImageOutlinedIcon /> : <AttachFileOutlinedIcon />}
												>
													{openingAttachment
														? 'Opening...'
														: submission.evidenceType === 'photo'
															? 'Open submitted photo'
															: 'Open submitted file'}
												</Button>
											)}
										</Stack>
									</Box>
								</Box>
							)}
							{submission && canReview && pending && (
								<Box
									sx={{
										mt: 1.25,
										p: 1.5,
										border: '1px solid',
										borderColor: 'warning.light',
										borderRadius: 2,
										backgroundColor: 'rgba(255, 248, 230, 0.55)',
									}}
									data-testid={`inline-review-controls-${submission.id}`}
								>
									<Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
										<FactCheckOutlinedIcon color="warning" fontSize="small" />
										<Box>
											<Typography variant="body2" sx={{ ...colors.text.primary.style, fontWeight: 700 }}>
												Review decision
											</Typography>
											<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
												Approve if the proof is enough. Reject if it needs correction or a clearer resubmission.
											</Typography>
										</Box>
									</Stack>
									<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 1 }}>
										{formatSubmissionSummary(submission)}
									</Typography>
									{reviewError && (
										<Alert severity="error" sx={{ mt: 1 }} onClose={() => setReviewError(null)}>
											{reviewError}
										</Alert>
									)}
									<TextField
										fullWidth
										multiline
										rows={2}
										label="Review note (optional)"
										value={reviewNote}
										onChange={(e) => setReviewNote(e.target.value)}
										size="small"
										sx={{ mt: 1, mb: 1.25 }}
										inputProps={{ 'data-testid': `review-note-input-${submission.id}` }}
									/>
									<Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
										<Button
											size="medium"
											variant="contained"
											color="success"
											startIcon={reviewLoading ? <CircularProgress size={14} /> : <CheckIcon />}
											onClick={() => void handleReviewAction('approve')}
											disabled={reviewLoading}
											data-testid={`approve-evidence-btn-${submission.id}`}
											sx={{ fontWeight: 700 }}
										>
											Approve proof
										</Button>
										<Button
											size="medium"
											variant="outlined"
											color="error"
											startIcon={<CloseIcon />}
											onClick={() => void handleReviewAction('reject')}
											disabled={reviewLoading}
											data-testid={`reject-evidence-btn-${submission.id}`}
											sx={{ fontWeight: 700 }}
										>
											Reject proof
										</Button>
									</Stack>
								</Box>
							)}
						</Box>
					}
				/>
				{canSubmit && (!submitted || rejected) && (
					<Button
						size="small"
						variant={rejected ? 'outlined' : 'contained'}
						color={rejected ? 'error' : 'primary'}
						onClick={() => setSubmitOpen(true)}
						data-testid={`submit-evidence-btn-${req.id}`}
						sx={{ flexShrink: 0, mt: 0.5 }}
					>
						{actionLabel}
					</Button>
				)}
			</Box>
			{submitOpen && (
				<EvidenceSubmitForm
					requirementId={req.id}
					requirementName={req.name}
					evidenceType={req.evidenceTypes[0]}
					approvalMode={req.approvalMode}
					taskId={taskId}
					mode={rejected ? 'resubmit' : 'submit'}
					onClose={() => setSubmitOpen(false)}
					onSubmitted={() => {
						setSubmitOpen(false);
						onSubmitted();
					}}
				/>
			)}
		</ListItem>
	);
}

// =============================================================================
// Main Component
// =============================================================================

interface EvidenceChecklistProps {
	ritualDefinitionId: string;
	taskId: string;
	canSubmit?: boolean;
	canReview?: boolean;
	isDualRole?: boolean;
	autoOpenRequirementId?: string | null;
	highlightedRequirementId?: string | null;
	autoFocusFirstActionable?: boolean;
}

export default function EvidenceChecklist({
	ritualDefinitionId,
	taskId,
	canSubmit = true,
	canReview = false,
	isDualRole = false,
	autoOpenRequirementId,
	highlightedRequirementId,
	autoFocusFirstActionable = false,
}: EvidenceChecklistProps) {
	const colors = useThemeColors();
	const [requirements, setRequirements] = useState<EvidenceRequirementDetail[]>([]);
	const [submissions, setSubmissions] = useState<EvidenceSubmission[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [reqs, subs] = await Promise.all([
				listEvidenceRequirements(ritualDefinitionId),
				listEvidenceSubmissions(taskId),
			]);
			setRequirements(reqs);
			setSubmissions(subs);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load evidence');
		} finally {
			setLoading(false);
		}
	}, [ritualDefinitionId, taskId]);

	useEffect(() => {
		load();
	}, [load]);

	const submissionByReqId = React.useMemo(() => {
		const sorted = [...submissions].sort((a, b) => {
			const aTime = a.serverTimestamp instanceof Date ? a.serverTimestamp.getTime() : 0;
			const bTime = b.serverTimestamp instanceof Date ? b.serverTimestamp.getTime() : 0;
			return bTime - aTime;
		});
		const map: Record<string, EvidenceSubmission> = {};
		for (const s of sorted) {
			if (!(s.evidenceRequirementId in map)) {
				map[s.evidenceRequirementId] = s;
			}
		}
		return map;
	}, [submissions]);

	const completedCount = requirements.filter(
		(r) => submissionByReqId[r.id]?.approvalStatus === 'approved'
	).length;
	const submittedCount = requirements.filter((r) => !!submissionByReqId[r.id]).length;
	const pendingCount = requirements.filter(
		(r) => submissionByReqId[r.id]?.approvalStatus === 'pending_review'
	).length;
	const actionableRequirementId = React.useMemo(() => {
		if (highlightedRequirementId) {
			return highlightedRequirementId;
		}

		if (!autoFocusFirstActionable) {
			return null;
		}

		const rejectedRequirement = requirements.find(
			(requirement) => submissionByReqId[requirement.id]?.approvalStatus === 'rejected'
		);
		if (rejectedRequirement) {
			return rejectedRequirement.id;
		}

		const missingRequiredRequirement = requirements.find(
			(requirement) => requirement.isRequired && !submissionByReqId[requirement.id]
		);

		return missingRequiredRequirement?.id ?? null;
	}, [autoFocusFirstActionable, highlightedRequirementId, requirements, submissionByReqId]);

	if (loading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
				<CircularProgress size={24} />
			</Box>
		);
	}

	if (error) {
		return (
			<Alert severity="error" onClose={() => setError(null)}>
				{error}
			</Alert>
		);
	}

	if (requirements.length === 0) {
		return null;
	}

	return (
		<Box
			sx={{
				mt: 2,
				p: 2,
				border: '1px solid',
				...colors.border.default.style,
				borderRadius: 1,
			}}
			data-testid="evidence-checklist"
		>
			<Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
				<Typography variant="subtitle1" sx={{ ...colors.text.primary.style, fontWeight: 600 }}>
					Proof Checklist
				</Typography>
				<Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
					<Chip
						label={`${submittedCount}/${requirements.length} submitted`}
						size="small"
						variant="outlined"
					/>
					{pendingCount > 0 && (
						<Chip label={`${pendingCount} awaiting review`} color="warning" size="small" />
					)}
					{completedCount > 0 && (
						<Chip label={`${completedCount} approved`} color="success" size="small" />
					)}
				</Stack>
			</Box>
			{isDualRole && (
				<Alert severity="info" sx={{ mb: 1.5 }} data-testid="evidence-checklist-dual-role-note">
					You are assigned to this ritual and can both submit proof and review pending evidence in the same checklist.
				</Alert>
			)}
			{canReview && pendingCount > 0 && (
				<Alert severity="info" sx={{ mb: 1.5 }}>
					Pending submissions can be approved or rejected directly in the checklist rows below.
				</Alert>
			)}
			<List disablePadding data-testid="evidence-checklist-list">
				{requirements.map((req) => (
					<RequirementRow
						key={req.id}
						req={req}
						taskId={taskId}
						submission={submissionByReqId[req.id]}
						onSubmitted={load}
						canSubmit={canSubmit}
						canReview={canReview}
						autoOpen={(autoOpenRequirementId ?? actionableRequirementId) === req.id}
						highlighted={actionableRequirementId === req.id}
					/>
				))}
			</List>
		</Box>
	);
}
