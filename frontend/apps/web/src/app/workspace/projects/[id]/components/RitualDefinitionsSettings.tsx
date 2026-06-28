/**
 * RitualDefinitionsSettings Component
 * List view for ritual definitions in project settings.
 * Create/Edit operations navigate to the dedicated ritual definition page.
 *
 * Feature: 022-recurring-ritual-tasks-system-for
 *
 * UX Decision (2026-03-12): Ritual definition create/edit has enough complexity
 * (6+ fields + CRUD evidence requirements) to warrant a dedicated page.
 * This component is list-only; the form lives at:
 *   /workspace/tasks/[id]/rituals/new          → create
 *   /workspace/tasks/[id]/rituals/[defId]      → edit
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
	Box,
	Typography,
	Button,
	IconButton,
	List,
	ListItem,
	ListItemText,
	ListItemSecondaryAction,
	FormControlLabel,
	Switch,
	Chip,
	Alert,
	CircularProgress,
	Divider,
	Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import RepeatIcon from '@mui/icons-material/Repeat';
import AssignmentIcon from '@mui/icons-material/Assignment';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import {
	listRitualDefinitions,
	archiveRitualDefinition,
	type RitualDefinition,
	type RecurrenceRule,
} from 'apis';
import ScheduleChangeConfirmDialog from './ScheduleChangeConfirmDialog';

// =============================================================================
// Timezone Options (whole-hour UTC offsets)
// =============================================================================

// =============================================================================
// Recurrence Summary Helper
// =============================================================================

function recurrenceSummary(rule: RecurrenceRule | undefined): string {
	if (!rule) return 'No recurrence';
	switch (rule.type) {
		case 'daily':
			return rule.interval > 1 ? `Every ${rule.interval} days` : 'Daily';
		case 'weekly': {
			const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
			const selectedDays = rule.daysOfWeek.map((d) => days[d - 1] ?? d).join(', ');
			return rule.interval > 1
				? `Every ${rule.interval} weeks (${selectedDays})`
				: `Weekly (${selectedDays || 'unset'})`;
		}
		case 'monthly':
			return rule.dayOfMonth
				? `Monthly on day ${rule.dayOfMonth}`
				: 'Monthly';
		case 'custom_interval':
			return `Every ${rule.interval} days (custom)`;
	}
}


// =============================================================================
// Main Component
// =============================================================================

export default function RitualDefinitionsSettings() {
	const colors = useThemeColors();
	const router = useRouter();
	const { project } = useProjectContext();
	const [definitions, setDefinitions] = useState<RitualDefinition[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showArchived, setShowArchived] = useState(false);
	const [scheduleChangeDef, setScheduleChangeDef] = useState<RitualDefinition | null>(null);

	const loadDefinitions = useCallback(async () => {
		if (!project) return;
		setLoading(true);
		setError(null);
		try {
			const defs = await listRitualDefinitions(project.id, showArchived);
			setDefinitions(defs);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load ritual definitions');
		} finally {
			setLoading(false);
		}
	}, [project, showArchived]);

	useEffect(() => {
		loadDefinitions();
	}, [loadDefinitions]);

	const handleArchive = async (def: RitualDefinition) => {
		try {
			const updated = await archiveRitualDefinition(def.id, !def.isArchived);
			setDefinitions((prev) =>
				prev.map((d) => (d.id === updated.id ? updated : d))
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to update archive status');
		}
	};

	const handleEdit = (def: RitualDefinition) => {
		if (!project) return;
		router.push(`/workspace/tasks/${project.id}/rituals/${def.id}`);
	};

	const handleCreate = () => {
		if (!project) return;
		router.push(`/workspace/tasks/${project.id}/rituals/new`);
	};

	const visibleDefinitions = showArchived
		? definitions
		: definitions.filter((d) => !d.isArchived);

	return (
		<Box sx={{ p: 3 }} data-testid="ritual-definitions-settings">
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					mb: 2,
				}}
			>
				<Typography variant="h6" sx={{ ...colors.text.primary.style }}>
					Ritual Definitions
				</Typography>
				<Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
					<FormControlLabel
						control={
							<Switch
								checked={showArchived}
								onChange={(e) => setShowArchived(e.target.checked)}
								data-testid="show-archived-switch"
							/>
						}
						label="Show archived"
					/>
					<Button
						variant="contained"
						startIcon={<AddIcon />}
						onClick={handleCreate}
						data-testid="create-ritual-definition-btn"
					>
						New Ritual
					</Button>
				</Box>
			</Box>

			{error && (
				<Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
					{error}
				</Alert>
			)}

			{loading ? (
				<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
					<CircularProgress />
				</Box>
			) : visibleDefinitions.length === 0 ? (
				<Box
					sx={{
						textAlign: 'center',
						py: 6,
						...colors.text.secondary.style,
					}}
					data-testid="ritual-definitions-empty"
				>
					<RepeatIcon sx={{ fontSize: 48, mb: 2, opacity: 0.4 }} />
					<Typography>
						No ritual definitions yet. Create your first recurring ritual.
					</Typography>
				</Box>
			) : (
				<List disablePadding>
					{visibleDefinitions.map((def, index) => (
						<React.Fragment key={def.id}>
							{index > 0 && <Divider />}
							<ListItem
								sx={{
									px: 0,
									opacity: def.isArchived ? 0.6 : 1,
								}}
								data-testid={`ritual-definition-item-${def.id}`}
							>
								<ListItemText
									primaryTypographyProps={{ component: 'div' }}
									secondaryTypographyProps={{ component: 'div' }}
									primary={
										<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
											<Typography
												variant="subtitle1"
												sx={{ ...colors.text.primary.style, fontWeight: 500 }}
											>
												{def.name}
											</Typography>
											{def.isArchived && (
												<Chip
													label="Archived"
													size="small"
													color="default"
													data-testid={`ritual-archived-chip-${def.id}`}
												/>
											)}
										</Box>
									}
									secondary={
										<Box>
											<Typography
												variant="body2"
												sx={{ ...colors.text.secondary.style }}
											>
												{def.description}
											</Typography>
											<Box
												sx={{
													display: 'flex',
													gap: 1,
													mt: 0.5,
													flexWrap: 'wrap',
												}}
											>
												<Chip
													icon={<RepeatIcon />}
													label={recurrenceSummary(def.recurrenceRule)}
													size="small"
													variant="outlined"
													data-testid={`ritual-recurrence-chip-${def.id}`}
												/>
												<Chip
													icon={<AssignmentIcon />}
													label={`${def.evidenceRequirements.length} evidence req.`}
													size="small"
													variant="outlined"
													data-testid={`ritual-evidence-chip-${def.id}`}
												/>
												{def.defaultAssigneeIds.length > 0 && (
													<Chip
														label={`${def.defaultAssigneeIds.length} assignees`}
														size="small"
														variant="outlined"
														data-testid={`ritual-assignees-chip-${def.id}`}
													/>
												)}
											</Box>
										</Box>
									}
								/>
								<ListItemSecondaryAction>
									<Tooltip title="Change Schedule">
										<IconButton
											size="small"
											onClick={() => setScheduleChangeDef(def)}
											disabled={def.isArchived}
											data-testid={`ritual-schedule-btn-${def.id}`}
										>
											<ScheduleIcon fontSize="small" />
										</IconButton>
									</Tooltip>
									<Tooltip title="Edit">
										<IconButton
											size="small"
											onClick={() => handleEdit(def)}
											data-testid={`ritual-edit-btn-${def.id}`}
										>
											<EditIcon fontSize="small" />
										</IconButton>
									</Tooltip>
									<Tooltip title={def.isArchived ? 'Restore' : 'Archive'}>
										<IconButton
											size="small"
											onClick={() => handleArchive(def)}
											data-testid={`ritual-archive-btn-${def.id}`}
										>
											{def.isArchived ? (
												<UnarchiveIcon fontSize="small" />
											) : (
												<ArchiveIcon fontSize="small" />
											)}
										</IconButton>
									</Tooltip>
								</ListItemSecondaryAction>
							</ListItem>
						</React.Fragment>
					))}
				</List>
			)}

			{scheduleChangeDef && (
				<ScheduleChangeConfirmDialog
					open={!!scheduleChangeDef}
					onClose={() => setScheduleChangeDef(null)}
					definition={scheduleChangeDef}
					onSuccess={(updated) => {
						setDefinitions((prev) =>
							prev.map((d) => (d.id === updated.id ? updated : d))
						);
					}}
				/>
			)}
		</Box>
	);
}
