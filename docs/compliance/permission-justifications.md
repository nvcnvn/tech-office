# Permission justifications

One paste-ready justification per permission the app requests. Both stores ask for
this text at submission; App Store Connect asks in App Review notes and, for
location, in the privacy questionnaire, while Play Console asks in the Data safety
form and in the declaration for any sensitive permission.

`frontend/apps/mobile/scripts/check-store-manifest.js` fails the build when this
document and the manifest disagree, so a permission cannot be added without also
being explained here, and one cannot be removed here while still being requested.

**Standing obligation**: if a change adds, removes, or repurposes a permission, it
updates this file in the same change set. That is part of the Definition of Done,
not a follow-up.

---

## iOS

### `NSMicrophoneUsageDescription`

> Tech Office uses your microphone for voice calls and voice messages with your
> colleagues.

**Why the app needs it**: Tech Office includes voice calling between colleagues and
recorded voice messages in chat. Both capture audio only while the person is in a
call or holding the record control; there is no background or ambient recording.

**When it is requested**: the first time someone starts or joins a voice call, or
records a voice message. Refusal leaves every other part of the app working.

### `NSCameraUsageDescription`

> Tech Office uses your camera to take photos to attach to messages, tasks and job
> records.

**Why the app needs it**: field workers photograph completed work as evidence
against a task, and attach photos to conversations. The camera is opened only from
an explicit "take a photo" action.

**When it is requested**: the first time someone chooses to take a photo rather
than pick an existing one.

### `NSPhotoLibraryUsageDescription`

> Tech Office needs access to your photos so you can attach them to messages, tasks
> and job records.

**Why the app needs it**: the same attachment flows, for a photo already on the
device. The app reads only the items the person selects; it never enumerates the
library.

**When it is requested**: the first time someone opens the photo picker.

### `NSFaceIDUsageDescription`

> Tech Office uses Face ID so you can sign in without typing your PIN each time.

**Why the app needs it**: workers sign in with a short PIN, often on a shared or
gloved-hands device. Face ID is offered as a faster alternative to re-typing it.
Biometric data never leaves the device and is never sent to the server; the app
only receives the operating system's success or failure.

**When it is requested**: the first time someone opts in to biometric sign-in.
Declining leaves PIN sign-in fully functional.

### `NSLocationWhenInUseUsageDescription`

> Tech Office uses your location to confirm you are at the job site when you check
> in or complete a task. It is only used while the app is open.

**Why the app needs it**: some recurring tasks require proof that the work was done
at the right place — a site visit, a delivery, an equipment check. The app captures
a single coordinate at the moment the person checks in or completes such a task.

**Foreground only**: the app calls only `requestForegroundPermissionsAsync`. It
declares no background-location key and performs no background location updates,
geofencing, or significant-change monitoring. There is no location tracking between
those explicit actions.

**When it is requested**: the first time someone checks in to an event or completes
a task that requires location evidence.

---

## Android

### `android.permission.RECORD_AUDIO`

Voice calls and voice messages. Same scope as `NSMicrophoneUsageDescription` above:
capture happens only during an active call or an explicit recording.

### `android.permission.ACCESS_COARSE_LOCATION` and `android.permission.ACCESS_FINE_LOCATION`

Confirming presence at a job site on check-in and on completion of a task that
requires location evidence. Foreground only — the app declares neither
`ACCESS_BACKGROUND_LOCATION` nor any foreground-location service type, and takes a
single reading per explicit action rather than tracking.

### `android.permission.USE_BIOMETRIC` and `android.permission.USE_FINGERPRINT`

Optional biometric sign-in as an alternative to typing a PIN. `USE_FINGERPRINT` is
the pre-Android-9 form of the same capability and is present for older devices.
Biometric data stays on the device.

### `android.permission.POST_NOTIFICATIONS`

Delivering messages, call invitations, task assignments and reminders. Required
from Android 13 onward for any notification to be shown at all; without it the app
appears to lose notifications silently. The app requests it at the point
notifications first matter — after sign-in, when push registration runs — and
continues to work if refused.

---

## Permissions deliberately blocked

These arrive transitively from dependencies and are removed in `app.json` under
`android.blockedPermissions`. Each would be a submission finding if it shipped,
because the app does not use it.

| Permission | Why it is blocked |
|---|---|
| `android.permission.SYSTEM_ALERT_WINDOW` | Nothing in the app draws an overlay on top of other apps. |
| `android.permission.READ_EXTERNAL_STORAGE` | Legacy broad storage access. The image picker uses scoped access, so the app reads only the files the person selects. |
| `android.permission.WRITE_EXTERNAL_STORAGE` | The app writes nothing to shared external storage. |

## Keys deliberately absent

| Key | Why it is absent |
|---|---|
| `NSLocationAlwaysUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription` | The app never requests background location. Declaring these would ask for a capability it does not use. |
| `NSLocalNetworkUsageDescription`, `NSBonjourServices` | Needed only to reach a development server from a debug build on a physical device. They are injected by `plugins/with-dev-local-network.js` when `EXPO_LOCAL_DEV_NETWORK=1`, and are absent from every production build. |
| `ACCESS_BACKGROUND_LOCATION` | Same reason as the iOS "always" keys. |

## Export compliance

`ITSAppUsesNonExemptEncryption` is set to `false`. The app uses only HTTPS and the
platform's own cryptography; it contains no proprietary or non-exempt encryption.
