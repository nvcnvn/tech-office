/**
 * SettingsView Component - Project settings with tabbed interface
 * Feature: 017-realtime-task-collaboration-system
 *
 * Tabs:
 * - States: Manage project workflow states (todo, in_progress, done, cancelled)
 * - Levels: Manage task hierarchy levels (Epic, Story, Task, Subtask)
 * - Members: Manage project membership and roles
 * - Custom Fields: Configure custom field definitions
 * - Workflow: Configure automation rules
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
	Box,
	Tabs,
	Tab,
} from '@mui/material';
import CategoryIcon from '@mui/icons-material/Category';
import LayersIcon from '@mui/icons-material/Layers';
import GroupIcon from '@mui/icons-material/Group';
import TuneIcon from '@mui/icons-material/Tune';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import RepeatIcon from '@mui/icons-material/Repeat';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import StatesSettings from './StatesSettings';
import LevelsSettings from './LevelsSettings';
import MembersSettings from './MembersSettings';
import CustomFieldsSettings from './CustomFieldsSettings';
import WorkflowRulesSettings from './WorkflowRulesSettings';
import RitualDefinitionsSettings from './RitualDefinitionsSettings';

// =============================================================================
// Settings Tab Types
// =============================================================================

type SettingsTab = 'states' | 'levels' | 'members' | 'fields' | 'workflow' | 'rituals';

// =============================================================================
// Main Settings View Component
// =============================================================================

export default function SettingsView() {
	const colors = useThemeColors();
	const { project } = useProjectContext();
	const searchParams = useSearchParams();
	const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
		const tab = searchParams?.get('tab');
		if (tab === 'rituals' || tab === 'states' || tab === 'levels' || tab === 'members' || tab === 'fields' || tab === 'workflow') {
			return tab;
		}
		return 'states';
	});

	useEffect(() => {
		const tab = searchParams?.get('tab');
		if (tab === 'rituals' || tab === 'states' || tab === 'levels' || tab === 'members' || tab === 'fields' || tab === 'workflow') {
			setActiveTab(tab);
		}
	}, [searchParams]);

	const handleTabChange = (_event: React.SyntheticEvent, newValue: SettingsTab) => {
		setActiveTab(newValue);
	};

	const showRituals = project?.collaborationMode === 'ritual' || project?.collaborationMode === 'mixed';

	return (
		<Box
			sx={{
				display: 'flex',
				height: '100%',
				...colors.bg.default.style,
			}}
			data-testid="project-settings-view"
		>
			{/* Sidebar Tabs */}
			<Box
				sx={{
					width: 200,
					borderRight: 1,
					...colors.border.default.style,
					...colors.bg.paper.style,
				}}
			>
				<Tabs
					orientation="vertical"
					value={activeTab}
					onChange={handleTabChange}
					sx={{
						'.MuiTab-root': {
							justifyContent: 'flex-start',
							textTransform: 'none',
							minHeight: 48,
							px: 2,
						},
					}}
				>
					<Tab
						icon={<CategoryIcon />}
						iconPosition="start"
						label="States"
						value="states"
						data-testid="settings-tab-states"
					/>
					<Tab
						icon={<LayersIcon />}
						iconPosition="start"
						label="Levels"
						value="levels"
						data-testid="settings-tab-levels"
					/>
					<Tab
						icon={<GroupIcon />}
						iconPosition="start"
						label="Members"
						value="members"
						data-testid="settings-tab-members"
					/>
					<Tab
						icon={<TuneIcon />}
						iconPosition="start"
						label="Custom Fields"
						value="fields"
						data-testid="settings-tab-fields"
					/>
					<Tab
						icon={<AccountTreeIcon />}
						iconPosition="start"
						label="Workflow"
						value="workflow"
						data-testid="settings-tab-workflow"
					/>
					{showRituals && (
						<Tab
							icon={<RepeatIcon />}
							iconPosition="start"
							label="Rituals"
							value="rituals"
							data-testid="settings-tab-rituals"
						/>
					)}
				</Tabs>
			</Box>

			{/* Content Area */}
			<Box sx={{ flex: 1, overflow: 'auto' }}>
				{activeTab === 'states' && <StatesSettings />}
				{activeTab === 'levels' && <LevelsSettings />}
				{activeTab === 'members' && <MembersSettings />}
				{activeTab === 'fields' && <CustomFieldsSettings />}
				{activeTab === 'workflow' && <WorkflowRulesSettings />}			{activeTab === 'rituals' && showRituals && <RitualDefinitionsSettings />}			</Box>
		</Box>
	);
}
