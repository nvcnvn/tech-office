import { expect, test } from '@playwright/test';
import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';

// ---------------------------------------------------------------------------
// Arrange helpers
//
// Departments and department-pool rituals have no wrapper in helpers/api yet, and this is
// the only spec that needs them, so they live here rather than widening the shared surface.
// ---------------------------------------------------------------------------

async function createDepartment(owner: TestUser, name: string) {
	const resp = await api.apiCall<{ department: { id: string } }>(
		owner,
		'/rpc.v1.DepartmentService/CreateDepartment',
		{ name }
	);
	return resp.department.id;
}

async function assignToDepartment(owner: TestUser, departmentId: string, employeeId: string) {
	await api.apiCall(owner, '/rpc.v1.DepartmentService/AssignEmployeeToDepartment', {
		departmentId,
		employeeId,
		role: 'member',
	});
}

async function createRitualWithPool(
	owner: TestUser,
	opts: { projectId: string; name: string; departmentId: string; strategy: string }
) {
	const resp = await api.apiCall<{ ritualDefinition: { id: string } }>(
		owner,
		'/rpc.v1.CollaborationService/CreateRitualDefinition',
		{
			projectId: opts.projectId,
			name: opts.name,
			description: '',
			recurrenceRule: { type: 'RECURRENCE_TYPE_DAILY', interval: 1, daysOfWeek: [], dayOfMonth: 0 },
			completionWindowHours: 24,
			timezone: 'UTC',
			defaultAssigneeIds: [],
			defaultDepartmentPools: [
				{ departmentId: opts.departmentId, assignmentStrategy: opts.strategy },
			],
		}
	);
	return resp.ritualDefinition.id;
}

// waitForRitualInstance polls until the generation sweep has materialised an instance of
// the given definition. The sweep runs once a minute, so this is a wait, not a race.
async function waitForRitualInstance(owner: TestUser, projectId: string, definitionId: string) {
	for (let attempt = 0; attempt < 90; attempt += 1) {
		const response = await api.listTasks(owner, projectId, {
			taskKind: 'TASK_KIND_RITUAL_INSTANCE',
		});
		const match = (response?.tasks ?? []).find(
			(candidate) => candidate.ritualDefinitionId === definitionId
		);
		if (match) {
			return match;
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error(`Timed out waiting for a ritual instance of definition ${definitionId}`);
}

// A ritual-mode project shows a ritual instance on its own page, not in the standard
// project side panel, so that is the surface these scenarios read.
async function openRitualInstance(page: import('@playwright/test').Page, projectId: string, taskId: string) {
	await page.goto(`/workspace/tasks/${projectId}/tasks/${taskId}`);
	await expect(page.getByTestId('ritual-worker-flow-summary').or(page.getByTestId('task-awaiting-shift-banner')).first())
		.toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------

test.describe('Ritual assignment follows the shift', () => {
	let owner: TestUser;
	let worker: TestUser;
	let projectId: string;
	let departmentId: string;

	test.beforeAll(async () => {
		owner = await createTestOrg();
		worker = await createTestEmployee(owner);

		const project = await api.createProject(owner, {
			name: 'Shift-driven rituals',
			visibility: 'PROJECT_VISIBILITY_PUBLIC',
			collaborationMode: 'COLLABORATION_MODE_RITUAL',
		});
		projectId = project.project.id;

		departmentId = await createDepartment(owner, `Shop floor ${crypto.randomUUID().slice(0, 8)}`);
		await assignToDepartment(owner, departmentId, worker.id);
	});

	test('the strategy selector offers on-shift alongside round-robin and least-assigned', async ({ page }) => {
		await loginAs(page, owner);
		const definitionId = await createRitualWithPool(owner, {
			projectId,
			name: 'Selector check',
			departmentId,
			strategy: 'round_robin',
		});

		await page.goto(`/workspace/tasks/${projectId}/rituals/${definitionId}`);
		const strategySelect = page.getByTestId(`dept-pool-strategy-${departmentId}`);
		await expect(strategySelect).toBeVisible();

		await strategySelect.click();
		await expect(page.getByRole('option', { name: 'Round-robin' })).toBeVisible();
		await expect(page.getByRole('option', { name: 'Least-assigned' })).toBeVisible();
		await expect(page.getByRole('option', { name: 'On-shift' })).toBeVisible();
	});

	test('the pool explains that on-shift depends on shift events for that department', async ({ page }) => {
		await loginAs(page, owner);
		const definitionId = await createRitualWithPool(owner, {
			projectId,
			name: 'Helper text check',
			departmentId,
			strategy: 'on_shift',
		});

		await page.goto(`/workspace/tasks/${projectId}/rituals/${definitionId}`);
		await expect(page.getByText(/shift on the calendar covering the instance/i)).toBeVisible();
		await expect(page.getByText(/stays unassigned and is filled in as soon as the shifts appear/i)).toBeVisible();
	});

	test('switching an existing ritual from round-robin to on-shift persists and keeps the definition intact', async ({ page }) => {
		await loginAs(page, owner);
		const definitionId = await createRitualWithPool(owner, {
			projectId,
			name: 'Switch to on-shift',
			departmentId,
			strategy: 'round_robin',
		});

		await page.goto(`/workspace/tasks/${projectId}/rituals/${definitionId}`);
		const strategySelect = page.getByTestId(`dept-pool-strategy-${departmentId}`);
		await expect(strategySelect).toBeVisible();

		await strategySelect.click();
		await page.getByRole('option', { name: 'On-shift' }).click();
		await page.getByTestId('save-ritual-btn').click();

		// Reload from the server rather than trusting the client's own state.
		await page.goto(`/workspace/tasks/${projectId}/rituals/${definitionId}`);
		await expect(page.getByTestId(`dept-pool-strategy-${departmentId}`)).toContainText('On-shift');
		await expect(page.locator('input[value="Switch to on-shift"]')).toBeVisible();
	});

	test('an instance waiting for the rota explains that nobody is rostered for its date', async ({ page }) => {
		const definitionId = await createRitualWithPool(owner, {
			projectId,
			name: 'Waiting for the rota',
			departmentId,
			strategy: 'on_shift',
		});
		const instance = await waitForRitualInstance(owner, projectId, definitionId);

		await loginAs(page, owner);
		await openRitualInstance(page, projectId, instance.id);

		await expect(page.getByTestId('task-awaiting-shift-banner')).toBeVisible();
		await expect(page.getByTestId('task-awaiting-shift-banner')).toContainText(/nobody in the department is rostered/i);
	});

	test('an instance with no assignee configured shows no waiting-for-rota explanation', async ({ page }) => {
		const definition = await api.createRitualDefinition(owner, {
			projectId,
			name: 'No pool at all',
		});
		const instance = await waitForRitualInstance(owner, projectId, definition.ritualDefinition.id);

		await loginAs(page, owner);
		await openRitualInstance(page, projectId, instance.id);

		// Unassigned for an ordinary reason: nobody was ever configured. There is nothing
		// to explain, and claiming a rota is missing would be false.
		await expect(page.getByTestId('task-awaiting-shift-banner')).toHaveCount(0);
	});
});
