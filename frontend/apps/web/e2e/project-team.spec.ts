/**
 * Project Team Management E2E Tests
 *
 * Behavioral scenarios derived from backend integration tests:
 *   - backend/integration/workflow_project_team_test.go
 *   - backend/integration/collaboration_membership_test.go
 *
 * Pattern: Arrange via API, Act via UI, Assert via UI.
 */
import { test, expect } from '@playwright/test';
import { createTestOrg, createTestEmployee, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';
import { stepScreenshot } from './helpers/screenshot';

test.describe('Project Team Management', () => {
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let projectId: string;
  let projectName: string;

  test.beforeAll(async () => {
    owner = await createTestOrg();
    member = await createTestEmployee(owner);
    outsider = await createTestEmployee(owner);

    const suffix = crypto.randomUUID().slice(0, 8);
    projectName = `Team Project ${suffix}`;
    const resp = await api.createProject(owner, {
      name: projectName,
      visibility: 'PROJECT_VISIBILITY_PRIVATE',
    });
    projectId = resp.project.id;
  });

  // ---------------------------------------------------------------------------
  // Scenario: when a team is assembled on a private project
  // ---------------------------------------------------------------------------

  test.describe('when a team is assembled on a private project', () => {
    test('initially only the owner can see the project', async ({ page }, testInfo) => {
      await loginAs(page, outsider);
      await page.goto('/workspace/tasks');
      await expect(page.getByTestId('workspace-projects-page')).toBeVisible();
      await stepScreenshot(page, testInfo, 'outsider-projects-list');
      await expect(page.getByText(projectName)).not.toBeVisible();
    });

    test('all members can see the private project after being added', async ({ page }, testInfo) => {
      // Arrange: add member via API
      await api.addProjectMember(owner, projectId, member.id, 'PROJECT_MEMBER_ROLE_MEMBER');

      // Act: member navigates to projects
      await loginAs(page, member);
      await page.goto('/workspace/tasks');
      await expect(page.getByTestId('workspace-projects-page')).toBeVisible();
      await stepScreenshot(page, testInfo, 'member-sees-project');

      // Assert: project is visible
      await expect(page.getByText(projectName)).toBeVisible();
    });

    test('the member list shows correct roles on the settings page', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/tasks');
      await page.getByTestId(`project-card-${projectId}`).click();
      await expect(page.getByTestId('project-detail-page')).toBeVisible();

      // Navigate to settings tab, then Members sub-tab
      await page.getByTestId('tab-settings').click();
      await page.getByTestId('settings-tab-members').click();
      await expect(page.getByTestId('members-settings')).toBeVisible({ timeout: 10_000 });
      await stepScreenshot(page, testInfo, 'member-list-with-roles');

      // Owner and member should both appear in the members list
      await expect(page.getByTestId('members-settings').getByText('Test Owner')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('members-settings').getByText('Test Employee')).toBeVisible({ timeout: 5_000 });
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when a member is removed from the project
  // ---------------------------------------------------------------------------

  test.describe('when a member is removed from the project', () => {
    test.beforeAll(async () => {
      // Ensure member is added before testing removal
      await api.addProjectMember(owner, projectId, member.id, 'PROJECT_MEMBER_ROLE_MEMBER').catch(() => {});
    });

    test('the removed member can no longer see the project', async ({ page }, testInfo) => {
      // Arrange: remove member via API
      await api.removeProjectMember(owner, projectId, member.id);

      // Act: ex-member navigates to projects
      await loginAs(page, member);
      await page.goto('/workspace/tasks');
      await expect(page.getByTestId('workspace-projects-page')).toBeVisible();
      await stepScreenshot(page, testInfo, 'removed-member-project-list');

      // Assert: project is no longer visible
      await expect(page.getByText(projectName)).not.toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when a member role is changed
  // ---------------------------------------------------------------------------

  test.describe('when a member role is changed', () => {
    test.beforeAll(async () => {
      // Re-add member as viewer first
      await api.addProjectMember(owner, projectId, member.id, 'PROJECT_MEMBER_ROLE_VIEWER');
    });

    test('the role change is reflected in the members list', async ({ page }, testInfo) => {
      // Arrange: upgrade to admin via API
      await api.updateProjectMemberRole(
        owner,
        projectId,
        member.id,
        'PROJECT_MEMBER_ROLE_ADMIN',
      );

      // Act: owner views member settings
      await loginAs(page, owner);
      await page.goto('/workspace/tasks');
      await page.getByTestId(`project-card-${projectId}`).click();
      await page.getByTestId('tab-settings').click();
      await page.getByTestId('settings-tab-members').click();
      await expect(page.getByTestId('members-settings')).toBeVisible({ timeout: 10_000 });
      await stepScreenshot(page, testInfo, 'role-changed-to-admin');

      // Assert: the member is listed with updated role
      await expect(page.getByTestId('members-settings').getByText('Test Employee')).toBeVisible({ timeout: 5_000 });
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when the project is archived
  // ---------------------------------------------------------------------------

  test.describe('when the project is archived', () => {
    test.beforeAll(async () => {
      await api.archiveProject(owner, projectId, true);
    });

    test('members no longer see it in the default project list', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/tasks');
      await expect(page.getByTestId('workspace-projects-page')).toBeVisible();
      await stepScreenshot(page, testInfo, 'archived-hidden-from-list');
      await expect(page.getByText(projectName)).not.toBeVisible();
    });

    test('unarchiving restores visibility', async ({ page }, testInfo) => {
      // Arrange: unarchive via API
      await api.archiveProject(owner, projectId, false);

      // Act
      await loginAs(page, owner);
      await page.goto('/workspace/tasks');
      await expect(page.getByTestId('workspace-projects-page')).toBeVisible();
      await stepScreenshot(page, testInfo, 'unarchived-visible-again');

      // Assert
      await expect(page.getByText(projectName)).toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when a non-owner tries to manage members
  // ---------------------------------------------------------------------------

  test.describe('when a non-owner tries to manage members via UI', () => {
    test.beforeAll(async () => {
      // Ensure member is in the project as a viewer
      await api.addProjectMember(owner, projectId, member.id, 'PROJECT_MEMBER_ROLE_VIEWER').catch(() => {});
      await api.updateProjectMemberRole(owner, projectId, member.id, 'PROJECT_MEMBER_ROLE_VIEWER').catch(() => {});
    });

    test('a viewer does not see the add-member button', async ({ page }, testInfo) => {
      await loginAs(page, member);
      await page.goto('/workspace/tasks');
      await page.getByTestId(`project-card-${projectId}`).click();
      await expect(page.getByTestId('project-detail-page')).toBeVisible();
      await page.getByTestId('tab-settings').click();
      await page.getByTestId('settings-tab-members').click();
      await stepScreenshot(page, testInfo, 'viewer-no-add-member-btn');

      // Viewer should not have the add-member button
      await expect(page.getByTestId('add-member-btn')).not.toBeVisible();
    });
  });
});
