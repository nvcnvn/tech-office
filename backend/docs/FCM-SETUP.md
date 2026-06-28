# Native Mobile Push Setup

This document describes the preferred open-source setup for mobile push notifications in Tech Office when the project uses direct native provider delivery instead of Expo Push Service.

## Status

The target architecture documented here is:

- Android: native FCM delivery
- iOS: Firebase Messaging token registration backed by APNs
- Backend: Firebase Admin SDK sends directly to native provider tokens

Current repository status:

- The backend already initializes Firebase Admin from `GOOGLE_APPLICATION_CREDENTIALS` and sends push through Firebase Admin.
- The mobile app now registers native Android device tokens and records provider metadata.
- iOS registration still requires Firebase Messaging native integration to be installed and configured before the app can obtain a Firebase registration token.

That means the repository is partially aligned with this document already, with Android on the direct native path and iOS still awaiting full Firebase Messaging setup.

## Why this architecture

We prefer direct native push delivery for the open-source platform because it keeps the delivery path close to standard native mobile infrastructure:

- no Expo Push Service relay in the middle
- one backend-owned delivery path
- clearer provider-native debugging
- easier reasoning about long-term native app behavior

Important clarification:

- Android push is delivered by FCM.
- iOS push is still delivered by APNs under the hood, even when Firebase Messaging is used.

## Platform identifiers

The current Expo app identifiers are defined in `frontend/apps/mobile/app.json`:

- iOS bundle identifier: `com.devguards.TechOffice`
- Android package name: `com.devguards.TechOffice`

Change these before release if your public/open-source distribution uses different identifiers. Firebase and Apple setup must match the final values exactly.

## Required accounts

You need the following accounts before native push can work end to end:

- Apple Developer account
- Firebase project
- Expo account for native builds, if you continue using EAS build tooling

## Required client and backend pieces

For direct native delivery, the full system needs all of the following:

1. Mobile app asks for notification permission.
2. Mobile app retrieves a native device push token, not an Expo push token.
3. Mobile app registers that native token with `RegisterPushToken`.
4. Backend stores the token and sends through Firebase Admin.
5. Firebase project and Apple APNs credentials are configured correctly.
6. Testing is performed on real devices.

## Step 1: Create Firebase project

Create a Firebase project dedicated to the mobile app.

Inside Firebase Console:

1. Create or select a project.
2. Add an Android app using the Android package name.
3. Add an iOS app using the iOS bundle identifier.
4. Enable Cloud Messaging for the project.

## Step 2: Android setup

### Firebase Android app

In Firebase Console:

1. Register the Android app with package `com.devguards.TechOffice` or your replacement package.
2. Download `google-services.json`.
3. Store it in a stable location inside the mobile app workspace.

Recommended location:

- `frontend/apps/mobile/google-services.json`

### Expo app config

Add `googleServicesFile` to the Android config in `frontend/apps/mobile/app.json`.

Expected shape:

```json
{
  "expo": {
    "android": {
      "package": "com.devguards.TechOffice",
      "googleServicesFile": "./google-services.json"
    }
  }
}
```

### Firebase service account for backend

Create a Firebase service account key with permission to send messages.

For local backend development, set:

```env
GOOGLE_APPLICATION_CREDENTIALS=.dev-keys/your-firebase-adminsdk.json
```

The backend already reads this variable and disables push if it is missing.

## Step 3: iOS setup

### Apple Developer registration

In Apple Developer:

1. Create or select the App ID matching the iOS bundle identifier.
2. Enable the Push Notifications capability for that App ID.
3. Create an APNs authentication key.
4. Record the Key ID, Team ID, and download the `.p8` file.

### Firebase iOS app

In Firebase Console:

1. Register the iOS app using the exact bundle identifier.
2. Upload the APNs authentication key to Firebase Cloud Messaging.
3. Download `GoogleService-Info.plist`.

Recommended location:

- `frontend/apps/mobile/GoogleService-Info.plist`

### Native client requirement

If the project uses Firebase Messaging tokens on iOS, the iOS app must include Firebase Messaging native integration so it can obtain and refresh the Firebase registration token.

This is not the same as using Expo Push Service. The app remains an Expo/React Native app, but token acquisition becomes provider-native.

## Step 4: Build native apps

Push notification testing must use native builds on real devices.

Do not use:

- Expo Go
- Android emulator for final verification
- iOS simulator for remote push verification

Use one of these:

- EAS development builds
- locally built native debug builds
- release/profile builds when validating production credentials

## Step 5: Mobile token registration contract

The backend contract is already exposed through `rpc.v1.NotificationService/RegisterPushToken`.

For the direct native path, the mobile app should register:

- Android: FCM registration token
- iOS: Firebase Messaging registration token backed by APNs

It should not register:

- Expo push tokens from `getExpoPushTokenAsync`

Current implementation status:

- Android uses `expo-notifications` native device token registration.
- iOS expects `@react-native-firebase/messaging` to be available so the app can register a Firebase token instead of an APNs-only token.

## Step 6: Backend configuration

The backend already expects Firebase Admin credentials through `GOOGLE_APPLICATION_CREDENTIALS`.

Relevant environment variables from `backend/.env.example`:

```env
GOOGLE_APPLICATION_CREDENTIALS=.dev-keys/techoffice-dev-firebase-adminsdk.json
# FCM_SERVICE_ACCOUNT_JSON={...}
# FCM_PROJECT_ID=your-firebase-project-id
```

Current behavior:

- if `GOOGLE_APPLICATION_CREDENTIALS` is not set, push delivery is disabled
- backend logs a warning and continues without push delivery

## Step 7: Production secret handling

Community guidance for production deployments:

- never commit Firebase service account JSON files
- never commit Apple `.p8` APNs keys
- inject secrets through deployment-time secret managers
- keep dev/test credentials separate from production credentials

## Testing checklist

Use this checklist after setup:

1. Install the native app on a real Android device and a real iPhone.
2. Grant notification permission.
3. Sign in and confirm token registration succeeds.
4. Verify the backend stores a push token for the employee.
5. Put the app in the background.
6. Trigger a notification from a backend flow.
7. Verify the notification appears on the device.
8. Tap the notification and verify deep-link behavior.

Important repo-specific note:

- This backend suppresses some push notifications when the user is already online and actively connected through SSE.
- To verify real push delivery, test with the app backgrounded or terminated.

## Implementation tasks after documentation

This repository still needs follow-up work to fully match the direct native setup described above.

Required follow-up work:

1. Add platform-specific client setup files for Firebase Messaging.
2. Install and wire `@react-native-firebase/messaging` for iOS token acquisition.
3. Verify backend error handling for invalid or rotated device tokens.
4. Add device-level verification docs for local development and CI smoke checks.

## Summary

If you want Tech Office to behave like a conventional native mobile application, use direct native push delivery:

- Firebase Admin on the backend
- native provider tokens on the client
- APNs configured through Apple Developer for iOS
- Firebase configured for both Android and iOS

That architecture keeps the system explicit and backend-owned, which is the preferred direction for this project.