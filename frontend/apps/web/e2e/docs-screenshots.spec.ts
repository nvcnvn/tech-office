import { test } from '@playwright/test';
import { createTestOrg, createTestEmployee, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';
import path from 'path';

test.describe('Generate Docs Screenshots', () => {
  let owner: TestUser;
  let employee: TestUser;
  
  let projectId: string;
  let taskId: string;
  let channelId: string;
  let ritualId: string;
  let eventId: string;

  const docsDir = path.join(process.cwd(), 'public', 'docs');

  test.beforeAll(async () => {
    owner = await createTestOrg();
    employee = await createTestEmployee(owner);

    const projResp = await api.createProject(owner, { 
      name: 'Q3 Product Launch', 
      visibility: 'PROJECT_VISIBILITY_PUBLIC' 
    });
    projectId = projResp.project.id;

    const ritualResp = await api.createRitualDefinition(owner, {
      projectId,
      name: 'Daily Standup',
      defaultAssigneeIds: [employee.id],
    });
    ritualId = ritualResp.ritualDefinition.id;
    
    await api.createEvidenceRequirement(owner, {
      ritualDefinitionId: ritualId,
      name: 'Status Update',
    });

    const taskResp = await api.createTask(owner, projectId, 'Prepare Launch Materials', { levelId: projResp.levels[0]?.id });
    taskId = taskResp.task.id;
    await api.assignTask(owner, taskId, employee.id);

    const channelResp = await api.createChannel(owner, { 
      titleSlug: `general-${Date.now()}`, 
      displayName: 'General Announcements' 
    });
    channelId = channelResp.channel.id;
    await api.inviteMember(owner, channelId, employee.id);

    const startTime = new Date(Date.now() + 3600 * 1000).toISOString();
    const endTime = new Date(Date.now() + 7200 * 1000).toISOString();
    const eventResp = await api.createEvent(owner, {
      title: 'Weekly Team Sync',
      startTime,
      endTime,
      requiredAttendeeIds: [employee.id],
    });
    eventId = eventResp.event.id;
  });

  test('capture owner screenshots', async ({ page }) => {
    await loginAs(page, owner);

    // 1. Dashboard / Notifications
    await page.goto('/workspace/notifications');
    await page.waitForTimeout(3000); // Wait for things to settle
    await page.screenshot({ path: path.join(docsDir, 'owner-dashboard.png') });

    // 2. Organization / Employees
    await page.goto('/workspace/employees');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(docsDir, 'owner-employees.png') });
  });

  test('capture employee screenshots', async ({ page }) => {
    await loginAs(page, employee);

    // 3. Tasks
    await page.goto(`/workspace/tasks`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(docsDir, 'employee-tasks.png') });

    // 4. Calendar
    await page.goto(`/workspace/calendar`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(docsDir, 'employee-calendar.png') });

    // 5. Chat
    await page.goto(`/workspace/chat?channel=${channelId}`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(docsDir, 'employee-chat.png') });
  });
});
