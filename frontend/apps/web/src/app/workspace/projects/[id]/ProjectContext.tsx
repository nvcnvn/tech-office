'use client';

import { createContext, useContext } from 'react';
import type { Project, ProjectState, TaskLevel, ProjectMemberRole, Task } from 'apis';

// =============================================================================
// Project Context
// =============================================================================

export interface ProjectContextValue {
	project: Project | null;
	states: ProjectState[];
	levels: TaskLevel[];
	currentUserRole: ProjectMemberRole;
	tasks: Task[];
	loading: boolean;
	error: string | null;
	refreshTasks: () => Promise<void>;
	refreshProject: () => Promise<void>;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProjectContext() {
	const context = useContext(ProjectContext);
	if (!context) {
		throw new Error('useProjectContext must be used within ProjectDetailPage');
	}
	return context;
}
