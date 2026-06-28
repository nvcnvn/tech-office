import { test, expect } from '@playwright/test';
import { createTestOrg, createTestEmployee, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';

test.describe('End-to-End Web Smoke Test', () => {
  let owner: TestUser;
  let employee: TestUser;
  
  let projectId: string;
  let taskId: string;
  let channelId: string;
  let ritualId: string;
  let eventId: string;

  test.beforeAll(async () => {
    // 1. Admin setup: Register an organization and create an employee
    owner = await createTestOrg();
    employee = await createTestEmployee(owner);

    // 2. Global Management: Create necessary data via API (Arrange)
    
    // Create Project
    const projResp = await api.createProject(owner, { 
      name: 'Smoke Test Project', 
      visibility: 'PROJECT_VISIBILITY_PUBLIC' 
    });
    projectId = projResp.project.id;

    // Create Ritual
    const ritualResp = await api.createRitualDefinition(owner, {
      projectId,
      name: 'Smoke Test Daily Sync',
      defaultAssigneeIds: [employee.id],
    });
    ritualId = ritualResp.ritualDefinition.id;
    
    await api.createEvidenceRequirement(owner, {
      ritualDefinitionId: ritualId,
      name: 'Status Update',
    });

    // Create Task
    const taskResp = await api.createTask(owner, projectId, 'Smoke Test Task', { levelId: projResp.levels[0]?.id });
    taskId = taskResp.task.id;
    await api.assignTask(owner, taskId, employee.id);

    // Create Chat Channel
    const channelResp = await api.createChannel(owner, { 
      titleSlug: `smoke-test-${Date.now()}`, 
      displayName: 'Smoke Test Channel' 
    });
    channelId = channelResp.channel.id;
    await api.inviteMember(owner, channelId, employee.id);

    // Create Calendar Event (1 hour from now)
    const startTime = new Date(Date.now() + 3600 * 1000).toISOString();
    const endTime = new Date(Date.now() + 7200 * 1000).toISOString();
    const eventResp = await api.createEvent(owner, {
      title: 'Smoke Test Event',
      startTime,
      endTime,
      requiredAttendeeIds: [employee.id],
    });
    eventId = eventResp.event.id;
  });

  test.describe('Employee Daily Workflow', () => {
    test.beforeEach(async ({ page }) => {
      // Act as the employee for all these scenarios
      await loginAs(page, employee);
    });

    test('should be able to navigate to notifications page', async ({ page }) => {
      await page.goto('/workspace/notifications');
      await page.waitForLoadState('domcontentloaded');
      
      // Verify the page loads its main container (notifications may be async)
      await expect(page.locator('main')).toBeVisible();
    });

    test('should be able to navigate to and interact with Chat', async ({ page }) => {
      await page.goto(`/workspace/chat?channel=${channelId}`);
      await page.waitForLoadState('domcontentloaded');
      
      // Assert the Context Rail displays chat details correctly
      await expect(page.getByTestId('workspace-context-rail-chat-members')).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId('workspace-context-rail-chat-members')).toContainText('Test Employee');
    });

    test('should be able to view assigned tasks', async ({ page }) => {
      await page.goto(`/workspace/tasks`);
      await page.waitForLoadState('domcontentloaded');
      
      await page.getByTestId(`project-card-${projectId}`).click();
      await page.getByTestId('tab-list').click();
      
      await expect(page.getByText('Smoke Test Task')).toBeVisible({ timeout: 20000 });
    });

    test('should be able to view calendar events', async ({ page }) => {
      await page.goto(`/workspace/calendar`);
      await page.waitForLoadState('domcontentloaded');
      
      // Ensure the event shows up in the selected day section
      const selectedDaySection = page.getByTestId('workspace-context-rail-calendar-day');
      await expect(selectedDaySection).toBeVisible({ timeout: 20000 });
      await expect(selectedDaySection).toContainText('Smoke Test Event');
      
      // Ensure it appears in pending invites
      const pendingInvitesSection = page.getByTestId('workspace-context-rail-calendar-pending-invites');
      await expect(pendingInvitesSection).toContainText('Smoke Test Event');
      
      // Accept the invite
      await page
        .getByTestId(`workspace-context-rail-calendar-invite-${eventId}`)
        .getByRole('button', { name: 'Accept' })
        .click();
        
      await expect(
        page.getByTestId(`workspace-context-rail-calendar-event-${eventId}`)
      ).toContainText('Accepted');
    });
  });
});
