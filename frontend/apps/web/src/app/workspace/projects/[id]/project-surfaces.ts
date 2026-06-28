import type { ElementType } from 'react';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import BarChartIcon from '@mui/icons-material/BarChart';
import TodayIcon from '@mui/icons-material/Today';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import HomeWorkOutlinedIcon from '@mui/icons-material/HomeWorkOutlined';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';
import SettingsIcon from '@mui/icons-material/Settings';
import type { CollaborationMode, ProjectSurfaceDefinition, ProjectSurfaceId } from 'apis';

export interface ProjectSurfaceTabDefinition extends ProjectSurfaceDefinition {
	icon: ElementType;
	testId: string;
	implemented: boolean;
}

const projectSurfaceTabs: readonly ProjectSurfaceTabDefinition[] = [
	{ id: 'overview', label: 'Overview', icon: HomeWorkOutlinedIcon, testId: 'tab-overview', workstream: 'overview', supportedModes: ['mixed'], implemented: true },
	{ id: 'board', label: 'Board', icon: ViewKanbanIcon, testId: 'tab-board', workstream: 'planning', supportedModes: ['standard', 'ritual', 'mixed'], persistedViewType: 'board', implemented: true },
	{ id: 'list', label: 'List', icon: ViewListIcon, testId: 'tab-list', workstream: 'planning', supportedModes: ['standard', 'mixed'], persistedViewType: 'list', implemented: true },
	{ id: 'worklist', label: 'Worklist', icon: ChecklistOutlinedIcon, testId: 'tab-worklist', workstream: 'operations', supportedModes: ['ritual'], implemented: true },
	{ id: 'gantt', label: 'Gantt', icon: ViewTimelineIcon, testId: 'tab-gantt', workstream: 'planning', supportedModes: ['standard', 'ritual', 'mixed'], persistedViewType: 'gantt', implemented: true },
	{ id: 'calendar', label: 'Calendar', icon: CalendarMonthIcon, testId: 'tab-calendar', workstream: 'operations', supportedModes: ['standard', 'ritual', 'mixed'], persistedViewType: 'calendar', implemented: true },
	{ id: 'analytics', label: 'Analytics', icon: BarChartIcon, testId: 'tab-analytics', workstream: 'health', supportedModes: ['standard', 'mixed'], implemented: true },
	{ id: 'today', label: 'Today', icon: TodayIcon, testId: 'tab-today', workstream: 'operations', supportedModes: ['ritual', 'mixed'], persistedViewType: 'today', implemented: true },
	{ id: 'review', label: 'Review', icon: FactCheckOutlinedIcon, testId: 'tab-review', workstream: 'review', supportedModes: ['ritual', 'mixed'], requiresReviewPermission: true, implemented: true },
	{ id: 'health', label: 'Health', icon: LocalHospitalIcon, testId: 'tab-health', workstream: 'health', supportedModes: ['ritual', 'mixed'], persistedViewType: 'health', implemented: true },
	{ id: 'settings', label: 'Settings', icon: SettingsIcon, testId: 'tab-settings', workstream: 'settings', supportedModes: ['standard', 'ritual', 'mixed'], implemented: true },
];

const surfaceOrderByMode: Record<CollaborationMode, ProjectSurfaceId[]> = {
	standard: ['board', 'list', 'gantt', 'calendar', 'analytics', 'settings'],
	ritual: ['today', 'review', 'health', 'calendar', 'worklist', 'board', 'gantt', 'settings'],
	mixed: ['overview', 'today', 'list', 'board', 'gantt', 'calendar', 'review', 'health', 'analytics', 'settings'],
};

export function getDefaultProjectSurface(mode: CollaborationMode): ProjectSurfaceId {
	switch (mode) {
		case 'ritual':
			return 'today';
		case 'mixed':
			return 'overview';
		default:
			return 'board';
	}
}

export function getProjectSurfaceTabs(
	mode: CollaborationMode,
	canReviewRitualEvidence: boolean,
	options: { implementedOnly?: boolean } = {}
): ProjectSurfaceTabDefinition[] {
	const order = surfaceOrderByMode[mode];
	return projectSurfaceTabs.filter((surface) => {
		if (!surface.supportedModes.includes(mode)) {
			return false;
		}
		if (surface.requiresReviewPermission && !canReviewRitualEvidence) {
			return false;
		}
		if (options.implementedOnly && !surface.implemented) {
			return false;
		}
		return true;
	}).sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
}

export function resolveProjectSurfaceState(
	mode: CollaborationMode,
	requestedSurface: string | null,
	canReviewRitualEvidence: boolean,
	options: { implementedOnly?: boolean } = {}
): {
	activeSurface: ProjectSurfaceId;
	defaultSurface: ProjectSurfaceId;
	tabs: ProjectSurfaceTabDefinition[];
} {
	const defaultSurface = getDefaultProjectSurface(mode);
	const tabs = getProjectSurfaceTabs(mode, canReviewRitualEvidence, options);
	const allowedSurfaceIds = new Set(tabs.map((surface) => surface.id));
	const fallbackSurface = allowedSurfaceIds.has(defaultSurface) ? defaultSurface : (tabs[0]?.id ?? 'board');
	const activeSurface =
		requestedSurface && allowedSurfaceIds.has(requestedSurface as ProjectSurfaceId)
			? (requestedSurface as ProjectSurfaceId)
			: fallbackSurface;

	return { activeSurface, defaultSurface, tabs };
}
