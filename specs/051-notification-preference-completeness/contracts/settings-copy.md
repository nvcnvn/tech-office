# Contract: Notification settings — controls and copy

**Feature**: `051-notification-preference-completeness`

US3 and FR-020 are satisfied by strings, so the strings are part of the
contract. An implementer who paraphrases them can reintroduce exactly the
overpromise this feature exists to remove.

All of this lives in the existing **Notifications** section of
`frontend/apps/mobile/src/app/(app)/(more)/settings.tsx`. No new route.

---

## 1. In-App Alerts

| | |
|---|---|
| `testID` | `setting-in-app-alerts` (existing, unchanged) |
| Switch `testID` | `setting-in-app-alerts-switch` (**new** — the flow has to tap the switch, and `SettingRow`'s press target toggles too) |
| Icon | `bell.fill` (unchanged) |
| Title | `In-App Alerts` |
| Subtitle | `Show banners while you're using the app. Your alerts list, unread badges and phone notifications are not affected.` |

The subtitle is the FR-020 statement for this control: it names what the switch
removes (the banner) and what it leaves alone (list, counts, push). The current
string — "Show live notification banners while you are using the app." — states
only the first half, which is why someone reads it as "turn notifications
down".

## 2. Mute by area

A second `Card` under the same **Notifications** section label, introduced by a
one-line explanation and followed by nine switch rows.

| | |
|---|---|
| Section intro `testID` | `setting-mute-intro` |
| Intro text | `Muting an area stops the phone notification for it. The alert still arrives in your list. Mentions and incoming calls always come through.` |

Both sentences of FR-020's remaining obligations are here: the mute/list
distinction (US3 scenario 2) and the priority-0 exemption (US3 scenario 3).
They are stated once above the list rather than repeated on nine rows.

### Rows

One row per entry of `SOURCE_DOMAINS`, in this order. `testID` is
`setting-mute-<domain>`; the switch inside it is `setting-mute-<domain>-switch`.
Switch on = **muted**.

| Domain | Label | Icon |
|---|---|---|
| `chat` | `Chat` | `bubble.left.and.bubble.right.fill` |
| `projects` | `Tasks and projects` | `checklist` |
| `calendar` | `Calendar` | `calendar` |
| `docs` | `Documents` | `doc.text.fill` |
| `crm` | `Customers` | `person.2.fill` |
| `hr` | `People and HR` | `person.badge.shield.checkmark` |
| `support` | `Support` | `lifepreserver` |
| `finance` | `Finance` | `creditcard.fill` (**new**, see below) |
| `system` | `System` | `gearshape.fill` |

Eight of the nine icons are already mapped in
`components/ui/sf-icon.tsx`. `creditcard.fill` is not; the map gains one entry
pointing at the Ionicons `card` glyph. `SFIcon` renders Ionicons, so an unmapped
name is a missing icon rather than a crash — which is exactly why it has to be
added deliberately rather than assumed.

Labels are the workspace's own words, not the wire values: a person looking for
calendar noise should not have to know the domain is spelled `projects` for
tasks. The mapping from domain to label and icon lives beside the screen, not in
`apis` — it is UI copy, while the domain list itself is a cross-stack constant.

`calendar` is deliberately third, above the alphabetically earlier domains: it
is the domain this feature exists to make mutable and the one SC-001 times.

## 3. States

| State | Behaviour |
|---|---|
| Preferences not yet loaded | Every switch renders at its default (`In-App Alerts` on, all mutes off) and is **disabled**. FR-022 is satisfied by never letting a person act on, or believe, a value that has not come back from the server. |
| Save in flight | The switch that was touched moves immediately (FR-021); all switches in the section are disabled until the write settles, so a second tap cannot race the first. |
| Save failed | The cache rolls back, the switch returns to its stored position, and an `Alert` is shown: title `Couldn't save that`, body `We couldn't save that just now, so it has been put back. Check your connection and try again.` — the wording already used by the theme toggle for the same situation. |
| Offline | Indistinguishable from "save failed", by design. Nothing is queued (spec assumption): a mute a person believes is active and is not is worse than a refusal. |

## 4. What is deleted

`frontend/apps/mobile/src/lib/app-settings.ts` is removed in full, along with
the `notifications_enabled` MMKV key it owned. The file's own header says
"anything added here must have a consumer" — after this feature it has no
content at all, so keeping it as an empty module would be the shim FR-014
forbids.

Its two importers become consumers of `useNotificationPreferences`:

- `app/(app)/_layout.tsx:104,345` — the banner gate. While preferences are
  loading the gate reads `true`: a banner drawn once before the preference
  arrives is a smaller failure than a silenced app, and the value is served from
  the persisted query cache on every launch after the first.
- `app/(app)/(more)/settings.tsx` — the section above.
