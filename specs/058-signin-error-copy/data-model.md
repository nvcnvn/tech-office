# Phase 1 Data Model: Sign-In Errors Written for the Person Reading Them

**Branch**: `058-signin-error-copy` | **Date**: 2026-09-12

No database table, no proto message, no persisted state. The "entities" here are three
in-memory shapes in the mobile client, and the decision table that connects them. The table
in §3 is the specification the self-check walks row by row.

## 1. `SSOAvailabilityInput`

The complete set of facts the decision depends on. Passed in rather than read from globals
so the function is testable without a device.

| Field | Type | Source at runtime |
|---|---|---|
| `platform` | `"ios" \| "android" \| "web" \| string` | `Platform.OS` |
| `googleClientId` | `string \| undefined` | `GOOGLE_IOS_CLIENT_ID` on iOS, `process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` on Android, `undefined` elsewhere |
| `appleAvailable` | `boolean \| null` | `null` until `AppleAuthentication.isAvailableAsync()` resolves, then its answer |

`appleAvailable` is the only asynchronous input, and `null` is its "not yet known" state
(FR-005). `googleClientId` is `undefined` — not empty string — when absent; the function
treats `""` and whitespace as absent too, because an unset EAS secret can materialise as an
empty string.

## 2. `SSOAvailability`

What `resolveSSOAvailability(input)` returns.

| Field | Type | Meaning |
|---|---|---|
| `google` | `boolean` | Render the Continue with Google button |
| `apple` | `boolean` | Render the Apple button |
| `any` | `boolean` | `google \|\| apple` — gates the divider and the whole alternatives card (FR-003) |
| `resolved` | `boolean` | Every input is known. False only while `appleAvailable === null` on iOS |
| `diagnostic` | `string \| null` | Development-only line naming the missing configuration, or `null` when nothing is missing (FR-010) |

`diagnostic` is data, not a side effect: the pure function decides *what* the engineer needs
to be told, the hook decides *whether* to say it (`__DEV__`, once per mount, FR-011/FR-012).
This is what lets the self-check assert the diagnostic names
`EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` without a console spy.

## 3. Decision table

Rows are evaluated as written; the first matching row for each provider wins. `—` means the
input does not affect that column.

| # | `platform` | `googleClientId` | `appleAvailable` | `google` | `apple` | `resolved` | `diagnostic` |
|---|---|---|---|---|---|---|---|
| 1 | `ios` | present | `null` | `true` | `false` | `false` | `null` |
| 2 | `ios` | present | `true` | `true` | `true` | `true` | `null` |
| 3 | `ios` | present | `false` | `true` | `false` | `true` | "Sign in with Apple is unavailable on this device…" |
| 4 | `ios` | absent | `true` | `false` | `true` | `true` | names the iOS Google client identifier as missing |
| 5 | `ios` | absent | `false` | `false` | `false` | `true` | names both |
| 6 | `android` | present | — | `true` | `false` | `true` | `null` |
| 7 | `android` | absent | — | `false` | `false` | `true` | names `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` |
| 8 | anything else | — | — | `false` | `false` | `true` | `null` |

Notes on the rows that are easy to get wrong:

- **Row 1** is FR-005. Google is already decided on iOS and renders immediately; only the
  Apple button waits. `resolved` is false so a caller that prefers to wait for both can,
  but the shipped screen does not need to.
- **Rows 4 and 5** cannot occur in a correctly built iOS app — `GOOGLE_IOS_CLIENT_ID` is a
  compiled literal. They exist so that deleting or emptying that literal fails the
  self-check instead of shipping (spec's per-platform assumption).
- **Row 8** covers `web` and anything else Expo may report. Nothing renders, and there is no
  diagnostic, because no configuration is missing — the platform simply is not a target for
  either provider. The Apple button was already iOS-only, so this changes nothing off iOS
  beyond removing a Google button that would not have worked.
- **`any`** is false only on rows 5, 7 and 8. Those are the three states in which the
  divider, the card and its support text all disappear (FR-003).

## 4. `SignInMessage`

Not a type — a constraint on every string passed to `Alert.alert` from
`src/app/(auth)/*.tsx`. Two properties, both machine-checked by
`sso-availability.check.ts`:

1. **Contains no build-configuration vocabulary.** Banned, word-bounded, case-insensitive:
   `EXPO_PUBLIC_*`, `build`, `rebuild`, `native`, `SDK`, `environment variable`,
   `client id`, `not enabled yet`, `still needs`, `not configured`, `not implemented`,
   `coming soon`. (FR-007, FR-008, SC-001)
2. **Names an action the reader can take.** Enforced for the failure messages by asserting
   each contains `email and password` or `try again`. (FR-009, SC-003)

Literals matching `/^[a-z0-9.\-\/]+$/` are exempt from both — testIDs, route paths, SF
Symbol names such as `building.2`. They are not prose and are never read by a person.

[ASSUMPTION: the action check is a substring assertion over a small enumerated list rather
than natural-language analysis. It is a tripwire against the class of message this feature
deletes, not a copy editor; a message that passes it can still be badly written, and a human
reviewer remains the real gate.]

## 5. State transitions

One, on the screen's lifetime:

```
mount
  └─ google decided synchronously ─────────────────► button rendered or not, final
  └─ apple: null ──(isAvailableAsync resolves)──► true | false, final for this mount
                                                        └─ __DEV__ && diagnostic → console.warn (once)
```

There is no transition back to `null`, and no re-resolution on re-render. A device that
withdraws Sign in with Apple after this point is handled at tap time by the guard in
`onAppleSignIn`, which is the spec's stated edge case — the button does not vanish under a
finger.
