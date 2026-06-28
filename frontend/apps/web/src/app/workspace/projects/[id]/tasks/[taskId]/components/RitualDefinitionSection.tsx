/**
 * RitualDefinitionSection
 * Displays ritual definition info and allows admins to change the recurrence schedule.
 * Feature: 023-ritual-tasks-improvement-lazy-resource (T016, T018)
 */

'use client';

import React, { useState } from 'react';
import {
	Box,
	Typography,
	Button,
	Chip,
	Divider,
} from '@mui/material';
import EditCalendarIcon from '@mui/icons-material/EditCalendar';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useThemeColors } from '@/theme/useThemeColors';
import { type RitualDefinition, type RecurrenceRule } from 'apis';
import ScheduleChangeConfirmDialog from '../../../components/ScheduleChangeConfirmDialog';

// =============================================================================
// Helpers
// =============================================================================

const DAY_NAMES: Record<number, string> = {
	1: 'Mon',
	2: 'Tue',
	3: 'Wed',
	4: 'Thu',
	5: 'Fri',
	6: 'Sat',
	7: 'Sun',
};

function formatRecurrenceRule(rule: RecurrenceRule | undefined): string {
	if (!rule) return 'Not set';

	const intervalLabel = rule.interval === 1 ? '' : `every ${rule.interval} `;

	switch (rule.type) {
		case 'daily':
			return rule.interval === 1 ? 'Daily' : `Every ${rule.interval} days`;
		case 'weekly': {
			const days = (rule.daysOfWeek ?? [])
				.sort()
				.map((d) => DAY_NAMES[d] ?? d)
				.join(', ');
			return rule.interval === 1
				? `Weekly on ${days || 'Mon'}`
				: `Every ${rule.interval} weeks on ${days || 'Mon'}`;
		}
		case 'monthly':
			return rule.interval === 1
				? `Monthly on day ${rule.dayOfMonth}`
				: `Every ${rule.interval} months on day ${rule.dayOfMonth}`;
		default:
			return `${intervalLabel}${rule.type}`;
	}
}

// =============================================================================
// Props
// =============================================================================

interface RitualDefinitionSectionProps {
	definition: RitualDefinition;
	detachedFromRitual: boolean;
	canEdit: boolean;
	onUpdated: (updated: RitualDefinition) => void;
}

// =============================================================================
// Component
// =============================================================================

export default function RitualDefinitionSection({
	definition,
	detachedFromRitual,
	canEdit,
	onUpdated,
}: RitualDefinitionSectionProps) {
	const colors = useThemeColors();
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<>
			<Box data-testid="ritual-definition-section">
				<Box
					sx={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						mb: 1,
					}}
				>
					<Typography
						variant="subtitle2"
						sx={{ fontSize: '0.875rem', fontWeight: 600 }}
					>
						Template Guidance
					</Typography>
					{canEdit && !detachedFromRitual && (
						<Button
							size="small"
							startIcon={<EditCalendarIcon fontSize="small" />}
							onClick={() => setDialogOpen(true)}
							data-testid="ritual-edit-schedule-btn"
						>
							Edit Template Schedule
						</Button>
					)}
				</Box>

				<Box
					sx={{
						mb: 1.5,
						p: 1.25,
						borderRadius: 1,
						...colors.bg.active.style,
					}}
					data-testid="ritual-definition-guidance"
				>
					<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
						This section describes the reusable ritual template. Proof, reviewer decisions, skipped runs, and resubmissions belong to this live instance and are not changed here.
					</Typography>
				</Box>

				{/* Definition name */}
				<Typography
					variant="body2"
					sx={{ fontWeight: 500, mb: 0.5 }}
					data-testid="ritual-definition-name"
				>
					{definition.name}
				</Typography>

				{/* Recurrence pattern */}
				<Chip
					label={formatRecurrenceRule(definition.recurrenceRule)}
					size="small"
					variant="outlined"
					sx={{ mb: 1 }}
					data-testid="ritual-recurrence-chip"
				/>

				{/* Schedule version badge */}
				{definition.scheduleVersion !== undefined && definition.scheduleVersion > 1 && (
					<Box sx={{ mb: 0.5 }}>
						<Typography
							variant="caption"
							sx={{ ...colors.text.secondary.style }}
							data-testid="ritual-schedule-version"
						>
							Schedule v{definition.scheduleVersion}
						</Typography>
					</Box>
				)}

				{/* Detached advisory */}
				{detachedFromRitual && (
					<Box
						sx={{
							display: 'flex',
							alignItems: 'flex-start',
							gap: 0.5,
							mt: 1,
							p: 1,
							borderRadius: 1,
							...colors.bg.active.style,
						}}
						data-testid="ritual-detached-advisory"
					>
						<InfoOutlinedIcon fontSize="small" sx={{ mt: 0.1, ...colors.text.secondary.style }} />
						<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
							This run was detached when the ritual schedule changed. Template edits still apply to future runs, but this recorded instance now stands on its own.
						</Typography>
					</Box>
				)}

				<Divider sx={{ mt: 2 }} />
			</Box>

			{dialogOpen && (
				<ScheduleChangeConfirmDialog
					open={dialogOpen}
					onClose={() => setDialogOpen(false)}
					definition={definition}
					onSuccess={(updated) => {
						onUpdated(updated);
						setDialogOpen(false);
					}}
				/>
			)}
		</>
	);
}
