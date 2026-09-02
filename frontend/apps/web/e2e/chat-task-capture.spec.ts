/**
 * Creating a task from a chat message — web E2E (Feature 038, US1).
 *
 * Mirrors backend/integration/chat_task_capture_test.go, but covers the part the backend
 * contract cannot: how few interactions the conversion actually costs, and that nothing
 * the user typed is lost when it fails.
 */
import { test, expect } from '@playwright/test';
import * as api from './helpers/api';
import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';

test.describe('Creating a task from a message', () => {
  let owner: TestUser;
  let member: TestUser;
  let channelId: string;
  let projectKey: string;
  let projectId: string;

  test.beforeAll(async () => {
    owner = await createTestOrg();
    member = await createTestEmployee(owner);

    const suffix = crypto.randomUUID().slice(0, 8);
    const project = await api.createProject(owner, {
      name: 'Capture E2E',
      visibility: 'PROJECT_VISIBILITY_PUBLIC',
    });
    projectId = project.project.id;
    projectKey = project.project.key;
    await api.addProjectMember(owner, projectId, member.id, 'PROJECT_MEMBER_ROLE_MEMBER');

    const channel = await api.createChannel(owner, {
      titleSlug: `capture-${suffix}`,
      displayName: 'Capture E2E',
    });
    channelId = channel.channel.id;
    await api.inviteToChannel(owner, channelId, member.id);
  });

  test('the hover menu offers Create task and the dialog opens with the message as its title', async ({
    page,
  }) => { // FR-001, FR-009
    const text = 'Chase the invoice export before Friday';
    await api.sendMessage(owner, channelId, text);

    await loginAs(page, member);
    await page.goto(`/workspace/chat?channel=${channelId}`);

    const bubble = page.getByText(text).first();
    await expect(bubble).toBeVisible();
    await bubble.hover();
    await page.getByRole('button', { name: 'More actions' }).first().click();
    await page.getByTestId('message-menu-create-task').click();

    const dialog = page.getByTestId('create-task-from-message-dialog');
    await expect(dialog).toBeVisible();

    // The title arrives already filled from the message, so the common case — a message
    // that already says what needs doing — costs no typing at all.
    const title = page.getByTestId('create-task-from-message-title');
    await expect(title).toHaveValue(text);

    // Focused with its text selected, so typing replaces the derived title outright
    // rather than appending to it.
    await expect(title).toBeFocused();
  });

  test('confirming creates the task in the chosen project and closes the dialog', async ({
    page,
  }) => { // FR-004, FR-014
    const text = 'Renew the SSL certificate';
    await api.sendMessage(owner, channelId, text);

    await loginAs(page, member);
    await page.goto(`/workspace/chat?channel=${channelId}`);

    const bubble = page.getByText(text).first();
    await expect(bubble).toBeVisible();
    await bubble.hover();
    await page.getByRole('button', { name: 'More actions' }).first().click();
    await page.getByTestId('message-menu-create-task').click();

    const dialog = page.getByTestId('create-task-from-message-dialog');
    await expect(dialog).toBeVisible();

    // No project is remembered for this channel yet, so the picker has to be answered.
    const projectField = page.getByTestId('create-task-from-message-project').getByRole('combobox');
    await projectField.click();
    await page.getByRole('option', { name: new RegExp(projectKey) }).first().click();

    await page.getByTestId('create-task-from-message-submit').click();

    // The dialog closing is the confirmation that the conversion happened; the user is
    // left in the conversation they never had to leave.
    await expect(dialog).toBeHidden();

    const tasks = await api.listTasks(member, projectId);
    expect(tasks.tasks.some((t: { title: string }) => t.title === text)).toBe(true);
  });

  test.describe('refusals', () => {
    test('an empty title shows an inline field error and creates nothing', async ({ page }) => { // FR-011
      const text = 'A message that will not become a task';
      await api.sendMessage(owner, channelId, text);

      const before = await api.listTasks(member, projectId);

      await loginAs(page, member);
      await page.goto(`/workspace/chat?channel=${channelId}`);

      const bubble = page.getByText(text).first();
      await expect(bubble).toBeVisible();
      await bubble.hover();
      await page.getByRole('button', { name: 'More actions' }).first().click();
      await page.getByTestId('message-menu-create-task').click();

      const dialog = page.getByTestId('create-task-from-message-dialog');
      await expect(dialog).toBeVisible();

      await page.getByTestId('create-task-from-message-title').fill('');
      await page.getByTestId('create-task-from-message-submit').click();

      // The dialog stays open with the error attached to the field that caused it,
      // rather than a whole-form message the user has to interpret.
      await expect(dialog).toBeVisible();
      await expect(page.getByText('Give the task a title')).toBeVisible();

      const after = await api.listTasks(member, projectId);
      expect(after.tasks.length).toBe(before.tasks.length);
    });

    test('a failed conversion keeps the dialog open with values intact', async ({ page }) => { // FR-030
      const text = 'This conversion will be refused';
      await api.sendMessage(owner, channelId, text);

      // A viewer cannot create a task, so the conversion is refused server-side after
      // the user has already filled the form in.
      const viewer = await createTestEmployee(owner);
      await api.inviteToChannel(owner, channelId, viewer.id);
      await api.addProjectMember(owner, projectId, viewer.id, 'PROJECT_MEMBER_ROLE_VIEWER');

      await loginAs(page, viewer);
      await page.goto(`/workspace/chat?channel=${channelId}`);

      const bubble = page.getByText(text).first();
      await expect(bubble).toBeVisible();
      await bubble.hover();
      await page.getByRole('button', { name: 'More actions' }).first().click();
      await page.getByTestId('message-menu-create-task').click();

      const dialog = page.getByTestId('create-task-from-message-dialog');
      await expect(dialog).toBeVisible();

      const title = page.getByTestId('create-task-from-message-title');
      await title.fill('Typed by hand and worth keeping');

      const projectField = page.getByTestId('create-task-from-message-project').getByRole('combobox');
      await projectField.click();
      await page.getByRole('option', { name: new RegExp(projectKey) }).first().click();

      await page.getByTestId('create-task-from-message-submit').click();

      // Everything the user typed survives the refusal: a failed conversion should cost
      // a retry, not the typing.
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('create-task-from-message-error')).toBeVisible();
      await expect(title).toHaveValue('Typed by hand and worth keeping');
    });

    test('converting an already-converted message warns before proceeding', async ({
      page,
    }) => { // FR-025
      const text = 'This one is going to be converted twice';
      const sent = await api.sendMessage(owner, channelId, text);
      await api.createTaskFromMessage(owner, {
        sourceChannelId: channelId,
        sourceMessageId: sent.message.id,
        projectId,
        title: 'The first task from this message',
      });

      await loginAs(page, member);
      await page.goto(`/workspace/chat?channel=${channelId}`);

      const bubble = page.getByText(text).first();
      await expect(bubble).toBeVisible();
      await bubble.hover();
      await page.getByRole('button', { name: 'More actions' }).first().click();
      await page.getByTestId('message-menu-create-task').click();

      const dialog = page.getByTestId('create-task-from-message-dialog');
      await expect(dialog).toBeVisible();

      // Converting twice is permitted, but it is nearly always a mistake, so the
      // dialog says so before it will do it.
      await expect(
        page.getByTestId('create-task-from-message-duplicate-warning'),
      ).toBeVisible();

      const submit = page.getByTestId('create-task-from-message-submit');
      await submit.click();

      // The first confirm only acknowledges the warning; nothing is created yet.
      await expect(dialog).toBeVisible();
      await expect(submit).toHaveText('Create anyway');
    });
  });

  test.describe('seeing the result', () => {
    test('a chip names the task, opens it, and the task shows where it came from', async ({
      page,
    }) => { // FR-020, FR-021, FR-022, FR-028
      const text = 'Rotate the signing keys next sprint';
      const sent = await api.sendMessage(owner, channelId, text);
      const created = await api.createTaskFromMessage(member, {
        sourceChannelId: channelId,
        sourceMessageId: sent.message.id,
        projectId,
        title: 'Rotate the signing keys',
      });

      await loginAs(page, member);
      await page.goto(`/workspace/chat?channel=${channelId}`);

      // FR-021 — the chip names the task and its live state.
      const chip = page.getByTestId(`message-task-chip-${created.task.id}`);
      await expect(chip).toBeVisible();
      await expect(chip).toContainText(created.task.identifier);

      // FR-028 — the conversion left a note naming the task in the source message's
      // *thread*, not in the channel: a conversion is a footnote on what was said, not a
      // new thing said. So the reply badge is what opens it.
      // Scoped to this message's own row: the channel holds several converted messages
      // by now, and the first reply badge on the page belongs to another one.
      await page
        .getByTestId(`message-row-${sent.message.id}`)
        .getByRole('button', { name: /repl(y|ies)/ })
        .click();
      await expect(
        page.getByTestId('task-created-from-message-announcement').first(),
      ).toContainText(created.task.identifier);

      // FR-022 — the chip is the way back to the task. Scoped to this message's row:
      // the thread panel renders the same message again, so the chip appears twice.
      const rowChip = page
        .getByTestId(`message-row-${sent.message.id}`)
        .getByTestId(`message-task-chip-${created.task.id}`)
        .first();
      // Regex rather than an exact match: Next appends a trailing slash.
      await expect(rowChip).toHaveAttribute(
        'href',
        new RegExp(`/workspace/projects/${projectId}/tasks/${created.task.id}`),
      );
      await rowChip.click();

      // FR-020 — and the task says which conversation it came from, who said it, and what.
      // Asserted on the destination's own content rather than on waitForURL, which waits
      // for a load event a client-side Next navigation never fires.
      const origin = page.getByTestId('task-origin-block');
      await expect(origin).toBeVisible({ timeout: 15000 });
      expect(page.url()).toContain(created.task.id);
      await expect(page.getByTestId('task-origin-channel')).toContainText('Capture E2E');
      await expect(page.getByTestId('task-origin-excerpt')).toContainText(
        'Rotate the signing keys next sprint',
      );

      // FR-022 — the origin link opens the conversation anchored on the source message.
      await page.getByTestId('task-origin-link').click();
      await expect(page.getByTestId(`message-row-${sent.message.id}`)).toBeVisible({
        timeout: 15000,
      });
      expect(page.url()).toContain(`anchorId=${sent.message.id}`);
    });
  });

  test.describe('the remembered destination', () => {
    test('a second conversion pre-fills the project collapsed, and overriding leaves it alone', async ({
      page,
    }) => { // FR-015, FR-016, SC-002
      // A channel of its own, so the first conversion here is genuinely the first.
      const suffix = crypto.randomUUID().slice(0, 8);
      const memoryChannel = await api.createChannel(owner, {
        titleSlug: `memory-${suffix}`,
        displayName: 'Remembering E2E',
      });
      await api.inviteToChannel(owner, memoryChannel.channel.id, member.id);

      // Created up front: the dialog loads its project list when it opens, so a project
      // created afterwards would not be among the options to override with.
      const otherProject = await api.createProject(owner, {
        name: `Override E2E ${suffix}`,
        visibility: 'PROJECT_VISIBILITY_PUBLIC',
      });
      await api.addProjectMember(
        owner,
        otherProject.project.id,
        member.id,
        'PROJECT_MEMBER_ROLE_MEMBER',
      );

      const first = await api.sendMessage(owner, memoryChannel.channel.id, 'The first thing');
      await api.createTaskFromMessage(member, {
        sourceChannelId: memoryChannel.channel.id,
        sourceMessageId: first.message.id,
        projectId,
        title: 'First from this channel',
      });

      const text = 'The second thing, which should be easy';
      await api.sendMessage(owner, memoryChannel.channel.id, text);

      await loginAs(page, member);
      await page.goto(`/workspace/chat?channel=${memoryChannel.channel.id}`);

      const bubble = page.getByText(text).first();
      await expect(bubble).toBeVisible();
      await bubble.hover();
      await page.getByRole('button', { name: 'More actions' }).first().click();
      await page.getByTestId('message-menu-create-task').click();

      const dialog = page.getByTestId('create-task-from-message-dialog');
      await expect(dialog).toBeVisible();

      // SC-002: the project is already answered and collapsed to one line, so the whole
      // second conversion is open-the-dialog, confirm.
      const collapsed = page.getByTestId('create-task-from-message-project-collapsed');
      await expect(collapsed).toBeVisible();
      await expect(collapsed).toContainText(projectKey);

      // FR-016 — overriding for this one task must not redirect the channel.
      await page.getByTestId('create-task-from-message-project-change').click();
      const projectField = page
        .getByTestId('create-task-from-message-project')
        .getByRole('combobox');
      await projectField.click();
      await page
        .getByRole('option', { name: new RegExp(otherProject.project.key) })
        .first()
        .click();
      await page.getByTestId('create-task-from-message-submit').click();
      await expect(dialog).toBeHidden();

      const overridden = await api.listTasks(member, otherProject.project.id);
      expect(overridden.tasks.some((t: { title: string }) => t.title === text)).toBe(true);

      const destination = await api.getChannelTaskDestination(member, memoryChannel.channel.id);
      expect(destination.isSet).toBe(true);
      expect(destination.projectId).toBe(projectId);
    });

    test('a channel administrator changes it in channel settings', async ({ page }) => { // FR-017
      const suffix = crypto.randomUUID().slice(0, 8);
      const adminChannel = await api.createChannel(owner, {
        titleSlug: `admin-dest-${suffix}`,
        displayName: 'Destination Settings E2E',
      });

      await loginAs(page, owner);
      await page.goto(`/workspace/chat?channel=${adminChannel.channel.id}`);

      // The control is offered to the channel's administrator — here, its creator.
      await page.getByTestId('channel-task-destination-btn').click();

      const dialog = page.getByTestId('channel-task-destination-dialog');
      await expect(dialog).toBeVisible();

      const projectField = page
        .getByTestId('channel-task-destination-project')
        .getByRole('combobox');
      await projectField.click();
      await page.getByRole('option', { name: new RegExp(projectKey) }).first().click();
      await page.getByTestId('channel-task-destination-save').click();
      await expect(dialog).toBeHidden();

      const destination = await api.getChannelTaskDestination(owner, adminChannel.channel.id);
      expect(destination.isSet).toBe(true);
      expect(destination.projectId).toBe(projectId);
    });
  });
});
