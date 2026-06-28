import { expect, test } from '@playwright/test';
import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';

function splitRitualTasksBySchedule(tasks: Array<Record<string, unknown>>) {
	const today = new Date().toISOString().slice(0, 10);
	const scheduledTasks = tasks
		.map((task) => {
			const scheduledDate =
				typeof task.scheduledDate === 'string' && task.scheduledDate.length >= 10
					? task.scheduledDate.slice(0, 10)
					: null;
			if (!scheduledDate) {
				return null;
			}

			return {
				task,
				scheduledDate,
			};
		})
		.filter((entry): entry is { task: Record<string, unknown>; scheduledDate: string } => entry !== null)
		.sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate));

	const todayTask = scheduledTasks.find((entry) => entry.scheduledDate === today)?.task;
	const futureTasks = scheduledTasks
		.filter((entry) => entry.scheduledDate > today && entry.task.id !== todayTask?.id)
		.map((entry) => entry.task);

	if (!todayTask || futureTasks.length === 0) {
		return null;
	}

	return { todayTask, futureTasks };
}

async function waitForRitualTaskSeriesByDefinition(
	owner: TestUser,
	projectId: string,
	definitionId: string
) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const response = await api.listTasks(owner, projectId, {
			taskKind: 'TASK_KIND_RITUAL_INSTANCE',
		});
		const tasks = Array.isArray(response?.tasks)
			? (response.tasks as Array<Record<string, unknown>>).filter(
				(candidate) => candidate.ritualDefinitionId === definitionId
			)
			: [];
		const series = splitRitualTasksBySchedule(tasks);
		if (series) {
			return series;
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	throw new Error(`Timed out waiting for ritual task series for definition ${definitionId} in ${projectId}`);
}

async function waitForRitualTaskState(
	owner: TestUser,
	taskId: string,
	predicate: (task: Record<string, unknown>) => boolean,
	description: string
) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const response = (await api.getTask(owner, taskId)) as { task?: Record<string, unknown> };
		const task = response.task;
		if (task && predicate(task)) {
			return task;
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	throw new Error(`Timed out waiting for ${description} on ritual task ${taskId}`);
}

test.describe('Ritual UX Redesign', () => {
	test.describe('when a member opens a standard project without an explicit view', () => {
		// FR-001, FR-002, Phase 3 / T012
		let owner: TestUser;
		let projectId: string;

		test.beforeAll(async () => {
			owner = await createTestOrg();
			const project = await api.createProject(owner, {
				name: `Ritual UX Standard ${crypto.randomUUID().slice(0, 8)}`,
				visibility: 'PROJECT_VISIBILITY_PRIVATE',
				collaborationMode: 'COLLABORATION_MODE_STANDARD',
			});
			projectId = project.project.id;
		});

		test('the project opens on a planning-first standard surface', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}`);

			await expect(page.getByTestId('project-detail-page')).toBeVisible();
			await expect(page.getByTestId('project-view-panel-board')).toBeVisible({ timeout: 15_000 });
			await expect(page.getByTestId('tab-board')).toHaveAttribute('aria-selected', 'true');
		});

		test('ritual-only navigation is not presented as the primary standard information architecture', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}`);

			await expect(page.getByTestId('tab-today')).toHaveCount(0);
			await expect(page.getByTestId('tab-review')).toHaveCount(0);
			await expect(page.getByTestId('tab-health')).toHaveCount(0);
		});
	});

	test.describe('when a worker opens a ritual project without an explicit view', () => {
		// FR-001, FR-003, FR-005, FR-006, FR-007, FR-021, Phase 3 / T012
		let owner: TestUser;
		let worker: TestUser;
		let projectId: string;
		let overdueTaskId: string;
		let todayTaskId: string;
		let rejectedTaskId: string;
		let pendingTaskId: string;
		let rejectedRequirementId: string;

		test.beforeAll(async () => {
			test.setTimeout(120_000);

			owner = await createTestOrg();
			worker = await createTestEmployee(owner);

			const project = await api.createProject(owner, {
				name: `Ritual UX Worker ${crypto.randomUUID().slice(0, 8)}`,
				visibility: 'PROJECT_VISIBILITY_PRIVATE',
				collaborationMode: 'COLLABORATION_MODE_RITUAL',
			});
			projectId = project.project.id;
			await api.addProjectMember(owner, projectId, worker.id, 'PROJECT_MEMBER_ROLE_MEMBER');

			const definition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Worker Flow ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});
			await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: definition.ritualDefinition.id,
				name: 'Retry proof note',
			});

			const primarySeries = await waitForRitualTaskSeriesByDefinition(
				owner,
				projectId,
				definition.ritualDefinition.id
			);
			todayTaskId = primarySeries.todayTask.id as string;
			overdueTaskId = primarySeries.futureTasks[0].id as string;

			const rejectedDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Rejected Flow ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});
			const rejectedRequirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: rejectedDefinition.ritualDefinition.id,
				name: 'Rejected flow note',
			});
			rejectedRequirementId = rejectedRequirement.evidenceRequirement.id;
			const rejectedSeries = await waitForRitualTaskSeriesByDefinition(
				owner,
				projectId,
				rejectedDefinition.ritualDefinition.id
			);
			rejectedTaskId = rejectedSeries.todayTask.id as string;

			const pendingDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Pending Flow ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});
			const pendingRequirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: pendingDefinition.ritualDefinition.id,
				name: 'Pending flow note',
			});
			const pendingSeries = await waitForRitualTaskSeriesByDefinition(
				owner,
				projectId,
				pendingDefinition.ritualDefinition.id
			);
			pendingTaskId = pendingSeries.todayTask.id as string;

			api.forceRitualTaskOverdue(overdueTaskId);
			await waitForRitualTaskState(
				owner,
				overdueTaskId,
				(task) =>
					typeof task.scheduledDate === 'string' &&
					task.scheduledDate.slice(0, 10) < new Date().toISOString().slice(0, 10),
				'overdue schedule change'
			);

			const rejectedSubmission = await api.submitEvidence(worker, {
				taskId: rejectedTaskId,
				evidenceRequirementId: rejectedRequirementId,
				textContent: 'First proof attempt needs correction',
			});
			await api.rejectEvidence(owner, {
				evidenceSubmissionId: rejectedSubmission.evidenceSubmission.id,
				comment: 'Add the actual reading to the note.',
			});
			await waitForRitualTaskState(
				owner,
				rejectedTaskId,
				(task) => Number((task.evidenceProgress as { rejectedCount?: number } | undefined)?.rejectedCount ?? 0) > 0,
				'rejected evidence status'
			);

			await api.submitEvidence(worker, {
				taskId: pendingTaskId,
				evidenceRequirementId: pendingRequirement.evidenceRequirement.id,
				textContent: 'Pending review submission',
			});
			await waitForRitualTaskState(
				owner,
				pendingTaskId,
				(task) => Number((task.evidenceProgress as { pendingReviewCount?: number } | undefined)?.pendingReviewCount ?? 0) > 0,
				'pending review status'
			);
		});

		test('the project opens on Today instead of the generic board', async ({ page }) => {
			await loginAs(page, worker);
			await page.goto(`/workspace/tasks/${projectId}`);

			await expect(page.getByTestId('project-view-panel-today')).toBeVisible();
			await expect(page.getByTestId('tab-today')).toHaveAttribute('aria-selected', 'true');
		});

		test('overdue due-now and resubmission items are grouped into task-first urgency sections', async ({ page }) => {
			await loginAs(page, worker);
			await page.goto(`/workspace/tasks/${projectId}`);

			await expect(page.getByTestId('today-ritual-section-overdue')).toContainText('Overdue');
			await expect(page.getByTestId(`today-task-card-${overdueTaskId}`)).toBeVisible();
			await expect(page.getByTestId('today-ritual-section-needsResubmission')).toContainText('Needs Resubmission');
			await expect(page.getByTestId(`today-task-card-${rejectedTaskId}`)).toBeVisible();
			await expect(page.getByTestId('today-ritual-section-today')).toContainText('Due Today');
			await expect(page.getByTestId(`today-task-card-${todayTaskId}`)).toBeVisible();
		});

		test('pending-review items remain a secondary awareness cue rather than replacing worker action groups', async ({ page }) => {
			await loginAs(page, worker);
			await page.goto(`/workspace/tasks/${projectId}`);

			await expect(page.getByTestId('today-ritual-pending-review-alert')).toContainText('waiting for review');
			await expect(page.getByTestId(`today-task-card-${pendingTaskId}`)).toHaveCount(0);
		});

		test('opening a ritual row routes to the live instance with the affected requirement focused', async ({ page }) => {
			await loginAs(page, worker);
			await page.goto(`/workspace/tasks/${projectId}`);

			await page.getByTestId(`open-task-btn-${rejectedTaskId}`).click();

			await expect.poll(() => page.url()).toContain(`/workspace/tasks/${projectId}/tasks/${rejectedTaskId}`);
			await expect.poll(() => page.url()).toContain('focusIntent=submit_requirement');
			await expect(page.getByTestId('ritual-worker-flow-summary')).toBeVisible();
			await expect(page.getByTestId(`evidence-req-row-${rejectedRequirementId}`)).toHaveAttribute('data-highlighted-requirement', 'true');
			await expect(page.getByTestId(`submit-evidence-btn-${rejectedRequirementId}`)).toContainText('Resubmit Proof');
		});
	});

	test.describe('when an owner or reviewer opens a ritual project', () => {
		// FR-008, FR-009, FR-010, FR-011
		let owner: TestUser;
		let worker: TestUser;
		let projectId: string;
		let pendingTaskId: string;

		test.beforeAll(async () => {
			test.setTimeout(120_000);

			owner = await createTestOrg();
			worker = await createTestEmployee(owner);

			const project = await api.createProject(owner, {
				name: `Ritual UX Owner ${crypto.randomUUID().slice(0, 8)}`,
				visibility: 'PROJECT_VISIBILITY_PRIVATE',
				collaborationMode: 'COLLABORATION_MODE_RITUAL',
			});
			projectId = project.project.id;
			await api.addProjectMember(owner, projectId, worker.id, 'PROJECT_MEMBER_ROLE_MEMBER');

			const definition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Owner Surface ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});
			const requirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: definition.ritualDefinition.id,
				name: 'Owner review proof',
			});

			const series = await waitForRitualTaskSeriesByDefinition(owner, projectId, definition.ritualDefinition.id);
			pendingTaskId = series.todayTask.id as string;

			await api.submitEvidence(worker, {
				taskId: pendingTaskId,
				evidenceRequirementId: requirement.evidenceRequirement.id,
				textContent: 'Proof waiting for owner review',
			});
			await waitForRitualTaskState(
				owner,
				pendingTaskId,
				(task) => Number((task.evidenceProgress as { pendingReviewCount?: number } | undefined)?.pendingReviewCount ?? 0) > 0,
				'owner pending review status'
			);
		});

		test('Today Review Health Calendar and Worklist are exposed as distinct ritual surfaces', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}`);

			await expect(page.getByTestId('tab-today')).toHaveAttribute('aria-selected', 'true');
			await expect(page.getByTestId('tab-review')).toBeVisible();
			await expect(page.getByTestId('tab-health')).toBeVisible();
			await expect(page.getByTestId('tab-calendar')).toBeVisible();
			await expect(page.getByTestId('tab-worklist')).toBeVisible();

			await page.getByTestId('tab-review').click();
			await expect(page.getByTestId('project-review-view')).toBeVisible();
			await expect(page.getByTestId('ritual-review-backlog')).toBeVisible();
			await expect(page.getByTestId('ritual-review-section-ready')).toContainText('Ready for Review');

			await page.getByTestId('tab-health').click();
			await expect(page.getByTestId('health-dashboard')).toBeVisible();
			await expect(page.getByTestId('health-summary-cards')).toBeVisible();
			await expect(page.getByTestId('pending-review-card')).toBeVisible();

			await page.getByTestId('tab-calendar').click();
			await expect(page.getByTestId('project-calendar-view')).toBeVisible();
			await expect(page.getByTestId('ritual-calendar-guidance')).toBeVisible();

			await page.getByTestId('tab-worklist').click();
			await expect(page.getByTestId('ritual-worklist-view')).toBeVisible();
			await expect(page.getByTestId('ritual-worklist-guidance')).toBeVisible();
		});

		test('worklist behaves as the primary ritual browsing surface instead of the generic board', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}`);

			await expect(page.getByTestId('tab-today')).toHaveAttribute('aria-selected', 'true');
			await page.getByTestId('tab-worklist').click();

			await expect(page.getByTestId('tab-worklist')).toHaveAttribute('aria-selected', 'true');
			await expect(page.getByTestId('ritual-worklist-view')).toBeVisible();
			await expect(page.getByTestId(`task-row-${pendingTaskId}`)).toBeVisible();
			await expect(page.getByTestId('tab-board')).toContainText('Board (Secondary)');
		});

		test('if a board is available it is not the default route or first ritual call to action', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}`);

			await expect(page.getByTestId('tab-today')).toHaveAttribute('aria-selected', 'true');
			await expect(page.getByTestId('project-view-panel-today')).toBeVisible();
			await expect(page.getByTestId('tab-board')).toContainText('Board (Secondary)');

			await page.getByTestId('tab-board').click();
			await expect(page.getByTestId('project-board-view')).toBeVisible();
			await expect(page.getByTestId('ritual-board-secondary-alert')).toBeVisible();
		});

		test('template management remains separate from live submission actions', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}`);

			await page.getByTestId('open-ritual-template-management-btn').click();

			await expect(page.getByTestId('project-view-panel-settings')).toBeVisible();
			await expect(page.getByTestId('settings-tab-rituals')).toHaveAttribute('aria-selected', 'true');
			await expect(page.getByTestId('ritual-definitions-settings')).toBeVisible();

			await page.getByTestId('create-ritual-definition-btn').click();
			await expect(page.getByTestId('ritual-template-management-alert')).toBeVisible();
			await expect(page.getByTestId('ritual-definition-template-copy')).toBeVisible();
			await expect.poll(() => page.url()).toContain(`/workspace/tasks/${projectId}/rituals/new`);
			await expect(page).not.toHaveURL(new RegExp(`/workspace/tasks/${projectId}/tasks/`));
		});
	});

	test.describe('when a member opens a mixed project without an explicit view', () => {
		// FR-004, FR-012, FR-013, FR-014, FR-015
		let owner: TestUser;
		let worker: TestUser;
		let projectId: string;
		let standardTaskId: string;
		let ritualTaskId: string;

		test.beforeAll(async () => {
			test.setTimeout(120_000);

			owner = await createTestOrg();
			worker = await createTestEmployee(owner);

			const project = await api.createProject(owner, {
				name: `Ritual UX Mixed ${crypto.randomUUID().slice(0, 8)}`,
				visibility: 'PROJECT_VISIBILITY_PRIVATE',
				collaborationMode: 'COLLABORATION_MODE_MIXED',
			});
			projectId = project.project.id;
			await api.addProjectMember(owner, projectId, worker.id, 'PROJECT_MEMBER_ROLE_MEMBER');

			const createdTask = await api.createTask(owner, projectId, 'Prepare shift handoff checklist', {
				levelId: project.levels[0]?.id,
			});
			standardTaskId = createdTask.task.id;
			api.setStandardTaskDueToday(standardTaskId);

			const definition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Mixed Routine ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});
			const series = await waitForRitualTaskSeriesByDefinition(owner, projectId, definition.ritualDefinition.id);
			ritualTaskId = series.todayTask.id as string;
		});

		test('the project opens on Overview with both planned-work risk and routine-operations exceptions', async ({ page }) => {
			await loginAs(page, worker);
			await page.goto(`/workspace/tasks/${projectId}`);

			await expect(page.getByTestId('tab-overview')).toHaveAttribute('aria-selected', 'true');
			await expect(page.getByTestId('mixed-overview-view')).toBeVisible();
			await expect(page.getByTestId('overview-summary-planned-work-card')).toContainText('Planned Work');
			await expect(page.getByTestId('overview-summary-routine-operations-card')).toContainText('Routine Operations');
			await expect(page.getByTestId('overview-needs-attention-list')).toBeVisible();
			await expect(page.getByTestId(`overview-needs-attention-item-${standardTaskId}`)).toBeVisible();
		});

		test('Today keeps standard tasks and ritual runs in separate labeled sections', async ({ page }) => {
			await loginAs(page, worker);
			await page.goto(`/workspace/tasks/${projectId}?view=today`);

			await expect(page.getByTestId('project-view-panel-today')).toBeVisible();
			await expect(page.getByTestId('mixed-today-standard-section')).toContainText('Standard Tasks Due Today');
			await expect(page.getByTestId('mixed-today-ritual-section')).toContainText('Ritual Runs Due Today');
			await expect(page.getByTestId(`today-task-card-${standardTaskId}`)).toBeVisible();
			await expect(page.getByTestId(`today-task-card-${ritualTaskId}`)).toBeVisible();
		});

		test('planned work and routine operations route to non-overlapping destinations', async ({ page }) => {
			await loginAs(page, worker);
			await page.goto(`/workspace/tasks/${projectId}`);

			await expect(page.getByTestId('tab-board')).toContainText('Planned Work');
			await expect(page.getByTestId('tab-calendar')).toContainText('Routine Operations');

			await page.getByTestId('overview-open-planned-work-btn').click();
			await expect.poll(() => page.url()).toContain(`view=board`);
			await expect(page.getByTestId('mixed-planned-work-gantt-alert')).toHaveCount(0);

			await page.getByTestId('tab-overview').click();
			await page.getByTestId('overview-open-routine-operations-btn').click();
			await expect.poll(() => page.url()).toContain(`view=calendar`);
			await expect(page.getByTestId('mixed-routine-operations-guidance')).toBeVisible();
			await expect(page.getByTestId(`calendar-ritual-group-${ritualTaskId}`)).toBeVisible();
			await expect(page.getByTestId(`calendar-task-${standardTaskId}`)).toHaveCount(0);

			await page.goto(`/workspace/tasks/${projectId}?view=gantt`);
			await expect(page.getByTestId('mixed-planned-work-gantt-alert')).toBeVisible();
			await expect(page.getByTestId('project-gantt-view')).toContainText('Prepare shift handoff checklist');
			await expect(page.getByTestId('project-gantt-view')).not.toContainText('Mixed Routine');
		});
	});

	test.describe('when a mobile worker or reviewer opens a ritual instance from tasks or alerts', () => {
		// FR-016, FR-017, FR-018, FR-019
		let owner: TestUser;
		let worker: TestUser;
		let projectId: string;
		let rejectedTaskId: string;
		let rejectedRequirementId: string;
		let pendingTaskId: string;
		let pendingRequirementId: string;
		let dualRoleTaskId: string;
		let skipTaskId: string;

		test.beforeAll(async () => {
			test.setTimeout(120_000);

			owner = await createTestOrg();
			worker = await createTestEmployee(owner);

			const project = await api.createProject(owner, {
				name: `Ritual UX Task Entry ${crypto.randomUUID().slice(0, 8)}`,
				visibility: 'PROJECT_VISIBILITY_PRIVATE',
				collaborationMode: 'COLLABORATION_MODE_RITUAL',
			});
			projectId = project.project.id;
			await api.addProjectMember(owner, projectId, worker.id, 'PROJECT_MEMBER_ROLE_MEMBER');

			const rejectedDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Rejected Entry ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});
			const rejectedRequirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: rejectedDefinition.ritualDefinition.id,
				name: 'Rejected entry note',
			});
			rejectedRequirementId = rejectedRequirement.evidenceRequirement.id;
			const rejectedSeries = await waitForRitualTaskSeriesByDefinition(
				owner,
				projectId,
				rejectedDefinition.ritualDefinition.id
			);
			rejectedTaskId = rejectedSeries.todayTask.id as string;
			const rejectedSubmission = await api.submitEvidence(worker, {
				taskId: rejectedTaskId,
				evidenceRequirementId: rejectedRequirementId,
				textContent: 'Initial note needs correction',
			});
			await api.rejectEvidence(owner, {
				evidenceSubmissionId: rejectedSubmission.evidenceSubmission.id,
				comment: 'Add the actual reading to the note.',
			});

			const pendingDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Review Entry ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});
			const pendingRequirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: pendingDefinition.ritualDefinition.id,
				name: 'Review entry note',
			});
			pendingRequirementId = pendingRequirement.evidenceRequirement.id;
			const pendingSeries = await waitForRitualTaskSeriesByDefinition(
				owner,
				projectId,
				pendingDefinition.ritualDefinition.id
			);
			pendingTaskId = pendingSeries.todayTask.id as string;
			await api.submitEvidence(worker, {
				taskId: pendingTaskId,
				evidenceRequirementId: pendingRequirementId,
				textContent: 'Pending review submission',
			});
			await waitForRitualTaskState(
				owner,
				pendingTaskId,
				(task) => Number((task.evidenceProgress as { pendingReviewCount?: number } | undefined)?.pendingReviewCount ?? 0) > 0,
				'pending review entry state'
			);

			const dualRoleDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Dual Role Entry ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [owner.id, worker.id],
			});
			const dualRoleRequirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: dualRoleDefinition.ritualDefinition.id,
				name: 'Dual role note A',
			});
			await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: dualRoleDefinition.ritualDefinition.id,
				name: 'Dual role note B',
			});
			const dualRoleSeries = await waitForRitualTaskSeriesByDefinition(
				owner,
				projectId,
				dualRoleDefinition.ritualDefinition.id
			);
			dualRoleTaskId = dualRoleSeries.todayTask.id as string;
			await api.submitEvidence(worker, {
				taskId: dualRoleTaskId,
				evidenceRequirementId: dualRoleRequirement.evidenceRequirement.id,
				textContent: 'Worker proof waiting for owner review',
			});

			const skipDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Skipped Entry ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [owner.id],
			});
			const skipSeries = await waitForRitualTaskSeriesByDefinition(
				owner,
				projectId,
				skipDefinition.ritualDefinition.id
			);
			skipTaskId = skipSeries.todayTask.id as string;
			await api.skipRitualInstance(owner, {
				taskId: skipTaskId,
				reason: 'Site closed for maintenance',
			});
		});

		test('the mobile flow lands on the live instance with an obvious next proof action', async ({ page }) => {
			await loginAs(page, worker);
			await page.goto(
				`/workspace/tasks/${projectId}/tasks/${rejectedTaskId}?focusIntent=submit_requirement&requirementId=${rejectedRequirementId}`
			);

			await expect(page.getByTestId('ritual-worker-flow-summary')).toBeVisible();
			await expect(page.getByTestId('ritual-evidence-section')).toBeVisible();
			await expect(page.getByTestId(`evidence-req-row-${rejectedRequirementId}`)).toHaveAttribute(
				'data-highlighted-requirement',
				'true'
			);
			await expect(page).toHaveURL(new RegExp(`/workspace/tasks/${projectId}/tasks/${rejectedTaskId}`));
		});

		test('alert-driven review entry highlights the pending submission instead of a backlog queue', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(
				`/workspace/tasks/${projectId}/tasks/${pendingTaskId}?focusIntent=review_pending&requirementId=${pendingRequirementId}`
			);

			await expect(page.getByTestId('ritual-review-section')).toBeVisible();
			await expect(page.getByTestId('ritual-evidence-section')).toBeVisible();
			await expect(page.getByTestId(`evidence-req-row-${pendingRequirementId}`)).toHaveAttribute(
				'data-highlighted-requirement',
				'true'
			);
			await expect(page).not.toHaveURL(new RegExp('/workspace/tasks/.+\?view=review'));
		});

		test('dual-role users see separate proof and review sections', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}/tasks/${dualRoleTaskId}`);

			await expect(page.getByTestId('ritual-dual-role-alert')).toBeVisible();
			await expect(page.getByTestId('ritual-evidence-section')).toBeVisible();
			await expect(page.getByTestId('ritual-review-section')).toBeVisible();
		});
	});

	test.describe('when the ritual instance is skipped detached or already completed', () => {
		// FR-020
		let owner: TestUser;
		let projectId: string;
		let skipTaskId: string;

		test.beforeAll(async () => {
			owner = await createTestOrg();

			const project = await api.createProject(owner, {
				name: `Ritual UX Exceptional ${crypto.randomUUID().slice(0, 8)}`,
				visibility: 'PROJECT_VISIBILITY_PRIVATE',
				collaborationMode: 'COLLABORATION_MODE_RITUAL',
			});
			projectId = project.project.id;

			const skipDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Skipped Exceptional ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [owner.id],
			});
			const skipSeries = await waitForRitualTaskSeriesByDefinition(
				owner,
				projectId,
				skipDefinition.ritualDefinition.id
			);
			skipTaskId = skipSeries.todayTask.id as string;
			await api.skipRitualInstance(owner, {
				taskId: skipTaskId,
				reason: 'Site closed for maintenance',
			});
		});

		test('instance-specific exceptional context is preserved across task and notification entry', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}/tasks/${skipTaskId}?focusIntent=view_instance&entryContext=skipped`);

			await expect(page.getByTestId('ritual-skip-context-alert')).toContainText('Site closed for maintenance');
			await expect(page.getByTestId('ritual-worker-flow-summary')).toBeVisible();
		});
	});
});