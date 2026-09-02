/**
 * Projects Page
 * Workspace page for task collaboration - project listing with cards
 * Feature: 017-realtime-task-collaboration-system
 * 
 * Features:
 * - Auth guard via useRequireAuth hook
 * - Fetch projects via listProjects() API
 * - Display project cards with name, key, task count, member count
 * - "New Project" button → create dialog
 * - Search/filter functionality
 * - Theme system colors (no hardcoded colors)
 */

'use client';

import React, { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
	Box,
	CircularProgress,
	Typography,
	Button,
	Card,
	CardContent,
	CardActionArea,
	Grid,
	TextField,
	InputAdornment,
	Chip,
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Alert,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import FolderIcon from '@mui/icons-material/Folder';
import GroupIcon from '@mui/icons-material/Group';
import AssignmentIcon from '@mui/icons-material/Assignment';
import { useRequireAuth } from '@/lib/auth/hooks';
import { useThemeColors } from '@/theme/useThemeColors';
import { listProjects, createProject, type Project, type ProjectVisibility, type CollaborationMode } from 'apis';

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
	const colors = useThemeColors();

	return (
		<Card
			sx={{
				...colors.bg.paper.style,
				border: 1,
				...colors.border.default.style,
				'&:hover': {
					...colors.border.primary.style,
				},
			}}
			data-testid={`project-card-${project.id}`}
		>
			<CardActionArea onClick={onClick}>
				<CardContent>
					<Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
						<Box
							sx={{
								width: 48,
								height: 48,
								borderRadius: 2,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								...colors.primary.light.style,
							}}
						>
							<FolderIcon sx={{ color: 'primary.main' }} />
						</Box>
						<Box sx={{ flex: 1, minWidth: 0 }}>
							<Typography variant="h6" noWrap sx={{ ...colors.text.primary.style }}>
								{project.name}
							</Typography>
							<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 1 }}>
								{project.key}
							</Typography>
							{project.description && (
								<Typography
									variant="body2"
									sx={{
										...colors.text.secondary.style,
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										display: '-webkit-box',
										WebkitLineClamp: 2,
										WebkitBoxOrient: 'vertical',
									}}
								>
									{project.description}
								</Typography>
							)}
						</Box>
					</Box>
					<Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
						<Chip
							icon={<AssignmentIcon />}
							label={`${project.taskCount} tasks`}
							size="small"
							variant="outlined"
							data-testid={`project-task-count-${project.id}`}
						/>
						<Chip
							icon={<GroupIcon />}
							label={`${project.memberCount} members`}
							size="small"
							variant="outlined"
							data-testid={`project-member-count-${project.id}`}
						/>
						{project.visibility === 'private' && (
							<Chip
								label="Private"
								size="small"
								color="default"
							/>
						)}
					</Box>
				</CardContent>
			</CardActionArea>
		</Card>
	);
}

interface CreateProjectDialogProps {
	open: boolean;
	onClose: () => void;
	onCreated: (project: Project) => void;
}

function CreateProjectDialog({ open, onClose, onCreated }: CreateProjectDialogProps) {
	const colors = useThemeColors();
	const [name, setName] = useState('');
	const [key, setKey] = useState('');
	const [description, setDescription] = useState('');
	const [visibility, setVisibility] = useState<ProjectVisibility>('private');
	const [collaborationMode, setCollaborationMode] = useState<CollaborationMode>('standard');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Auto-generate key from name
	useEffect(() => {
		if (name && !key) {
			const generatedKey = name
				.toUpperCase()
				.replace(/[^A-Z0-9]/g, '')
				.substring(0, 10);
			setKey(generatedKey);
		}
	}, [name, key]);

	const handleSubmit = async () => {
		if (!name.trim() || !key.trim()) {
			setError('Name and key are required');
			return;
		}

		if (!/^[A-Z][A-Z0-9_]{0,9}$/.test(key)) {
			setError('Key must be 1-10 uppercase letters/numbers, starting with a letter');
			return;
		}

		setLoading(true);
		setError(null);

		try {
			const response = await createProject({
				name: name.trim(),
				key: key.trim(),
				description: description.trim() || undefined,
				visibility,
				collaborationMode,
			});
			onCreated(response.project);
			handleClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create project');
		} finally {
			setLoading(false);
		}
	};

	const handleClose = () => {
		setName('');
		setKey('');
		setDescription('');
		setVisibility('private');
		setCollaborationMode('standard');
		setError(null);
		onClose();
	};

	return (
		<Dialog
			open={open}
			onClose={handleClose}
			maxWidth="sm"
			fullWidth
			data-testid="create-project-dialog"
		>
			<DialogTitle>Create New Project</DialogTitle>
			<DialogContent>
				{error && (
					<Alert severity="error" sx={{ mb: 2 }}>
						{error}
					</Alert>
				)}
				<TextField
					autoFocus
					label="Project Name"
					fullWidth
					value={name}
					onChange={(e) => setName(e.target.value)}
					margin="normal"
					placeholder="e.g., Marketing Website Redesign"
					inputProps={{ 'data-testid': 'project-name-input' }}
				/>
				<TextField
					label="Project Key"
					fullWidth
					value={key}
					onChange={(e) => setKey(e.target.value.toUpperCase())}
					margin="normal"
					placeholder="e.g., MARKETING"
					helperText="1-10 uppercase letters/numbers. Used in task IDs (e.g., MARKETING-123)"
					inputProps={{ 'data-testid': 'project-key-input' }}
				/>
				<TextField
					label="Description"
					fullWidth
					multiline
					rows={3}
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					margin="normal"
					placeholder="Optional project description..."
					inputProps={{ 'data-testid': 'project-description-input' }}
				/>
				<Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
					<Button
						variant={visibility === 'private' ? 'contained' : 'outlined'}
						size="small"
						onClick={() => setVisibility('private')}
						data-testid="visibility-private-btn"
					>
						Private
					</Button>
					<Button
						variant={visibility === 'public' ? 'contained' : 'outlined'}
						size="small"
						onClick={() => setVisibility('public')}
						data-testid="visibility-public-btn"
					>
						Public
					</Button>
				</Box>
				<Typography variant="caption" sx={{ ...colors.text.secondary.style, mt: 1, display: 'block' }}>
					{visibility === 'private'
						? 'Only project members can see this project'
						: 'All organization members can see this project'}
				</Typography>
				<Typography variant="subtitle2" sx={{ ...colors.text.primary.style, mt: 2, mb: 1 }}>
					Collaboration Mode
				</Typography>
				<Box sx={{ display: 'flex', gap: 1 }} data-testid="collab-mode-selector">
					{(['standard', 'ritual', 'mixed'] as CollaborationMode[]).map((mode) => (
						<Button
							key={mode}
							variant={collaborationMode === mode ? 'contained' : 'outlined'}
							size="small"
							onClick={() => setCollaborationMode(mode)}
							data-testid={`collab-mode-${mode}-btn`}
							sx={{ textTransform: 'capitalize' }}
						>
							{mode}
						</Button>
					))}
				</Box>
				<Typography variant="caption" sx={{ ...colors.text.secondary.style, mt: 1, display: 'block' }}>
					{collaborationMode === 'standard' && 'Regular task management with no recurring rituals'}
					{collaborationMode === 'ritual' && 'Project driven by recurring ritual task definitions'}
					{collaborationMode === 'mixed' && 'Combines standard tasks with recurring ritual tasks'}
				</Typography>
			</DialogContent>
			<DialogActions>
				<Button onClick={handleClose} disabled={loading} data-testid="cancel-create-project-btn">
					Cancel
				</Button>
				<Button
					onClick={handleSubmit}
					variant="contained"
					disabled={loading || !name.trim() || !key.trim()}
					data-testid="submit-create-project-btn"
				>
					{loading ? <CircularProgress size={20} /> : 'Create Project'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

function ProjectsPageContent() {
	const { isLoading: authLoading, user } = useRequireAuth();
	const router = useRouter();
	const colors = useThemeColors();

	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const searchParams = useSearchParams();
	// FR-013a (Feature 039): ?create=1 lands with the create dialog already open, so the
	// tour's "Create a project" stop does not deposit someone on an empty list and leave
	// them to find the button. Read once on mount, not on every searchParams change, so
	// closing the dialog does not immediately reopen it.
	const [createDialogOpen, setCreateDialogOpen] = useState(
		() => searchParams.get('create') === '1'
	);

	const loadProjects = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await listProjects({ includeArchived: false });
			setProjects(response.projects);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load projects');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (user) {
			loadProjects();
		}
	}, [user, loadProjects]);

	// Filter projects by search query
	const filteredProjects = projects.filter((p) =>
		p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
		p.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
		p.description?.toLowerCase().includes(searchQuery.toLowerCase())
	);

	const handleProjectClick = (projectId: string) => {
		router.push(`/workspace/tasks/${projectId}`);
	};

	const handleProjectCreated = (project: Project) => {
		setProjects((prev) => [project, ...prev]);
	};

	// Show loading state while checking authentication
	if (authLoading) {
		return (
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '400px',
				}}
			>
				<CircularProgress />
			</Box>
		);
	}

	// If not authenticated, useRequireAuth will handle redirect
	if (!user) {
		return null;
	}

	return (
		<Box
			sx={{
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				overflow: 'hidden',
			}}
			data-testid="workspace-projects-page"
		>
			{/* Header */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					p: 3,
					borderBottom: 1,
					...colors.border.default.style,
				}}
			>
				<Typography variant="h5" sx={{ ...colors.text.primary.style, fontWeight: 600 }}>
					Tasks
				</Typography>
				<Button
					variant="contained"
					startIcon={<AddIcon />}
					onClick={() => setCreateDialogOpen(true)}
					data-testid="create-project-btn"
				>
					New Project
				</Button>
			</Box>

			{/* Search Bar */}
			<Box sx={{ p: 2, borderBottom: 1, ...colors.border.default.style }}>
				<TextField
					placeholder="Search projects..."
					size="small"
					fullWidth
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					InputProps={{
						startAdornment: (
							<InputAdornment position="start">
								<SearchIcon sx={{ ...colors.text.disabled.style }} />
							</InputAdornment>
						),
					}}
					inputProps={{ 'data-testid': 'projects-search-input' }}
					sx={{ maxWidth: 400 }}
				/>
			</Box>

			{/* Project List */}
			<Box
				sx={{
					flex: 1,
					overflow: 'auto',
					p: 3,
					...colors.bg.default.style,
				}}
			>
				{loading ? (
					<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
						<CircularProgress />
					</Box>
				) : error ? (
					<Alert severity="error" sx={{ mb: 2 }}>
						{error}
						<Button size="small" onClick={loadProjects} sx={{ ml: 2 }}>
							Retry
						</Button>
					</Alert>
				) : filteredProjects.length === 0 ? (
					<Box
						sx={{
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							justifyContent: 'center',
							py: 8,
						}}
					>
						<FolderIcon sx={{ fontSize: 64, ...colors.text.disabled.style, mb: 2 }} />
						<Typography variant="h6" sx={{ ...colors.text.secondary.style, mb: 1 }}>
							{searchQuery ? 'No matching projects' : 'No projects yet'}
						</Typography>
						<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 3 }}>
							{searchQuery
								? 'Try adjusting your search query'
								: 'Create your first project to get started'}
						</Typography>
						{!searchQuery && (
							<Button
								variant="contained"
								startIcon={<AddIcon />}
								onClick={() => setCreateDialogOpen(true)}
								data-testid="empty-create-project-btn"
							>
								Create Project
							</Button>
						)}
					</Box>
				) : (
					<Grid container spacing={2}>
						{filteredProjects.map((project) => (
							<Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={project.id}>
								<ProjectCard
									project={project}
									onClick={() => handleProjectClick(project.id)}
								/>
							</Grid>
						))}
					</Grid>
				)}
			</Box>

			{/* Create Project Dialog */}
			<CreateProjectDialog
				open={createDialogOpen}
				onClose={() => setCreateDialogOpen(false)}
				onCreated={handleProjectCreated}
			/>
		</Box>
	);
}

export default function ProjectsPage() {
	return (
		<Suspense
			fallback={
				<Box
					sx={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						minHeight: '400px',
					}}
				>
					<CircularProgress />
				</Box>
			}
		>
			<ProjectsPageContent />
		</Suspense>
	);
}
