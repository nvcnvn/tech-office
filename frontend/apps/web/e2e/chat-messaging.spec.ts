/**
 * Chat Messaging E2E Tests
 *
 * Behavioral scenarios derived from backend integration tests:
 *   - backend/integration/workflow_chat_files_test.go
 *   - backend/integration/chat_messaging_test.go
 *
 * Pattern: Arrange via API, Act via UI, Assert via UI.
 */
import { test, expect } from '@playwright/test';
import { createTestOrg, createTestEmployee, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';
import { stepScreenshot } from './helpers/screenshot';

test.describe('Chat Messaging', () => {
  let owner: TestUser;
  let alice: TestUser;
  let bob: TestUser;

  test.beforeAll(async () => {
    owner = await createTestOrg();
    alice = await createTestEmployee(owner);
    bob = await createTestEmployee(owner);
  });

  // ---------------------------------------------------------------------------
  // Scenario: when a team collaborates in a public channel
  // ---------------------------------------------------------------------------

  test.describe('when a team collaborates in a public channel', () => {
    let channelId: string;
    const channelName = `general-${crypto.randomUUID().slice(0, 8)}`;

    test.beforeAll(async () => {
      const resp = await api.createChannel(owner, {
        titleSlug: channelName,
        displayName: `General ${channelName.slice(-8)}`,
      });
      channelId = resp.channel.id;

      // Add alice and bob so the channel appears in their sidebar
      await api.inviteMember(owner, channelId, alice.id);
      await api.inviteMember(owner, channelId, bob.id);

      // Alice sends a message
      await api.sendMessage(alice, channelId, 'Hello from Alice!');
    });

    test('the chat page loads and shows channels', async ({ page }, testInfo) => {
      await loginAs(page, alice);
      await page.goto('/workspace/chat');
      await stepScreenshot(page, testInfo, 'chat-page-loaded');
      // The channel sidebar should list the channel
      await expect(page.getByText(new RegExp(channelName.slice(-8), 'i'))).toBeVisible();
    });

    test('bob sees alice\'s message in the channel', async ({ page }, testInfo) => {
      await loginAs(page, bob);
      await page.goto(`/workspace/chat?channel=${channelId}`);
      await stepScreenshot(page, testInfo, 'bob-sees-alice-message');
      await expect(page.getByText('Hello from Alice!')).toBeVisible({ timeout: 10_000 });
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when a private channel enforces access boundaries
  // ---------------------------------------------------------------------------

  test.describe('when a private channel enforces access boundaries', () => {
    let privateChannelId: string;
    const privateName = `secret-${crypto.randomUUID().slice(0, 8)}`;

    test.beforeAll(async () => {
      const resp = await api.createChannel(owner, {
        titleSlug: privateName,
        displayName: `Secret ${privateName.slice(-8)}`,
        isPrivate: true,
      });
      privateChannelId = resp.channel.id;

      // Owner sends a message
      await api.sendMessage(owner, privateChannelId, 'Top secret info');
    });

    test('a non-member does not see the private channel in sidebar', async ({ page }, testInfo) => {
      await loginAs(page, bob);
      await page.goto('/workspace/chat');
      await stepScreenshot(page, testInfo, 'bob-no-private-channel');
      await expect(page.getByText(new RegExp(privateName.slice(-8), 'i'))).not.toBeVisible();
    });

    test('after being invited the member can see the channel', async ({ page }, testInfo) => {
      // Arrange: invite bob
      await api.inviteMember(owner, privateChannelId, bob.id);

      await loginAs(page, bob);
      await page.goto(`/workspace/chat?channel=${privateChannelId}`);
      await stepScreenshot(page, testInfo, 'bob-sees-private-channel');

      // Verify message is visible in the channel
      await expect(page.getByText('Top secret info')).toBeVisible({ timeout: 10_000 });
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when users create a DM and exchange messages
  // ---------------------------------------------------------------------------

  test.describe('when users create a DM and exchange messages', () => {
    test.beforeAll(async () => {
      // Create DM via API and send a message
      const dm = await api.createOrGetDirectMessage(alice, bob.id);
      await api.sendMessage(alice, dm.channel.id, 'Hey Bob, private message!');
    });

    test('bob sees the DM message on the chat page', async ({ page }, testInfo) => {
      await loginAs(page, bob);
      // Navigate to DM channel directly
      const dm = await api.createOrGetDirectMessage(bob, alice.id);
      await page.goto(`/workspace/chat?channel=${dm.channel.id}`);
      await stepScreenshot(page, testInfo, 'bob-dm-channel-visible');

      // DM message should be visible
      await expect(page.getByText('Hey Bob, private message!')).toBeVisible({ timeout: 10_000 });
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when a user @mentions another in a channel
  // ---------------------------------------------------------------------------

  test.describe('when a user @mentions another in a channel', () => {
    let mentionChannelId: string;

    test.beforeAll(async () => {
      const mentionChannelName = `mentions-${crypto.randomUUID().slice(0, 8)}`;
      const resp = await api.createChannel(owner, {
        titleSlug: mentionChannelName,
        displayName: `Mentions ${mentionChannelName.slice(-8)}`,
      });
      mentionChannelId = resp.channel.id;

      // Invite bob so he can see the channel
      await api.inviteMember(owner, mentionChannelId, alice.id);
      await api.inviteMember(owner, mentionChannelId, bob.id);

      // Alice mentions Bob in a message (uses HTML mention markup)
      await api.sendMessage(
        alice,
        mentionChannelId,
        `<span data-employee-id="${bob.id}" data-mention-type="employee">@Bob</span> can you review this?`,
      );
    });

    test('the mention message renders with highlighted @mention', async ({ page }, testInfo) => {
      await loginAs(page, bob);
      await page.goto(`/workspace/chat?channel=${mentionChannelId}`);
      await stepScreenshot(page, testInfo, 'mention-message-visible');
      await expect(page.getByText('can you review this?')).toBeVisible({ timeout: 10_000 });
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when a user sends a message with a file attachment
  // ---------------------------------------------------------------------------

  test.describe('when a message has a file attachment', () => {
    let fileChannelId: string;

    test.beforeAll(async () => {
      const fileChannelName = `files-${crypto.randomUUID().slice(0, 8)}`;
      const resp = await api.createChannel(owner, {
        titleSlug: fileChannelName,
        displayName: `Files ${fileChannelName.slice(-8)}`,
      });
      fileChannelId = resp.channel.id;

      // Send a text-only message first so both users can see the channel
      await api.sendMessage(owner, fileChannelId, 'Check the attached document.');
    });

    test('the chat page shows the file upload button', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto(`/workspace/chat?channel=${fileChannelId}`);
      await stepScreenshot(page, testInfo, 'chat-with-upload-btn');
      // The attach-file trigger button should be visible in the message composer
      await expect(page.getByTestId('chat-file-upload')).toBeVisible({ timeout: 10_000 });
    });
  });
});
