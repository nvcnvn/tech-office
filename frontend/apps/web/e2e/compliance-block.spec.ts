/**
 * Blocking E2E (Feature 036, US3).
 *
 * Mirrors backend/integration/compliance_block_test.go.
 *
 * The scope is the thing this file is really asserting: a block stops direct
 * contact and deliberately leaves shared work channels alone. A reviewer who tests
 * a block inside a shared channel will expect messages to vanish and will not see
 * that happen — see docs/compliance/reviewer-notes.md.
 */
import { test, expect } from '@playwright/test';
import * as api from './helpers/api';
import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';

test.describe('Blocking', () => {
  let owner: TestUser;
  let blocker: TestUser;
  let blocked: TestUser;
  let channelId: string;

  test.beforeAll(async () => {
    owner = await createTestOrg();
    blocker = await createTestEmployee(owner);
    blocked = await createTestEmployee(owner);

    const suffix = crypto.randomUUID().slice(0, 8);
    const channel = await api.createChannel(owner, {
      titleSlug: `shared-${suffix}`,
      displayName: 'Shared work',
    });
    channelId = channel.channel.id;
    await api.inviteToChannel(owner, channelId, blocker.id);
    await api.inviteToChannel(owner, channelId, blocked.id);
  });

  test.describe('when a person blocks someone', () => {
    test('the blocked list shows them', async ({ page }) => { // FR-019, FR-024
      await api.blockPerson(blocker, blocked.id);

      await loginAs(page, blocker);
      await page.goto('/workspace/settings/blocked');
      await expect(page.getByTestId(`blocked-row-${blocked.id}`)).toBeVisible();
    });

    test('the blocked person sees nothing of it', async ({ page }) => { // FR-022
      await loginAs(page, blocked);
      await page.goto('/workspace/settings/blocked');
      // There is no screen and no API that answers "who has blocked me". The
      // absence is the requirement.
      await expect(page.getByTestId('blocked-empty')).toBeVisible();
    });

    test('their direct conversation is refused', async ({ page }) => { // FR-020
      await expect(api.createOrGetDirectMessage(blocked, blocker.id)).rejects.toThrow(/failed/i);
      // The refusal must not tell the blocked person a block exists.
      await expect(api.createOrGetDirectMessage(blocked, blocker.id)).rejects.not.toThrow(/block/i);
    });

    test('their shared-channel messages remain visible', async ({ page }) => { // FR-021a
      await api.sendMessage(blocked, channelId, 'The delivery is at four.');

      await loginAs(page, blocker);
      await page.goto(`/workspace/chat?channel=${channelId}`);
      // Hiding this would let somebody silently conceal instructions addressed to
      // them, which is why blocking is scoped to direct contact.
      await expect(page.getByText('The delivery is at four.')).toBeVisible();
    });
  });

  test.describe('when a person unblocks someone', () => {
    test('unblocking restores everything', async ({ page }) => { // FR-019
      await loginAs(page, blocker);
      await page.goto('/workspace/settings/blocked');
      await page.getByTestId(`blocked-unblock-${blocked.id}`).click();

      await expect(page.getByTestId('blocked-empty')).toBeVisible();

      const dm = await api.createOrGetDirectMessage(blocked, blocker.id);
      expect(dm.channel.id).toBeTruthy();
    });
  });
});
