/**
 * Voice Communication E2E Tests
 *
 * Behavioral scenarios derived from:
 *   - backend/integration/voice_communication_test.go
 *
 * Pattern: Arrange via API, Act via UI, Assert via UI and API recovery.
 */
import { test, expect } from '@playwright/test';
import { createTestOrg, createTestEmployee, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';
import { stepScreenshot } from './helpers/screenshot';

declare global {
  interface Window {
    __TECH_OFFICE_VOICE_TEST_BLOB__?: Blob;
  }
}

test.describe('Voice Communication', () => {
  let owner: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let charlie: TestUser;
  let channelId: string;
  const channelName = `voice-${crypto.randomUUID().slice(0, 8)}`;

  test.beforeAll(async () => {
    owner = await createTestOrg();
    alice = await createTestEmployee(owner);
    bob = await createTestEmployee(owner);
    charlie = await createTestEmployee(owner);

    const channel = await api.createChannel(owner, {
      titleSlug: channelName,
      displayName: `Voice ${channelName.slice(-8)}`,
    });
    channelId = channel.channel.id;
    await api.inviteMember(owner, channelId, alice.id);
    await api.inviteMember(owner, channelId, bob.id);
    await api.inviteMember(owner, channelId, charlie.id);
  });

  test.describe('when an employee starts a voice call from a channel', () => {
    test('a media provider startup failure is shown in the composer', async ({ page }) => {
      await loginAs(page, alice);
      await page.goto(`/workspace/chat?channel=${channelId}`);

      await page.route('**/rpc.v1.VoiceService/StartVoiceCall', async (route) => {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'unavailable',
            message: 'voice media provider unavailable: create livekit room: dial tcp [::1]:7880: connect: connection refused',
          }),
        });
      });

      await page.getByTestId('voice-start-call-button').click();
      await expect(page.getByTestId('voice-call-error')).toContainText(
        'Voice calling is temporarily unavailable',
      );
      await expect(page.getByTestId('voice-call-bar')).toBeHidden();
    });

    test('the active call controls appear and recovery returns the same active call', async ({ page }, testInfo) => {
      await loginAs(page, alice);
      await page.goto(`/workspace/chat?channel=${channelId}`);

      await page.getByTestId('voice-start-call-button').click();
      await expect(page.getByTestId('voice-call-bar')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('voice-call-state')).toContainText(/ringing|active/i);
      await expect(page.getByTestId('voice-leave-call-button')).toBeVisible();
      await stepScreenshot(page, testInfo, 'voice-call-started');

      const active = await api.getActiveVoiceCall(alice, channelId);
      expect(active.hasActiveCall).toBe(true);
      expect(active.call?.channelId).toBe(channelId);

      await page.getByTestId('voice-leave-call-button').click();
      await expect(page.getByTestId('voice-call-record').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('voice-call-record').first()).toContainText(/Recording (not requested|unavailable|failed)/i);
      await expect(page.getByTestId('voice-transcript-panel').first()).toContainText(/Transcript (not requested|unavailable|failed)/i);

      const records = await api.listCallRecords(alice, channelId);
      expect(records.records[0]?.call?.id).toBe(active.call?.id);
      expect(records.records[0]?.call?.outcome).toMatch(/CANCELLED|COMPLETED/);

      const record = await api.getCallRecord(alice, active.call!.id);
      expect(record.record?.call?.channelId).toBe(channelId);
    });
  });

  test.describe('when a call is already active in a channel', () => {
    test('another eligible member can join and sees degraded quality state', async ({ page }, testInfo) => {
      const started = await api.startVoiceCall(alice, channelId);

      await loginAs(page, bob);
      await page.goto(`/workspace/chat?channel=${channelId}`);

      await expect(page.getByTestId('voice-call-bar')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('voice-call-announcement')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('voice-join-call-button')).toBeVisible();
      await page.getByTestId('voice-join-call-button').click();
      await expect(page.getByTestId('voice-leave-call-button')).toBeVisible();

      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('tech-office:voice-quality', { detail: { quality: 'poor' } }));
      });
      await expect(page.getByTestId('voice-quality-indicator')).toContainText(/poor|degraded/i);
      await stepScreenshot(page, testInfo, 'voice-call-degraded-quality');

      await api.leaveVoiceCall(bob, started.call.id);
      await api.leaveVoiceCall(alice, started.call.id);
    });
  });

  test.describe('when participants invite another eligible member', () => {
    test('the invite can be accepted and access-denied joins stay blocked', async () => {
      const started = await api.startVoiceCall(alice, channelId);
      const invite = await api.inviteToVoiceCall(alice, started.call.id, [charlie.id]);

      expect(invite.invitations).toHaveLength(1);
      expect(invite.invitations[0].inviteeEmployeeId).toBe(charlie.id);

      const accepted = await api.respondToVoiceCallInvite(
        charlie,
        invite.invitations[0].id,
        'VOICE_INVITE_RESPONSE_ACCEPT',
      );
      expect(accepted.invitation.status).toContain('ACCEPTED');
      expect(accepted.joinCredentials?.livekitToken).toBeTruthy();

      const outsider = await createTestEmployee(owner);
      const privateChannel = await api.createChannel(owner, {
        titleSlug: `voice-private-${crypto.randomUUID().slice(0, 8)}`,
        displayName: 'Voice Private',
        isPrivate: true,
      });
      await api.inviteMember(owner, privateChannel.channel.id, alice.id);
      const privateStarted = await api.startVoiceCall(alice, privateChannel.channel.id);

      await expect(api.joinVoiceCall(outsider, privateStarted.call.id)).rejects.toThrow(/permission|denied|403/i);

      await api.leaveVoiceCall(charlie, started.call.id);
      await api.leaveVoiceCall(alice, started.call.id);
      await api.leaveVoiceCall(alice, privateStarted.call.id);
    });
  });

  test.describe('when an incoming call arrives while the employee is already connected', () => {
    test('the alert appears quickly and supports stay then switch decisions', async ({ page }, testInfo) => {
      const currentChannel = await api.createChannel(owner, {
        titleSlug: `voice-current-${crypto.randomUUID().slice(0, 8)}`,
        displayName: 'Voice Current',
      });
      await api.inviteMember(owner, currentChannel.channel.id, alice.id);
      await api.inviteMember(owner, currentChannel.channel.id, bob.id);
      const currentCall = await api.startVoiceCall(alice, currentChannel.channel.id);
      await api.joinVoiceCall(bob, currentCall.call.id);

      const incomingChannel = await api.createChannel(owner, {
        titleSlug: `voice-incoming-${crypto.randomUUID().slice(0, 8)}`,
        displayName: 'Voice Incoming',
      });
      await api.inviteMember(owner, incomingChannel.channel.id, bob.id);
      await api.inviteMember(owner, incomingChannel.channel.id, charlie.id);
      const incomingCall = await api.startVoiceCall(charlie, incomingChannel.channel.id);

      await loginAs(page, bob);
      await page.goto(`/workspace/chat?channel=${incomingChannel.channel.id}`);
      await expect(page.getByTestId('voice-message-record-button')).toBeVisible({ timeout: 10_000 });

      const firstInvite = await api.inviteToVoiceCall(charlie, incomingCall.call.id, [bob.id]);
      const alertStart = Date.now();
      await page.evaluate(({ channelId, callId, invitationId }) => {
        window.dispatchEvent(new CustomEvent('tech-office:voice-call-event', {
          detail: {
            channelId,
            callId,
            invitationId,
            notificationType: 'voice_call_incoming',
            alreadyInAnotherCall: true,
            state: 'VOICE_CALL_STATE_RINGING',
          },
        }));
      }, { channelId: incomingChannel.channel.id, callId: incomingCall.call.id, invitationId: firstInvite.invitations[0].id });

      await expect(page.getByTestId('incoming-voice-call-dialog')).toBeVisible({ timeout: 5_000 });
      expect(Date.now() - alertStart).toBeLessThan(5_000);
      await expect(page.getByTestId('incoming-voice-stay-button')).toContainText(/stay/i);
      await expect(page.getByTestId('incoming-voice-accept-button')).toContainText(/switch/i);
      await stepScreenshot(page, testInfo, 'voice-incoming-switch-stay');

      await page.getByTestId('incoming-voice-stay-button').click();
      await expect(page.getByTestId('incoming-voice-call-dialog')).toBeHidden({ timeout: 10_000 });
      const stillCurrent = await api.getActiveVoiceCall(bob, currentChannel.channel.id);
      expect(stillCurrent.call?.id).toBe(currentCall.call.id);

      const secondInvite = await api.inviteToVoiceCall(charlie, incomingCall.call.id, [bob.id]);
      await page.evaluate(({ channelId, callId, invitationId }) => {
        window.dispatchEvent(new CustomEvent('tech-office:voice-call-event', {
          detail: {
            channelId,
            callId,
            invitationId,
            notificationType: 'voice_call_incoming',
            alreadyInAnotherCall: true,
            state: 'VOICE_CALL_STATE_RINGING',
          },
        }));
      }, { channelId: incomingChannel.channel.id, callId: incomingCall.call.id, invitationId: secondInvite.invitations[0].id });
      await page.getByTestId('incoming-voice-accept-button').click();
      await expect(page.getByTestId('incoming-voice-call-dialog')).toBeHidden({ timeout: 10_000 });
      await expect(page.getByTestId('voice-call-bar')).toBeVisible({ timeout: 10_000 });

      await api.leaveVoiceCall(bob, incomingCall.call.id);
      await api.leaveVoiceCall(charlie, incomingCall.call.id);
      await api.leaveVoiceCall(bob, currentCall.call.id);
      await api.leaveVoiceCall(alice, currentCall.call.id);
    });
  });

  test.describe('when an employee sends a voice message', () => {
    test('the composer supports cancel, retry, send, and playback review', async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        window.__TECH_OFFICE_VOICE_TEST_BLOB__ = new Blob(['voice-message-audio'], { type: 'audio/webm' });
      });
      await loginAs(page, alice);
      await page.goto(`/workspace/chat?channel=${channelId}`);

      await page.getByTestId('voice-message-record-button').click();
      await expect(page.getByTestId('voice-message-recorder')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('voice-message-cancel-button').click();
      await expect(page.getByTestId('voice-message-recorder')).toBeHidden({ timeout: 10_000 });

      let failedFirstUpload = false;
      await page.route('**/*', async (route) => {
        if (route.request().method() === 'PUT' && !failedFirstUpload) {
          failedFirstUpload = true;
          await route.fulfill({ status: 500, body: 'forced voice upload retry' });
          return;
        }
        await route.continue();
      });

      await page.getByTestId('voice-message-record-button').click();
      await page.getByTestId('voice-message-stop-button').click();
      await page.getByTestId('voice-message-send-button').click();
      await expect(page.getByTestId('voice-message-retry-button')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('voice-message-retry-button').click();

      const sentVoicePlayer = page.getByTestId('voice-message-player').last();
      await expect(sentVoicePlayer).toBeVisible({ timeout: 15_000 });
      await stepScreenshot(page, testInfo, 'voice-message-sent');

      const listed = await api.listMessages(alice, channelId);
      const voiceTimelineMessage = listed.messages.find((message) => message.messageText === 'Voice message');
      expect(voiceTimelineMessage?.fileIds?.length).toBeGreaterThan(0);

      await page.getByTestId('voice-message-play-button').last().click();
      await expect(sentVoicePlayer).toContainText(/Voice message|Playing|Playback unavailable/i);
    });

    test('cancelled uploads never create chat messages and confirmed messages remain visible', async ({ page }) => {
      const requested = await api.requestVoiceMessageUpload(alice, {
        channelId,
        clientDeduplicationKey: `cancelled-${crypto.randomUUID()}`,
        sizeBytes: 12,
        expectedDurationMs: 10_000,
      });
      const cancelled = await api.cancelVoiceMessage(alice, requested.voiceMessageId);
      expect(cancelled.voiceMessage.status).toContain('CANCEL');

      const created = await api.createVoiceMessage(alice, channelId, { durationMs: 10_000 });
      expect(created.voiceMessage.status).toContain('POST');

      await loginAs(page, bob);
      await page.goto(`/workspace/chat?channel=${channelId}`);
      await expect(page.getByTestId('voice-message-player').last()).toBeVisible({ timeout: 15_000 });
    });
  });
});
