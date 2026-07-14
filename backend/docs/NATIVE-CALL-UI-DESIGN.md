# Native Call UI Design

This document captures the next implementation step for OS-level call UI after the typed notification payload and rescue-push work.

## Current decision

Do not bolt CallKit or Android Telecom directly onto the previous untyped `actionData` map. The first prerequisite is now implemented: incoming voice-call notifications have a typed `NotificationPayload.voiceCall` envelope, strict backend validation, rescue push behavior, and self-contained push routing data.

## Platform research summary

Apple CallKit provides the native incoming/outgoing VoIP call interface and routes user actions through `CXProvider` / `CXProviderDelegate`. Apple’s current docs also note iOS and iPadOS 18.2 default-calling-app support for CallKit or LiveCommunicationKit apps. For true incoming-call UI when the app is killed, iOS expects PushKit VoIP pushes and immediate reporting of the incoming call to CallKit; a normal APNs/FCM alert is not the same thing.

Android’s current Telecom overview recommends the Jetpack Core-Telecom self-managed path for standalone calling apps, or `ConnectionService` when integrating with the system calling experience. React Native CallKeep wraps iOS CallKit and Android ConnectionService and supports Expo only in development/native builds, not Expo Go. Its Android self-managed mode requires the app to show an incoming-call UI/notification promptly, and Android may deprioritize high-priority FCM if the app fails to surface call UI.

LiveKit’s React Native SDK already fits the media plane. Its docs recommend CallKit for robust iOS background call processing and require Android foreground-service support for background microphone/media work. LiveKit should remain the media/session layer; CallKit/Telecom should be the OS call presentation and audio-session coordination layer.

## Required architecture

- Backend keeps `voice_call_incoming` as priority `0` and push-immediate.
- FCM/APNs payloads must include `notificationId`, `notificationRecipientId`, typed navigation fields, `channelId`, `callId`, `invitationId`, and caller display metadata.
- Mobile foreground SSE uses `payload.voiceCall` to show the existing in-app prompt and send receipts.
- Mobile background/terminated native call UI needs a native call bridge:
  - iOS: PushKit VoIP token registration, APNs VoIP send path, CallKit `reportNewIncomingCall`, and answer/end callbacks mapped to `RespondToVoiceCallInvite` / `LeaveVoiceCall`.
  - Android: CallKeep or native Core-Telecom/ConnectionService bridge, FCM background handler, foreground service for microphone/background call lifetime, and answer/end callbacks mapped to the same voice RPCs.
- Older or unsupported devices fall back to the current time-sensitive local/remote notification and in-app incoming-call prompt.

## Recommended rollout

1. Keep the typed notification contract as the shared source of truth.
2. Add a mobile native-call adapter behind capability checks; do not remove the current prompt/notification path.
3. Add iOS PushKit/APNs VoIP token storage separately from regular FCM tokens.
4. Add Android background message handling and CallKeep/Core-Telecom setup in a dev client.
5. Validate only on physical devices; CallKit/ConnectionService cannot be trusted from simulators.

## Package direction

`react-native-callkeep` is the fastest React Native bridge for a first native-call UI because it wraps both CallKit and Android ConnectionService. It is also older and not available in Expo Go, so it should be introduced behind a small app-owned adapter. If Android behavior becomes a long-term product differentiator, prefer a custom native module over time that uses Jetpack Core-Telecom directly.