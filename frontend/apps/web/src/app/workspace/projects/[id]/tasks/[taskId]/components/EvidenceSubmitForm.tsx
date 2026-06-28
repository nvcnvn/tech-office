/**
 * EvidenceSubmitForm Component
 * Inline form for submitting evidence for a requirement
 * Feature: 022-recurring-ritual-tasks-system-for
 */

'use client';

import React, { useState, useRef } from 'react';
import {
	Box,
	TextField,
	Button,
	Alert,
	CircularProgress,
	Typography,
} from '@mui/material';
import { useThemeColors } from '@/theme/useThemeColors';
import {
	submitEvidence,
	requestEvidenceFileUpload,
	confirmEvidenceFileUpload,
	type EvidenceType,
	type GpsCoordinates,
} from 'apis';

interface EvidenceSubmitFormProps {
	requirementId: string;
	requirementName?: string;
	evidenceType: EvidenceType;
	approvalMode?: 'manual' | 'auto_approve';
	taskId: string;
	mode?: 'submit' | 'resubmit';
	onClose: () => void;
	onSubmitted: () => void;
}

export default function EvidenceSubmitForm({
	requirementId,
	requirementName,
	evidenceType,
	approvalMode = 'manual',
	taskId,
	mode = 'submit',
	onClose,
	onSubmitted,
}: EvidenceSubmitFormProps) {
	const colors = useThemeColors();
	const [textContent, setTextContent] = useState('');
	const [uploading, setUploading] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
	const [gpsCoordinates, setGpsCoordinates] = useState<GpsCoordinates | null>(null);
	const [locating, setLocating] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const actionVerb = mode === 'resubmit' ? 'Resubmit' : 'Submit';
	const needsText = evidenceType === 'text_note' || evidenceType === 'link';
	const needsFile = evidenceType === 'file' || evidenceType === 'photo';
	const needsGPS = evidenceType === 'gps_checkin' || approvalMode === 'auto_approve';

	const handleFileUpload = async (file: File) => {
		setUploading(true);
		setError(null);
		try {
			const { uploadUrl, fileId } = await requestEvidenceFileUpload(
				taskId,
				requirementId,
				file.name,
				file.type,
				file.size
			);
			// Upload directly to storage
			const res = await fetch(uploadUrl, {
				method: 'PUT',
				body: file,
				headers: { 'Content-Type': file.type },
			});
			if (!res.ok) throw new Error('Upload failed');
			const confirmedId = await confirmEvidenceFileUpload(fileId, taskId);
			setUploadedFileId(confirmedId);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Upload failed');
		} finally {
			setUploading(false);
		}
	};

	const captureCurrentLocation = async (): Promise<GpsCoordinates> => {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			throw new Error('Location is not available in this browser');
		}

		setLocating(true);

		try {
			const coords = await new Promise<GpsCoordinates>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(
					(position) => {
						resolve({
							latitude: position.coords.latitude,
							longitude: position.coords.longitude,
							accuracyMeters: position.coords.accuracy,
						});
					},
					() => {
						reject(new Error('Location permission is required for GPS check-in'));
					},
					{
						enableHighAccuracy: true,
						timeout: 10000,
						maximumAge: 0,
					}
				);
			});

			setGpsCoordinates(coords);
			return coords;
		} finally {
			setLocating(false);
		}
	};

	const handleSubmit = async () => {
		setSubmitting(true);
		setError(null);
		try {
			const currentGpsCoordinates = needsGPS
				? gpsCoordinates ?? (await captureCurrentLocation())
				: undefined;

			await submitEvidence({
				evidenceRequirementId: requirementId,
				evidenceType,
				taskId,
				textContent: textContent.trim() || undefined,
				fileId: uploadedFileId ?? undefined,
				gpsCoordinates: currentGpsCoordinates,
			});
			onSubmitted();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to submit evidence');
		} finally {
			setSubmitting(false);
		}
	};

	const canSubmit =
		!submitting &&
		!locating &&
		!uploading &&
		(needsFile ? !!uploadedFileId : true) &&
		(needsText ? textContent.trim().length > 0 : true);

	return (
		<Box
			sx={{
				mt: 1,
				p: 2,
				border: '1px solid',
				...colors.border.default.style,
				borderRadius: 1,
				width: '100%',
			}}
			data-testid="evidence-submit-form"
		>
			<Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
				{actionVerb} Proof
			</Typography>
			<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 1.5 }}>
				{requirementName ? `${requirementName} on this ritual instance.` : 'Send proof for this ritual step.'}
			</Typography>

			{error && (
				<Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
					{error}
				</Alert>
			)}

			{needsText && (
				<TextField
					fullWidth
					multiline={evidenceType !== 'link'}
					rows={evidenceType === 'link' ? 1 : 3}
					placeholder={
						evidenceType === 'link'
							? 'Enter URL...'
							: 'Describe the evidence...'
					}
					value={textContent}
					onChange={(e) => setTextContent(e.target.value)}
					label={evidenceType === 'link' ? 'Evidence URL' : 'Evidence note'}
					size="small"
					sx={{ mb: 1 }}
					inputProps={{ 'data-testid': 'evidence-text-input' }}
				/>
			)}

			{needsFile && (
				<Box sx={{ mb: 1 }}>
					<input
						type="file"
						ref={fileInputRef}
						style={{ display: 'none' }}
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) handleFileUpload(file);
						}}
						data-testid="evidence-file-input"
					/>
					<Button
						variant="outlined"
						size="small"
						onClick={() => fileInputRef.current?.click()}
						disabled={uploading}
						data-testid="evidence-file-select-btn"
					>
						{uploading ? <CircularProgress size={16} /> : evidenceType === 'photo' ? 'Choose Photo' : 'Select File'}
					</Button>
					{uploadedFileId && (
						<Typography
							variant="caption"
							color="success.main"
							sx={{ ml: 1 }}
							data-testid="evidence-file-uploaded"
						>
							File uploaded
						</Typography>
					)}
				</Box>
			)}

			{needsGPS && (
				<Box sx={{ mb: 1.5 }}>
					<Button
						variant="outlined"
						size="small"
						onClick={() => {
							void captureCurrentLocation().catch((err: unknown) => {
								setError(err instanceof Error ? err.message : 'Failed to capture location');
							});
						}}
						disabled={locating || submitting}
						data-testid="evidence-gps-capture-btn"
					>
						{locating ? <CircularProgress size={16} /> : 'Use Current Location'}
					</Button>
					<Typography variant="caption" sx={{ display: 'block', mt: 1, ...colors.text.secondary.style }}>
						{gpsCoordinates
							? `Location ready (${gpsCoordinates.latitude.toFixed(5)}, ${gpsCoordinates.longitude.toFixed(5)})`
							: 'GPS check-in will use your current browser location for auto-approval.'}
					</Typography>
				</Box>
			)}

			<Box sx={{ display: 'flex', gap: 1 }}>
				<Button
					size="small"
					variant="contained"
					onClick={handleSubmit}
					disabled={!canSubmit}
					data-testid="evidence-submit-btn"
				>
					{submitting || locating ? <CircularProgress size={16} /> : `${actionVerb} Proof`}
				</Button>
				<Button
					size="small"
					onClick={onClose}
					disabled={submitting || uploading}
					data-testid="evidence-cancel-btn"
				>
					Cancel
				</Button>
			</Box>
		</Box>
	);
}
