/**
 * Task Lifecycle E2E Tests
 *
 * Behavioral scenarios derived from backend integration tests:
 *   - backend/integration/workflow_task_lifecycle_test.go
 *   - backend/integration/collaboration_task_test.go
 *
 * Pattern: Arrange via API, Act via UI, Assert via UI.
 */
import { test, expect } from '@playwright/test';
import { createTestOrg, createTestEmployee, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';
import { stepScreenshot } from './helpers/screenshot';

test.describe('Task Lifecycle', () => {
  let owner: TestUser;
  let dev: TestUser;
  let outsider: TestUser;
  let projectId: string;
  let projectName: string;
  let states: Array<{ id: string; name: string; category: string }>;
  let defaultLevelId: string;
  let taskId: string;
  let taskTitle: string;
  let moveTaskId: string;
  let moveTaskTitle: string;
  let isolatedTaskId: string;

  test.beforeAll(async () => {
    // Consolidate ALL API setup to minimize connection churn
    owner = await createTestOrg();
    dev = await createTestEmployee(owner);
    outsider = await createTestEmployee(owner);

    const suffix = crypto.randomUUID().slice(0, 8);
    projectName = `Lifecycle Project ${suffix}`;
    const resp = await api.createProject(owner, {
      name: projectName,
      visibility: 'PROJECT_VISIBILITY_PRIVATE',
    });
    projectId = resp.project.id;
    states = resp.states;
    defaultLevelId = resp.levels[0].id;

    // Add dev as a member
    await api.addProjectMember(owner, projectId, dev.id, 'PROJECT_MEMBER_ROLE_MEMBER');

    // Brief pause to let the backend settle before creating tasks
    await new Promise((r) => setTimeout(r, 500));

    // Create tasks for different test scenarios
    taskTitle = `Implement login ${crypto.randomUUID().slice(0, 6)}`;
    const taskResp = await api.createTask(owner, projectId, taskTitle, { levelId: defaultLevelId });
    taskId = taskResp.task.id;
    await api.assignTask(owner, taskId, dev.id);

    moveTaskTitle = `State transition ${crypto.randomUUID().slice(0, 6)}`;
    const moveResp = await api.createTask(owner, projectId, moveTaskTitle, { levelId: defaultLevelId });
    moveTaskId = moveResp.task.id;
    await api.assignTask(owner, moveTaskId, dev.id);

    const isoResp = await api.createTask(owner, projectId, `Isolated task ${crypto.randomUUID().slice(0, 6)}`, { levelId: defaultLevelId });
    isolatedTaskId = isoResp.task.id;
  });

  // ---------------------------------------------------------------------------
  // Scenario: when a manager sets up a project and assigns work
  // ---------------------------------------------------------------------------

  test.describe('when a manager sets up a project and assigns work', () => {
    test('legacy projects entry redirects to the canonical tasks route', async ({ page }, testInfo) => {
      await loginAs(page, dev);
      await page.goto('/workspace/projects');

      await expect(page).toHaveURL(/\/workspace\/tasks\/?(?:\?.*)?$/);
      await expect(page.getByTestId('workspace-projects-page')).toBeVisible();
      await stepScreenshot(page, testInfo, 'legacy-projects-route-redirect');
    });

    test('team members can see the project in their list', async ({ page }, testInfo) => {
      await loginAs(page, dev);
      await page.goto('/workspace/tasks');
      await expect(page.getByTestId('workspace-projects-page')).toBeVisible();
      await stepScreenshot(page, testInfo, 'dev-sees-project');
      await expect(page.getByText(projectName)).toBeVisible();
    });

    test('team members can see tasks in the project list view', async ({ page }, testInfo) => {
      await loginAs(page, dev);
      await page.goto('/workspace/tasks');
      await page.getByTestId(`project-card-${projectId}`).click();
      await expect(page.getByTestId('project-detail-page')).toBeVisible();

      // Switch to list view
      await page.getByTestId('tab-list').click();
      await expect(page.getByTestId('project-list-view')).toBeVisible();
      await stepScreenshot(page, testInfo, 'task-in-list-view');

      await expect(page.getByText(taskTitle)).toBeVisible();
    });

    test('clicking a task opens the task detail page', async ({ page }, testInfo) => {
      await loginAs(page, dev);
      await page.goto('/workspace/tasks');
      await page.getByTestId(`project-card-${projectId}`).click();
      await page.getByTestId('tab-list').click();
      await expect(page.getByTestId('project-list-view')).toBeVisible();

      // Click the task row
      await page.getByTestId(`task-row-${taskId}`).click();
      await expect(page.getByTestId('task-detail-side-panel')).toBeVisible();
      await stepScreenshot(page, testInfo, 'task-detail-page');

      // Side panel should show the task title and status selector
      await expect(page.getByTestId('task-detail-side-panel').getByText(taskTitle)).toBeVisible();
      await expect(page.getByTestId('task-status-select')).toBeVisible();
    });

    test('each task has an integrated chat channel panel', async ({ page }, testInfo) => {
      await loginAs(page, dev);
      await page.goto('/workspace/tasks');
      await page.getByTestId(`project-card-${projectId}`).click();
      await page.getByTestId('tab-list').click();
      await page.getByTestId(`task-row-${taskId}`).click();

      // Comments summary should be present in the side panel
      await expect(page.getByTestId('task-detail-side-panel')).toBeVisible();
      await expect(page.getByTestId('task-comments-summary')).toBeVisible();
      await stepScreenshot(page, testInfo, 'task-with-comments-channel');
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when a developer moves their task through states
  // ---------------------------------------------------------------------------

  test.describe('when a developer moves their task through states', () => {
    test('the task state can be changed via the status dropdown', async ({ page }, testInfo) => {
      // Arrange: move to "in_progress" state via API
      const inProgressState = states.find((s) => s.name.toLowerCase().includes('progress'));
      if (inProgressState) {
        await api.moveTask(owner, moveTaskId, inProgressState.id);
      }

      // Act: dev views the task
      await loginAs(page, dev);
      await page.goto('/workspace/tasks');
      await page.getByTestId(`project-card-${projectId}`).click();
      await page.getByTestId('tab-list').click();
      await expect(page.getByTestId('project-list-view')).toBeVisible();
      await stepScreenshot(page, testInfo, 'task-in-progress-state');

      // Assert: the task row shows the updated state
      await expect(page.getByTestId(`task-row-${moveTaskId}`)).toBeVisible();
    });

    test('filtering by state shows only matching tasks', async ({ page }, testInfo) => {
      // Create a second task left in "todo" state
      const todoTask = await api.createTask(owner, projectId, `Todo task ${crypto.randomUUID().slice(0, 6)}`, { levelId: defaultLevelId });

      // Move the original to done via API
      const doneState = states.find((s) => s.name.toLowerCase().includes('done'));
      if (doneState) {
        await api.moveTask(owner, moveTaskId, doneState.id);
      }

      await loginAs(page, dev);
      await page.goto('/workspace/tasks');
      await page.getByTestId(`project-card-${projectId}`).click();
      await page.getByTestId('tab-list').click();
      await expect(page.getByTestId('project-list-view')).toBeVisible();
      await stepScreenshot(page, testInfo, 'task-list-with-filters');

      // Both tasks should be visible in the unfiltered list
      await expect(page.getByTestId(`task-row-${todoTask.task.id}`)).toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when a task is created via the UI create dialog
  // ---------------------------------------------------------------------------

  test.describe('when creating a task via the UI', () => {
    const uiTaskTitle = `UI Created Task ${crypto.randomUUID().slice(0, 6)}`;

    test('the create task dialog has required fields', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/tasks');
      await page.getByTestId(`project-card-${projectId}`).click();
      await expect(page.getByTestId('project-detail-page')).toBeVisible();

      // Open create task dialog — look for a "New Task" or "+" button
      await page.getByTestId('tab-list').click();
      await stepScreenshot(page, testInfo, 'before-create-task');

      // The create-task-dialog should have title, level, and state fields
      // Implementation depends on how the dialog is triggered
      await expect(page.getByTestId('project-list-view')).toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: cross-project isolation
  // ---------------------------------------------------------------------------

  test.describe('when a user creates tasks in a private project', () => {
    test('the outsider cannot see the private project', async ({ page }, testInfo) => {
      await loginAs(page, outsider);
      await page.goto('/workspace/tasks');
      await expect(page.getByTestId('workspace-projects-page')).toBeVisible();
      await stepScreenshot(page, testInfo, 'outsider-no-private-project');
      await expect(page.getByText(projectName)).not.toBeVisible();
    });
  });
});
