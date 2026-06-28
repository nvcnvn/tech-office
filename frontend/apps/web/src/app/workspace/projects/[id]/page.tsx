/**
 * Project Detail Page
 * Workspace page for individual project view with tabs for Board, List, Gantt, Calendar, Settings
 * Feature: 017-realtime-task-collaboration-system
 *
 * Features:
 * - Auth guard via useRequireAuth hook
 * - Fetch project, states, levels, membership on mount
 * - Context provider for project data
 * - Theme system colors (no hardcoded colors)
 */

'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
	Alert,
	Box,
	Breadcrumbs,
	Button,
	Chip,
	CircularProgress,
	IconButton,
	Link,
	Tab,
	Tabs,
	Tooltip,
	Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RepeatIcon from '@mui/icons-material/Repeat';
import LinkIcon from '@mui/icons-material/Link';
import { useRequireAuth } from '@/lib/auth/hooks';
import { useThemeColors } from '@/theme/useThemeColors';
import {
	getProject,
	listTasks,
	type Project,
	type ProjectMemberRole,
	type ProjectState,
	type ProjectSurfaceId,
	type Task,
	type TaskLevel,
} from 'apis';
import { ProjectContext, type ProjectContextValue } from './ProjectContext';
import {
	AnalyticsView,
	BoardView,
	CalendarView,
	GanttView,
	HealthDashboard,
	ListView,
	OverviewView,
	RitualReviewBacklog,
	SettingsView,
	TaskDetailSidePanel,
	TodayView,
} from './components';

import { resolveProjectSurfaceState } from './project-surfaces';

function ProjectDetailContent() {
	const params = useParams();
	const searchParams = useSearchParams();
	const router = useRouter();
	const { isLoading: authLoading, user } = useRequireAuth();
	const colors = useThemeColors();

	const projectId = params.id as string;
	const canReviewRitualEvidence = user?.permissionIds.includes('collab.reviewEvidence') ?? false;
	const canManageRitualDefinition = user?.permissionIds.includes('collab.manageRitualDefinition') ?? false;

	const currentMembership = useMemo(
		() => user?.organizations.find((org) => org.organizationId === user.organizationId) ?? user?.organizations[0],
		[user]
	);
	const [copyProjectLinkSuccess, setCopyProjectLinkSuccess] = useState(false);

	const [project, setProject] = useState<Project | null>(null);
	const [states, setStates] = useState<ProjectState[]>([]);
	const [levels, setLevels] = useState<TaskLevel[]>([]);
	const [currentUserRole, setCurrentUserRole] = useState<ProjectMemberRole>('viewer');
	const [tasks, setTasks] = useState<Task[]>([]);
	const [loading, setLoading] = useState(true);
	const [tasksLoading, setTasksLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedTask, setSelectedTask] = useState<Task | null>(null);
	const [taskPanelOpen, setTaskPanelOpen] = useState(false);

	const handleTaskClick = useCallback((task: Task) => {
		setSelectedTask(task);
		setTaskPanelOpen(true);
	}, []);

	const handleTaskIdentifierClick = useCallback(
		(task: Task) => {
			router.push(`/workspace/tasks/${projectId}/tasks/${task.id}`);
		},
		[projectId, router]
	);

	const handleTaskPanelClose = useCallback(() => {
		setTaskPanelOpen(false);
		setSelectedTask(null);
	}, []);

	const loadProject = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await getProject(projectId);
			setProject(response.project);
			setStates(response.states);
			setLevels(response.levels);
			setCurrentUserRole(response.currentUserRole);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load project');
		} finally {
			setLoading(false);
		}
	}, [projectId]);

	const loadTasks = useCallback(async () => {
		if (!project) return;
		setTasksLoading(true);
		try {
			const response = await listTasks({ projectId, rootOnly: false });
			setTasks(response.tasks);
		} catch (err) {
			console.error('Failed to load tasks:', err);
		} finally {
			setTasksLoading(false);
		}
	}, [project, projectId]);

	useEffect(() => {
		if (user) {
			void loadProject();
		}
	}, [loadProject, user]);

	useEffect(() => {
		if (project) {
			void loadTasks();
		}
	}, [loadTasks, project]);

	const { activeSurface, tabs } = resolveProjectSurfaceState(
		project?.collaborationMode ?? 'standard',
		searchParams.get('view'),
		canReviewRitualEvidence,
		{ implementedOnly: true }
	);
	const isRitualProject = project?.collaborationMode === 'ritual';
	const isMixedProject = project?.collaborationMode === 'mixed';

	const getSurfaceLabel = useCallback(
		(surfaceId: ProjectSurfaceId, fallbackLabel: string) => {
			if (isMixedProject) {
				switch (surfaceId) {
					case 'list':
						return 'Tasks';
					case 'board':
						return 'Planned Work';
					case 'calendar':
						return 'Routine Operations';
					case 'gantt':
						return 'Planned Timeline';
					default:
						return fallbackLabel;
				}
			}

			if (!isRitualProject) {
				return fallbackLabel;
			}

			switch (surfaceId) {
				case 'review':
					return canReviewRitualEvidence ? 'Review Queue' : fallbackLabel;
				case 'board':
					return 'Board (Secondary)';
				case 'settings':
					return 'Project Settings';
				default:
					return fallbackLabel;
			}
		},
		[canReviewRitualEvidence, isMixedProject, isRitualProject]
	);

	useEffect(() => {
		if (!project || searchParams.get('view')) {
			return;
		}

		const params = new URLSearchParams(searchParams.toString());
		params.set('view', activeSurface);
		router.replace(`/workspace/tasks/${projectId}?${params.toString()}`);
	}, [activeSurface, project, projectId, router, searchParams]);

	const handleOpenTemplateManagement = useCallback(() => {
		router.push(`/workspace/tasks/${projectId}?view=settings&tab=rituals`);
	}, [projectId, router]);

	const handleCopyProjectLink = useCallback(async () => {
		try {
			if (!currentMembership?.organizationSubdomain) return;
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:18080'}/api/linking/generate`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						target: {
							tenantKey: currentMembership.organizationSubdomain,
							resourceType: 'project',
							resourceId: projectId,
						},
					}),
				}
			);
			const payload = (await response.json().catch(() => null)) as { canonicalUrl?: string } | null;
			if (response.ok && payload?.canonicalUrl) {
				await navigator.clipboard.writeText(payload.canonicalUrl);
				setCopyProjectLinkSuccess(true);
				setTimeout(() => setCopyProjectLinkSuccess(false), 2000);
			}
		} catch {
			// silently ignore
		}
	}, [currentMembership, projectId]);

	if (authLoading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
				<CircularProgress />
			</Box>
		);
	}

	if (!user) {
		return null;
	}

	if (loading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
				<CircularProgress />
			</Box>
		);
	}

	if (error) {
		return (
			<Box sx={{ p: 3 }}>
				<Alert severity="error">
					{error}
					<Button size="small" onClick={() => void loadProject()} sx={{ ml: 2 }}>
						Retry
					</Button>
				</Alert>
			</Box>
		);
	}

	if (!project) {
		return (
			<Box sx={{ p: 3 }}>
				<Alert severity="warning">Project not found</Alert>
			</Box>
		);
	}

	const contextValue: ProjectContextValue = {
		project,
		states,
		levels,
		currentUserRole,
		tasks,
		loading: tasksLoading,
		error,
		refreshTasks: loadTasks,
		refreshProject: loadProject,
	};

	const handleTabChange = (_: React.SyntheticEvent, newValue: ProjectSurfaceId) => {
		router.push(`/workspace/tasks/${projectId}?view=${newValue}`);
	};

	return (
		<ProjectContext.Provider value={contextValue}>
			<Box
				sx={{
					display: 'flex',
					flexDirection: 'column',
					height: '100%',
					overflow: 'hidden',
				}}
				data-testid="project-detail-page"
			>
				<Box
					sx={{
						display: 'flex',
						alignItems: 'center',
						gap: 2,
						p: 2,
						borderBottom: 1,
						...colors.border.default.style,
					}}
					data-testid="project-detail-header"
				>
					<IconButton
						onClick={() => router.push('/workspace/tasks')}
						data-testid="back-to-projects-btn"
					>
						<ArrowBackIcon />
					</IconButton>

					<Breadcrumbs separator="›" sx={{ flex: 1 }} data-testid="project-breadcrumbs">
						<Link
							href="/workspace/tasks"
							underline="hover"
							sx={{ ...colors.text.secondary.style, cursor: 'pointer' }}
							data-testid="project-breadcrumbs-link"
						>
							Tasks
						</Link>
						<Typography sx={{ ...colors.text.primary.style }} data-testid="project-name-heading">
							{project.name}
						</Typography>
					</Breadcrumbs>

					<Chip label={project.key} size="small" variant="outlined" data-testid="project-key-chip" />

					{project.visibility === 'private' && (
						<Chip label="Private" size="small" color="default" data-testid="project-visibility-chip" />
					)}

					<Tooltip title={copyProjectLinkSuccess ? 'Copied!' : 'Copy project link'}>
						<IconButton
							size="small"
							onClick={() => { void handleCopyProjectLink(); }}
							data-testid="project-copy-link-btn"
						>
							<LinkIcon fontSize="small" />
						</IconButton>
					</Tooltip>

					<Typography variant="caption" sx={{ ...colors.text.secondary.style }} data-testid="project-member-task-summary">
						{project.taskCount} tasks · {project.memberCount} members
					</Typography>
					{isRitualProject && canManageRitualDefinition && (
						<Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }} data-testid="project-mode-actions">
							<Chip
								label="Ritual operations"
								color="warning"
								variant="outlined"
								data-testid="ritual-project-mode-chip"
							/>
							<Button
								variant="outlined"
								startIcon={<RepeatIcon />}
								onClick={handleOpenTemplateManagement}
								data-testid="open-ritual-template-management-btn"
							>
								Manage Templates
							</Button>
						</Box>
					)}
				</Box>

				<Box sx={{ borderBottom: 1, ...colors.border.default.style }} data-testid="project-navigation-bar">
					<Tabs
						value={activeSurface}
						onChange={handleTabChange}
						variant="scrollable"
						scrollButtons="auto"
						data-testid="project-view-tabs"
					>
						{tabs.map((tab) => {
							const Icon = tab.icon;

							return (
								<Tab
									key={tab.id}
									icon={<Icon />}
									iconPosition="start"
									label={getSurfaceLabel(tab.id, tab.label)}
									value={tab.id}
									data-testid={tab.testId}
								/>
							);
						})}
					</Tabs>
				</Box>

				<Box
					sx={{ flex: 1, overflow: 'auto', ...colors.bg.default.style }}
					data-testid={`project-view-panel-${activeSurface}`}
				>
					{activeSurface === 'overview' && <OverviewView />}
					{activeSurface === 'board' && (
						<BoardView
							onTaskClick={handleTaskClick}
							onTaskIdentifierClick={handleTaskIdentifierClick}
						/>
					)}
					{activeSurface === 'list' && (
						<ListView
							onTaskClick={handleTaskClick}
							onTaskIdentifierClick={handleTaskIdentifierClick}
						/>
					)}
					{activeSurface === 'gantt' && (
						<GanttView
							onTaskClick={handleTaskClick}
							onTaskIdentifierClick={handleTaskIdentifierClick}
						/>
					)}
					{activeSurface === 'calendar' && (
						<CalendarView
							onTaskClick={handleTaskClick}
							onTaskIdentifierClick={handleTaskIdentifierClick}
						/>
					)}
					{activeSurface === 'worklist' && (
						<ListView
							onTaskClick={handleTaskClick}
							onTaskIdentifierClick={handleTaskIdentifierClick}
						/>
					)}
					{activeSurface === 'analytics' && <AnalyticsView />}
					{activeSurface === 'review' && (
						<Box data-testid="project-review-view">
							<RitualReviewBacklog />
						</Box>
					)}
					{activeSurface === 'settings' && <SettingsView />}
					{activeSurface === 'today' && <TodayView />}
					{activeSurface === 'health' && <HealthDashboard />}
				</Box>

				<TaskDetailSidePanel
					task={selectedTask}
					open={taskPanelOpen}
					onClose={handleTaskPanelClose}
					onTaskUpdated={loadTasks}
					projectId={projectId}
				/>
			</Box>
		</ProjectContext.Provider>
	);
}

export default function ProjectDetailPage() {
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
			<ProjectDetailContent />
		</Suspense>
	);
}
