import { execSync } from 'node:child_process';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';
import { assignTask, createChannel, createEvent, createOrGetDirectMessage, createProject, createTask, updateTask } from './helpers/api';

type WorkspaceRoute = {
  path: string;
  ready?: (page: Page) => Locator;
};

const workspaceRoutes: WorkspaceRoute[] = [
  { path: '/workspace/tasks' },
  { path: '/workspace/calendar' },
  {
    path: '/workspace/chat',
    ready: (page) => page.getByPlaceholder('Search channels or start DM...'),
  },
  { path: '/workspace/organization' },
  { path: '/workspace/docs' },
  { path: '/workspace/settings' },
];

const removedPlaceholderText = 'The right-side rail is mounted and ready for shared and route-specific blocks.';

async function expectWorkspaceShell(page: Page, route: WorkspaceRoute) {
  await page.goto(route.path);
  await page.waitForLoadState('domcontentloaded');
  await expect
    .poll(() => new URL(page.url()).pathname.replace(/\/$/, ''))
    .toBe(route.path.replace(/\/$/, ''));
  await expect(page.getByTestId('workspace-context-rail-toggle')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('workspace-context-rail')).toBeVisible({ timeout: 20_000 });

  if (route.ready) {
    await expect(route.ready(page)).toBeVisible({ timeout: 20_000 });
  }

  await expect(page.getByText(removedPlaceholderText)).toHaveCount(0);
}

async function getWidth(locator: Locator) {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Expected locator to have a bounding box');
  }

  return box.width;
}

test.describe('Workspace context rail', () => {
  let owner: TestUser;

  test.beforeAll(async () => {
    try {
      execSync('rg "No upcoming events|No active tasks|0 active" src/');
      throw new Error('Found legacy mock strings in src/. Please remove them.');
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('Found legacy mock strings')) {
        throw error;
      }
      // rg exits with 1 when no matches are found, which is the expected and passing case.
    }

    owner = await createTestOrg();
  });

  test.describe('when navigating between workspace routes', () => {
    // FR-001, FR-002, FR-003, SC-001
    test('the context rail toggle remains visible on every workspace route', async ({ page }) => {
      await loginAs(page, owner);

      for (const route of workspaceRoutes) {
        await expectWorkspaceShell(page, route);
      }
    });

    // FR-004, SC-007
    test('the open state is preserved while navigating within the same session', async ({ page }) => {
      await loginAs(page, owner);
      await expectWorkspaceShell(page, workspaceRoutes[1]);

      const rail = page.getByTestId('workspace-context-rail');
      const toggle = page.getByTestId('workspace-context-rail-toggle');

      await expect(rail).toHaveAttribute('data-open', 'true');
      await toggle.click();
      await expect(rail).toHaveAttribute('data-open', 'false');

      await expectWorkspaceShell(page, workspaceRoutes[1]);
      await expect(rail).toHaveAttribute('data-open', 'false');

      await toggle.click();
      await expect(rail).toHaveAttribute('data-open', 'true');

      await expectWorkspaceShell(page, workspaceRoutes[2]);
      await expect(rail).toHaveAttribute('data-open', 'true');
    });

    // FR-005, SC-006
    test('collapsing the rail expands the main content without a page reload', async ({ page }) => {
      await loginAs(page, owner);
      await expectWorkspaceShell(page, workspaceRoutes[0]);

      const mainContent = page.getByTestId('workspace-main-content');
      const rail = page.getByTestId('workspace-context-rail');
      const toggle = page.getByTestId('workspace-context-rail-toggle');

      await expect(rail).toHaveAttribute('data-open', 'true');
      const expandedWidthBeforeCollapse = await getWidth(mainContent);

      await toggle.click();
      await expect(rail).toHaveAttribute('data-open', 'false');
      const expandedWidthAfterCollapse = await getWidth(mainContent);

      expect(expandedWidthAfterCollapse).toBeGreaterThan(expandedWidthBeforeCollapse);
    });
  });

  test.describe('when the workspace is viewed on narrow layouts', () => {
    // FR-005, SC-001 (collapse on narrow, toggle remains accessible)
    test('the context rail auto-collapses before structural navigation is displaced', async ({ page }) => {
      await loginAs(page, owner);

      // Start at a comfortable wide viewport — rail should be open by default.
      await page.setViewportSize({ width: 1280, height: 800 });
      await expectWorkspaceShell(page, workspaceRoutes[0]);

      const rail = page.getByTestId('workspace-context-rail');
      const toggle = page.getByTestId('workspace-context-rail-toggle');

      await expect(rail).toHaveAttribute('data-open', 'true');
      await expect(rail).toHaveAttribute('data-auto-collapsed', 'false');

      // Resize to narrow — the provider's CONTEXT_RAIL_AUTO_COLLAPSE_QUERY fires below 1024px.
      await page.setViewportSize({ width: 768, height: 800 });

      await expect(rail).toHaveAttribute('data-open', 'false', { timeout: 5_000 });
      await expect(rail).toHaveAttribute('data-auto-collapsed', 'true');

      // The toggle must still be visible so the user can re-open the rail.
      await expect(toggle).toBeVisible();

      // Expanding the viewport should restore the rail to its previous open state.
      await page.setViewportSize({ width: 1280, height: 800 });

      await expect(rail).toHaveAttribute('data-open', 'true', { timeout: 5_000 });
      await expect(rail).toHaveAttribute('data-auto-collapsed', 'false');
    });
  });

  test.describe('when viewing the calendar route', () => {
    // FR-006, FR-007, FR-008, FR-009, FR-010, FR-016, FR-017, SC-002, SC-005
    test('the rail renders live global blocks and removes mock quick-info content', async ({ page }) => {
      const now = new Date();
      const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
      const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const inThreeHours = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      const inFourHours = new Date(now.getTime() + 4 * 60 * 60 * 1000);

      const project = await createProject(owner, { name: 'Context Rail Global Blocks' });
      const taskA = await createTask(owner, project.project.id, 'Owner overdue follow-up', {
        levelId: project.levels[0]?.id,
      });
      const taskB = await createTask(owner, project.project.id, 'Owner due today review', {
        levelId: project.levels[0]?.id,
      });

      await assignTask(owner, taskA.task.id, owner.id);
      await assignTask(owner, taskB.task.id, owner.id);
      await updateTask(owner, taskA.task.id, { dueDate: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10) });
      await updateTask(owner, taskB.task.id, { dueDate: now.toISOString().slice(0, 10) });

      await createEvent(owner, {
        title: 'Context Rail Standup',
        startTime: inOneHour.toISOString(),
        endTime: inTwoHours.toISOString(),
        requiredAttendeeIds: [owner.id],
      });
      await createEvent(owner, {
        title: 'Context Rail Planning',
        startTime: inThreeHours.toISOString(),
        endTime: inFourHours.toISOString(),
        requiredAttendeeIds: [owner.id],
      });

      await loginAs(page, owner);
      await expectWorkspaceShell(page, workspaceRoutes[4]);

      const rail = page.getByTestId('workspace-context-rail');
      const toggle = page.getByTestId('workspace-context-rail-toggle');

      await expect(page.getByTestId('workspace-context-rail-identity')).toContainText(owner.email);
      await expect(page.getByTestId('workspace-context-rail-next-up')).toContainText('Context Rail Standup');
      await expect(page.getByTestId('workspace-context-rail-next-up')).toContainText('+ 1 more today');
      await expect(page.getByTestId('workspace-context-rail-work-today')).toContainText('Owner overdue follow-up');
      await expect(page.getByTestId('workspace-context-rail-work-today')).toContainText('Owner due today review');
      await expect(page.getByTestId('workspace-context-rail-unread-messages')).toContainText('No unread messages');

      await expect(page.getByText('No upcoming events')).toHaveCount(0);
      await expect(page.getByText('No active tasks')).toHaveCount(0);
      await expect(page.getByText('0 active')).toHaveCount(0);
      await expect(page.getByText('Shared and route-specific context will appear here as the rail is connected.')).toHaveCount(0);

      await toggle.click();
      await expect(rail).toHaveAttribute('data-open', 'false');
      await expect(rail).toHaveAttribute('data-has-badge-alert', 'true');
    });

    // FR-012, FR-013
    test('the rail shows selected-day context and pending invite actions', async ({ page }) => {
      const attendee = await createTestEmployee(owner);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0, 0);
      const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 0, 0, 0);
      const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 11, 0, 0, 0);

      const acceptInvite = await createEvent(owner, {
        title: 'Today Invite Accept',
        startTime: todayStart.toISOString(),
        endTime: new Date(todayStart.getTime() + 60 * 60 * 1000).toISOString(),
        requiredAttendeeIds: [attendee.id],
      });
      const declineInvite = await createEvent(owner, {
        title: 'Today Invite Decline',
        startTime: todayMid.toISOString(),
        endTime: new Date(todayMid.getTime() + 60 * 60 * 1000).toISOString(),
        requiredAttendeeIds: [attendee.id],
      });
      await createEvent(owner, {
        title: 'Tomorrow Planning Review',
        startTime: tomorrowStart.toISOString(),
        endTime: new Date(tomorrowStart.getTime() + 60 * 60 * 1000).toISOString(),
        requiredAttendeeIds: [attendee.id],
      });

      await loginAs(page, attendee);
      await expectWorkspaceShell(page, workspaceRoutes[1]);

      const selectedDaySection = page.getByTestId('workspace-context-rail-calendar-day');
      const pendingInvitesSection = page.getByTestId('workspace-context-rail-calendar-pending-invites');

      await expect(page.getByTestId('workspace-context-rail-identity')).toHaveCount(0);
      await expect(selectedDaySection).toContainText('Today Invite Accept');
      await expect(selectedDaySection).toContainText('Today Invite Decline');
      await expect(pendingInvitesSection).toContainText('Today Invite Accept');
      await expect(pendingInvitesSection).toContainText('Today Invite Decline');

      await page
        .getByTestId(`workspace-context-rail-calendar-invite-${acceptInvite.event.id}`)
        .getByRole('button', { name: 'Accept' })
        .click();
      await expect(
        page.getByTestId(`workspace-context-rail-calendar-event-${acceptInvite.event.id}`)
      ).toContainText('Accepted');

      await page
        .getByTestId(`workspace-context-rail-calendar-invite-${declineInvite.event.id}`)
        .getByRole('button', { name: 'Decline' })
        .click();
      await expect(
        page.getByTestId(`workspace-context-rail-calendar-event-${declineInvite.event.id}`)
      ).toContainText('Declined');
      await expect(pendingInvitesSection).toContainText('No invites are waiting on you.');

      await page.getByText('Tomorrow Planning Review').first().click();
      await expect(selectedDaySection).toContainText('Tomorrow Planning Review');
      await expect(selectedDaySection).not.toContainText('Today Invite Accept');
    });
  });

  test.describe('when viewing the chat route', () => {
    // FR-014, SC-004
    test('the rail renders channel context without displacing the left sidebar', async ({ page }) => {
      const channel = await createChannel(owner, {
        titleSlug: `rail-test-${Date.now()}`,
        displayName: 'Rail Test Channel',
        channelType: 'CHANNEL_TYPE_CHAT',
        isPrivate: false,
      });

      const dmCounterpart = await createTestEmployee(owner);
      const dmChannel = await createOrGetDirectMessage(owner, dmCounterpart.id);

      await loginAs(page, owner);
      
      // Test standard channel
      await page.goto(`/workspace/chat?channel=${channel.channel.id}`);
      await page.waitForLoadState('domcontentloaded');
      
      await expect(page.getByTestId('workspace-context-rail')).toBeVisible();
      
      // Check standard channel sections
      await expect(page.getByTestId('workspace-context-rail-chat-members')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('workspace-context-rail-chat-members')).toContainText('Members');
      await expect(page.getByTestId('workspace-context-rail-chat-members')).toContainText('Test Owner');
      
      await expect(page.getByTestId('workspace-context-rail-chat-pinned')).toBeVisible();
      await expect(page.getByTestId('workspace-context-rail-chat-pinned')).toContainText('Pinned Messages');
      await expect(page.getByTestId('workspace-context-rail-chat-pinned')).toContainText('No pinned messages yet.');
      
      // Test direct message
      await page.goto(`/workspace/chat?channel=${dmChannel.channel.id}`);
      await page.waitForLoadState('domcontentloaded');
      
      // Check DM profile
      await expect(page.getByTestId('workspace-context-rail-chat-dm-profile')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('workspace-context-rail-chat-dm-profile')).toContainText('Direct Message');
      await expect(page.getByTestId('workspace-context-rail-chat-dm-profile')).toContainText('Test Employee');
    });
  });
});