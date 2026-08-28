# APNs VoIP Setup

The backend talks to Apple **directly** for exactly one kind of traffic: waking an iPhone
for an incoming call. Everything else this product sends still goes through Firebase and
needs nothing here.

Why the direct connection: Firebase will not send `apns-push-type: voip`, and that header
is what makes iOS hand the push to PushKit instead of drawing a banner. PushKit is the only
way to present a full-screen incoming-call screen on a locked phone, answer without
unlocking, or start audio from a force-quit app.

**This is a second *consumer* of your APNs key, not a second key.** Firebase already holds
a copy of that key to send alert pushes on your behalf; the backend needs the file itself
because it makes the APNs connection rather than delegating it.

See [NOTIFICATION-SYSTEM-ARCHITECTURE.md](NOTIFICATION-SYSTEM-ARCHITECTURE.md#call-wake-dispatch-feature-037)
for where this sits in the delivery pipeline, and [FCM-SETUP.md](FCM-SETUP.md) for the
Firebase half.

## What you need from Apple

1. **An APNs auth key (`.p8`).** In the Apple Developer portal, *Certificates, Identifiers
   & Profiles → Keys → +*, enable **Apple Push Notifications service (APNs)**, and
   download the key. **Apple lets you download it exactly once** — store it in the
   secret manager immediately.

   A token-based APNs auth key works for VoIP pushes as well as alert pushes; the older
   per-app *VoIP Services Certificate* is not required. One key can serve every app in the
   team.

2. **The Key ID** — the ten-character identifier shown next to the key, and also embedded
   in the downloaded filename (`AuthKey_ABC1234567.p8`).

3. **The Team ID** — ten characters, shown under *Membership*.

4. **The VoIP topic** — the app's bundle identifier with `.voip` appended:
   `com.devguards.TechOffice.voip`. This is a *different topic* from the one alert pushes
   use, and sending to the wrong one is silently rejected by Apple.

### You probably already have this key

If iOS push already works, an APNs auth key was created and **uploaded to Firebase** —
that is step 2 of the Firebase iOS app setup in [FCM-SETUP.md](FCM-SETUP.md). The same key
serves both purposes: Firebase holds a copy to send alert pushes on your behalf, and this
backend uses the file directly for VoIP pushes. Apple permits one key to have multiple
senders, so do **not** issue a second one.

The fastest way to recover all three identifiers: **Firebase Console → Project Settings →
Cloud Messaging → your Apple app → APNs Authentication Key**. That panel shows the Key ID
and Team ID already in use.

**If you cannot find the `.p8` for that Key ID, do not panic and do not touch Firebase.**
Apple never lets a key be downloaded twice, but the backend's key **does not have to be
the one Firebase uses**: any APNs key belonging to the team can send to any of the team's
topics. Issue a fresh key for the backend and leave the Firebase one alone. The only
constraint is Apple's limit of **two active APNs keys per team** — if you are already at
two, revoke the one nothing uses before creating another.

### Check a credential before wiring it in

An unusable credential does not fail loudly: it degrades every iPhone to the tier-B ring,
which looks like a device problem rather than a config problem. Confirm the key first:

```sh
cd backend
go run ./scripts/dev/apns-voip-probe <key.p8> <keyID> <teamID> com.devguards.TechOffice.voip
```

It sends one push to a deliberately invalid device token, so the reason code is about the
JWT rather than the device:

| Reason | Meaning |
|---|---|
| `BadDeviceToken` | **Success.** Key, key ID, team and topic were all accepted; only the fake device token was rejected. |
| `InvalidProviderToken` | Not an APNs key, or the key ID / team ID do not match it. App Store Connect API keys are also named `AuthKey_*.p8` and are a common mix-up. |
| `TopicDisallowed` | Real APNs key, but restricted and not permitted to send to this topic. |

The app also needs the VoIP background mode and the PushKit entitlement. Those are added
at prebuild by the `expo-callkit-telecom` config plugin in `frontend/apps/mobile/app.json`
— do not add them by hand, or they will be duplicated.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `APNS_VOIP_KEY_PATH` | yes | Path to the `.p8` file on disk |
| `APNS_VOIP_KEY_ID` | yes | The key's ten-character ID |
| `APNS_VOIP_TEAM_ID` | yes | Apple Developer team ID |
| `APNS_VOIP_TOPIC` | yes | `com.devguards.TechOffice.voip` |
| `APNS_VOIP_USE_SANDBOX` | no | `true` routes to Apple's sandbox gateway. **A development build's VoIP token is registered in the sandbox**, so leave this set while testing on a dev build and unset it for TestFlight and the App Store. |

They follow the same shape as `GOOGLE_APPLICATION_CREDENTIALS`: a path to a key file plus
the identifiers Apple needs to attribute it.

## Two degradation modes, deliberately different

**Unset entirely** — the server starts, logs a loud warning, and every iOS device falls
back to the high-priority alert ring the app shipped before this feature. Calls still
arrive; they just do not present as system calls. This is the same posture the Firebase
client has when `GOOGLE_APPLICATION_CREDENTIALS` is missing, and it is what makes local
development possible without an Apple account.

**Partially set** — the server refuses to start. A half-configured credential is a
deployment mistake, not an opt-out, and silently degrading it would hide the mistake
behind "calls work, just not well" for however long it takes someone to notice.

## Verifying it

1. Sign in on a physical iPhone running a **development build** (the native call module
   cannot run in Expo Go).
2. Call `ListPushTokens` for that account. A correctly registered device shows **two rows
   sharing one `device_identifier`**: one `fcm` and one `apns_voip`. If only the `fcm` row
   is there, the app never received a PushKit token — check the VoIP background mode and
   that `registerVoIPPush()` ran.
3. Place a call to that account and read the audit:

   ```sql
   SELECT attempt_status,
          reason,
          metadata->>'tier'   AS tier,
          metadata->>'event'  AS event,
          metadata->>'deviceIdentifier' AS device
     FROM notification.delivery_attempt
    WHERE channel = 'call_wake'
    ORDER BY attempted_at DESC
    LIMIT 20;
   ```

   `tier = native` with `attempt_status = sent` means the VoIP push left the building.
   `tier = fallback` with `reason = native_tier_unavailable` means the device was not
   considered native-call capable — usually a missing VoIP token row.

4. A `failed` row whose metadata `error` mentions **`BadDeviceToken`** almost always means
   the sandbox setting does not match the build: a development build's token is a sandbox
   token, and production gateways reject it.

## Failure handling worth knowing

- **`410 Unregistered`** marks the `push_token` row `is_valid = false`, exactly as an FCM
  `UNREGISTERED` does. The device gets a new row when the app re-registers.
- **A push is bounded at three seconds.** A call wake that has not left the building
  inside that is already past its usefulness — the whole ring budget is five seconds.
- **Expiration is the call's ring deadline**, so a wake that goes stale in Apple's queue
  is dropped by Apple rather than delivered late to ring a phone for a call that is over.
- **The collapse ID is the call id**, so a later wake for the same call replaces an
  undelivered earlier one instead of queueing behind it.
