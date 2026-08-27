/**
 * Content reporting E2E (Feature 036, US3).
 *
 * Mirrors backend/integration/compliance_report_test.go.
 *
 * The scenario that matters most is the last one: a report has to stay reviewable
 * after its author deletes the original, which is why the report stores a snapshot
 * rather than a reference.
 */
import { test, expect } from '@playwright/test';
import * as api from './helpers/api';
import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';

test.describe('Content reporting', () => {
  let owner: TestUser;
  let reporter: TestUser;
  let author: TestUser;
  let channelId: string;

  test.beforeAll(async () => {
    owner = await createTestOrg();
    reporter = await createTestEmployee(owner);
    author = await createTestEmployee(owner);

    const suffix = crypto.randomUUID().slice(0, 8);
    const channel = await api.createChannel(owner, {
      titleSlug: `reports-${suffix}`,
      displayName: 'Reports E2E',
    });
    channelId = channel.channel.id;
    await api.inviteToChannel(owner, channelId, reporter.id);
    await api.inviteToChannel(owner, channelId, author.id);
  });

  test.describe('when a person reports a message', () => {
    test('the message menu offers reporting, and submitting requires a reason', async ({ page }) => { // FR-014, FR-015
      const message = await api.sendMessage(author, channelId, 'You are useless and everyone knows it.');

      await loginAs(page, reporter);
      await page.goto(`/workspace/chat?channel=${channelId}`);

      const bubble = page.getByText('You are useless and everyone knows it.').first();
      await expect(bubble).toBeVisible();
      await bubble.hover();
      await page.getByRole('button', { name: 'More actions' }).first().click();
      await page.getByTestId('message-menu-report').click();

      const dialog = page.getByTestId('report-dialog');
      await expect(dialog).toBeVisible();
      // A report with no reason tells a reviewer nothing, so the button stays
      // disabled until one is chosen.
      await expect(page.getByTestId('report-dialog-submit')).toBeDisabled();

      await page.getByTestId('report-reason-harassment').check();
      await expect(page.getByTestId('report-dialog-submit')).toBeEnabled();
      await page.getByTestId('report-dialog-submit').click();

      // A confirmation is shown: somebody who reports and sees nothing assumes it
      // failed.
      await expect(page.getByTestId('report-dialog-confirmation')).toBeVisible();
      await page.getByTestId('report-dialog-done').click();

      expect(message.message.id).toBeTruthy();
    });
  });

  test.describe('when an owner opens the report queue', () => {
    test('outstanding reports are listed with their content, and resolving records the outcome', async ({
      page,
    }) => { // FR-017, FR-018
      await loginAs(page, owner);
      await page.goto('/workspace/settings/reports');

      await expect(page.getByTestId('reports-list')).toBeVisible();
      await expect(
        page.getByText('You are useless and everyone knows it.').first(),
      ).toBeVisible();

      await page.getByTestId(/^report-resolve-/).first().click();
      // An outcome with no note tells the next reviewer nothing about what
      // already happened, so it is required.
      await expect(page.getByTestId('resolve-outcome-submit')).toBeDisabled();
      await page.getByTestId('resolve-outcome-note').fill('Warned the author.');
      await page.getByTestId('resolve-outcome-submit').click();

      await expect(page.getByTestId('reports-empty')).toBeVisible();
    });

    test('a resolved report appears under Actioned with its outcome', async ({ page }) => { // FR-017
      await loginAs(page, owner);
      await page.goto('/workspace/settings/reports');
      await page.getByTestId('reports-tab-actioned').click();
      await expect(page.getByText('Warned the author.')).toBeVisible();
    });
  });

  test.describe('when the reported message is deleted by its author', () => {
    test('the report is still reviewable with its snapshot', async ({ page }) => { // FR-018
      const message = await api.sendMessage(author, channelId, 'This will be deleted.');
      await api.reportContent(reporter, {
        targetKind: 'REPORT_TARGET_KIND_CHAT_MESSAGE',
        targetId: message.message.id,
        reason: 'REPORT_REASON_HATE_SPEECH',
      });
      await api.apiCall(author, '/rpc.v1.ChatService/DeleteMessage', {
        messageId: message.message.id,
      });

      await loginAs(page, owner);
      await page.goto('/workspace/settings/reports');
      // A foreign key alone would leave the reviewer looking at a tombstone.
      await expect(page.getByText('This will be deleted.')).toBeVisible();
    });
  });

  test.describe('when an employee opens the report queue URL directly', () => {
    test('access is denied', async ({ page }) => { // FR-017
      await loginAs(page, reporter);
      await page.goto('/workspace/settings/reports');
      // Review is administrative. Hiding the link is not the enforcement; the
      // permission on the RPC is.
      await expect(page.getByTestId('reports-error')).toBeVisible();
      await expect(page.getByTestId('reports-list')).toHaveCount(0);
    });
  });
});
