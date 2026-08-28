# Contract: Notification Proto Delta

**Date**: 2026-08-28 | **Branch**: `037-native-call-wakeup`

The RPC surface barely moves. Only push token registration needs to say *what kind* of token
it is carrying, so the dispatcher can pick a transport.

## `RegisterPushToken`

`RegisterPushTokenRequest` gains a **token type**, and the existing token field is understood
as "the provider token for that type" rather than "an FCM token".

| Field | Change |
|---|---|
| token type | **new**, required — `fcm` \| `apns_voip` \| `web_push` |
| native call capable | **new**, optional bool — the device's build and permissions support the native call tier; drives tier-A vs tier-B routing |
| existing fields | unchanged (`device_identifier`, token, permission state, endpoint, keys, user agent) |

`PushTokenInfo` in `ListPushTokensResponse` returns the same two fields, so a support engineer
listing a person's devices can see why one rang natively and another did not.

Authorization is unchanged: `notif.managePushToken`.

**Breaking**: token type is required, so an old client that omits it is rejected. Per the
project's stance, this ships atomically rather than defaulting the field for compatibility —
which means the change set must cover **every** registration call site in one go:

| Call site | Passes |
|---|---|
| `frontend/apps/mobile/src/hooks/use-push-notifications.ts` | `fcm`, plus `apns_voip` on iOS |
| `frontend/apps/web/src/hooks/usePushPermission.ts` | `web_push` |
| `frontend/packages/apis/src/push-tokens.ts` | the wrapper both go through |

Missing any one of these turns an atomic breaking change into a broken client.

## Client registration behaviour

A mobile device registers **two** tokens on iOS (its FCM token for routine notifications and
its APNs VoIP token for calls) and **one** on Android (the FCM token serves both, with the
transport chosen by payload shape). Both registrations use the same `device_identifier`, which
is what lets the dispatcher fan out per device rather than per token.

Re-registration on token rotation is unchanged, and revoking a device revokes every token row
sharing its `device_identifier`.

## What does not change

No new RPCs. `PublishNotification`, `StreamNotifications`, acknowledgement, presence and
subscription surfaces are untouched. `VoiceService`'s twelve RPCs are untouched — the call
wake is a delivery concern, not a new call operation. The caller learns "unreachable" and
"busy" through structured error details on the existing `StartVoiceCall` and through the
existing `voice_call_updated` / `voice_call_ended` events.
