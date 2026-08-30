# Notifications & Presence

The delivery backbone every other domain publishes into, plus the presence signal that
decides how something gets delivered. Owned by `internal/notification`; contract in
`rpc/v1/notification.proto` (`NotificationService`, 19 RPCs + one server-streaming RPC).

**Status date: 2026-08-29.** Supersedes specs 007, 008, 012, 019, 021, 033, 037. Deeper
references: `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md`,
`NOTIFICATION-RESCUE-PUSH-DESIGN.md`, `NOTIFICATION-RULES.md`, `FCM-SETUP.md`.

## Data model

| Table | Role |
|---|---|
| `notification.notification` | the event: source domain, type, title, message, `action_data`, `navigation_target`, priority, `policy_key`, `delivery_class` |
| `notification.notification_recipient` | one row per recipient: delivery status, acknowledgement, fallback summary |
| `notification.resource_subscription` (+ `_reason`) | V2 follow state per (employee, resource) |
| `notification.resource_surface` | maps a child surface (task discussion channel, doc comment thread) back to its parent resource |
| `notification.active_connection` | **UNLOGGED**, one row per live SSE connection — the presence and routing registry |
| `notification.active_context` | UNLOGGED, what each connection is currently viewing (channel / document / task) |
| `notification.active_listener` | reference table; which backend instance owns which `LISTEN` topic |
| `notification.live_receipt` | client transport receipts — "I received and parsed this event" |
| `notification.delivery_attempt` | per-channel audit: `sse | push | replay | call_wake` × `queued | sent | skipped | failed` + reason |
| `notification.push_token` | provider tokens, one row per `token_type` per device |
| `notification.presence_visibility` | privacy: `everyone | departments | offline` + custom status |
| `notification.personal_preference` | DND window + muted domains |
| `notification.ephemeral_signal`, `notification_batch`, `notification_delivery_log` | supporting |

### Read vs acknowledged

These are different signals and the distinction matters:

- **Read** (`MarkAsRead`, `MarkAllBeforeTimestampAsRead`) — the user saw it in a list.
- **Acknowledged** (`AcknowledgeNotifications`, `AcknowledgeAllBeforeTimestamp`) — the
  authoritative unread signal. It is set only by `destination_open` (the user opened the
  linked destination) or `explicit_ack` (dismissal). **Displaying a popup does not
  acknowledge.** Acknowledgement is also what cancels a queued rescue push.

## Priority

`priority IN (0, 1, 2, 4)` — note there is no 3.

| Value | Meaning |
|---|---|
| 0 | deliver always, even when offline |
| 1 | deliver when not offline (default) |
| 2 | deliver only when online |
| 4 | silent / ephemeral — never persisted, log only |

### What priority 0 costs

`PriorityAlways` is not "important", it is "reach them whatever it takes":
`ShouldSendPush` returns true before it looks at presence or at which channel the
recipient is viewing, `ShouldSuppressPush` returns before do-not-disturb and domain mute,
and `rescuePushWindowForRequest` collapses the rescue delay to zero. Only `mention` and
`voice_call_incoming` earn it — an @you and a ringing phone are both things a person has
asked to be interrupted for.

Ordinary chat (`message`, `reply`) publishes at `PriorityDefault`. It used to publish at 0,
which meant a DM pushed someone who was reading that very conversation and no setting
could quiet it. Two things had to change together, because either alone does nothing: the
priority, and passing the channel as `active_channel_id` so `ShouldSendPush` can see which
conversation the recipient is in. Before that the "already viewing the target channel"
branch was unreachable for chat — the channel was only ever in `action_data`.

`active_channel_id` is overloaded, which is why the message publish sets it on the direct
-message branch only. On a persistent notification it means "skip the push if they are
looking at this"; on a `live_only` one it *reroutes* the notification to whoever is viewing
that channel instead of to the recipients it was addressed to. A channel message is
`live_only`, and naming its channel would quietly narrow its audience.

## Delivery pipeline

```
domain publishes → PublishNotification
   │
   ├─ resolve recipients (direct target ∪ resource subscribers ∪ department fan-out)
   ├─ persist notification + notification_recipient rows
   ├─ NOTIFY on the owning instance's topic  ─────────────┐
   │                                                       ▼
   │                                          instance LISTEN consumer
   │                                                       │
   │                                          push to in-process SSE registry
   │                                                       ▼
   │                                          client receives → ConfirmNotificationReceipt
   │                                                             (writes live_receipt)
   └─ queue push with fallback_due_at
                │  (0 s if already unreachable; else 2 s direct-target / 4 s subscribed, 5 s max)
                ▼
      rescue push worker (1 s tick, batch 100)
                │
      still unacknowledged and no confirming receipt?  → FCM push
```

Cross-instance delivery goes through PostgreSQL `LISTEN`/`NOTIFY` on an instance-scoped
topic, which is why `active_connection.instance_id` and the `active_listener` registry
exist: the publisher resolves recipients → connections → owning instances, then notifies
only those.

### Rescue push (why push is *delayed*, not immediate)

An SSE connection can be a ghost — the row says live, the socket is dead. Rather than
choosing between "push always" (duplicate notifications) and "push only when offline"
(silent misses), the publisher queues a delayed push and cancels it if the client proves it
got the event:

- windows: 2 s for direct-target notifications, 4 s for subscription-driven, 5 s ceiling
  (`internal/notification/publisher.go`)
- cancelled by `sse_receipt_confirmed` (a `live_receipt` from a **foreground/visible**
  client) or `acknowledged_before_fallback`
- otherwise sent, recording the reason it survived

**Every** push goes through this worker — there is no inline send. Recipients that routing
already judged unreachable (`connection_unresponsive`, hidden status, priority 0) are queued
with a **zero** window and carry their routing reason as `fallback_reason`; they are picked
up on the next worker tick. `PublishNotification` therefore performs no FCM I/O, so an
unresponsive FCM can no longer hold the publishing request's Postgres transaction open for
the 10 s `fcmBatchTimeout`. The cost is that push for an offline recipient lands up to one
worker tick (1 s) later than the commit.

`delivery_attempt.reason` is the auditable answer to "why did this person never see it":
`live_only_policy`, `no_active_context_match`, `no_push_target`, `recipient_ineligible`,
`recipient_online`, `suppressed_by_preference`, `sse_receipt_confirmed`,
`acknowledged_before_fallback`, `connection_unresponsive`, `provider_error`,
`delivery_error`, and — for call wakes only — `no_call_wake_target`,
`native_tier_unavailable`, `call_already_ended`, `acting_device_excluded`.

Because the send is always the worker's, `fallback_status` reads `queued` for a moment
even for a recipient nobody can reach live. The immediacy lives in `fallback_due_at` —
now for an unreachable recipient, a rescue window later for a reachable one — so that,
and not the status, is what `presence_ping_pong_test.go` asserts on.

### Call wakes

A live call event does not follow the rules above, and the differences are the point.
Since spec 037 the rescue worker, on reaching a queued `voice_call_incoming` row, hands it
to the **call wake dispatcher** (`internal/notification/call_wake.go`) instead of sending
an alert push. Three rules are inverted for this class:

| Ordinary push | Call wake |
|---|---|
| a `sse_receipt_confirmed` cancels it | **never cancelled by a receipt** — the phone must ring natively even with a tab open |
| DND and muted domains suppress it | **rings through both**; `suppressed_by_preference` must never appear on a `call_wake` row |
| one attempt per recipient | **one attempt per device per event** |
| every target is sent to | **the device that caused the ending is skipped**, reason `acting_device_excluded` |

The window is already zero without special handling: the incoming-call notification is
priority 0, and `rescuePushWindowForRequest` returns 0 for priority 0.

**Two transports, because no single one wakes a locked, force-quit phone on both
platforms:**

- **iOS** — an APNs VoIP push sent **directly to Apple** (`internal/notification/apns_voip.go`,
  `github.com/sideshow/apns2`). Firebase will not carry `apns-push-type: voip`, and that
  header is what routes the push to PushKit. The push is priority 10, its collapse ID is
  the call id so a superseded wake replaces its predecessor, and its expiration is the
  call's ring deadline so a stale wake is dropped by Apple rather than by the app. A `410
  Unregistered` marks the token row invalid, exactly as an FCM `UNREGISTERED` does.
- **Android** — a high-priority **data-only** FCM message. A `notification` message lets
  the system draw a tray notification and may not run the app's handler on a killed app;
  data-only always dispatches to the messaging service, which is what earns the temporary
  Doze allowlist and the background foreground-service-start exemption. Android delivers
  `com.google.firebase.MESSAGING_EVENT` to exactly **one** service, so the app's manifest
  must leave `expo-callkit-telecom`'s the only one declared — it is what reports the call
  to Telecom before JavaScript is running, and it delegates every non-call message onward
  by extending expo-notifications' service. Both other claimants are stripped at prebuild:
  the module's own config plugin removes expo-notifications', and
  `apps/mobile/plugins/with-firebase-notification-color.js` removes
  `@react-native-firebase/messaging`'s, which merges in first and would otherwise win.
  With that service present, an Android device rings on neither tier: the backend routes
  it tier A, and the wake is swallowed before Telecom sees it.

**Tiers.** The dispatcher chooses exactly one transport per device and never both:
*tier A* is the native path above; *tier B* is the high-priority alert ring this app
already shipped, recorded with reason `native_tier_unavailable`. Because tier B is
existing behaviour, covering the devices that cannot run tier A costs a routing decision
rather than a second implementation. The share of tier-A rows is the measurement behind
the feature's ~80% target — read it from the audit, do not estimate it.

**Only live call events may use this transport.** On iOS that is not hygiene: a VoIP push
that does not result in a call reported to CallKit terminates the app. The dispatcher
refuses any event kind outside `incoming | cancelled | answered_elsewhere |
declined_elsewhere | ended`.

An `incoming` wake carries the pending `invitationId` alongside the call id, the channel,
the caller's display name and the workspace name. That one field is what lets a phone
declining from its lock screen decline the *invitation* rather than end the call: ending
records the call as `cancelled`, as though the caller had hung up, and leaves the
persistent `voice_call_incoming` notification unacknowledged so it replays as a stale
prompt on the next reconnect.

A terminal wake carries the caller's name and id as well, and no invitation, channel or
ring deadline — there is nothing left to ring for. Naming the caller is not decoration:
the client module reports *every* wake to the OS as a new incoming call before JavaScript
runs, so a terminal wake always flashes a call on screen for the moment it takes the
client to end it. Named, that flash reads as the call that just ended; unnamed, the OS
falls back to the handle, which is the call's own UUID, and the user sees an unknown
number calling at the moment they hang up.

Provider I/O happens on a background sender, not on the caller's goroutine, so it never
sits inside a request transaction. Before sending an `incoming` wake the sender confirms
the call is still live, which closes the window where a rolled-back transaction would
otherwise leave a phone ringing for a call that never existed.

### Suppression

`RoutingLogic.DecideFallback` combines two checks and returns a single decision with a
reason:

- `ShouldSendPush` — presence-based. Priority 0 bypasses.
- `ShouldSuppressPush` — `notification.personal_preference`: DND window and
  `muted_domains`. **Suppression applies to push only; SSE is still delivered**, so the UI
  stays live while the phone stays quiet.

Call wakes never reach this code at all: the dispatcher is their sender and it does not
consult routing. That structural exemption, rather than a flag, is what makes a call ring
through do-not-disturb.

### Ephemeral signals

Priority 4 (`typing`, `reaction`) never touches the database. `RouteEphemeralSignal` looks
up connections whose `active_channel_id` matches and writes straight to their event
channels; if a connection's buffer is full the signal is dropped rather than blocking.

**Priority 4 is load-bearing here, not a label.** The publisher decides *whether* to skip
the DB write from `delivery_class = live_only` plus a non-empty `active_channel_id`, but
`publishToInstancesByChannel` decides *how to notify* from `priority == PrioritySilent`
alone. Set one without the other and the two halves disagree: the row is never inserted,
yet the listener is told to go and read it, finds nothing, logs `no notification
recipients found` and drops the signal. That is what silently swallowed reaction removals
until they were moved to priority 4 to match reaction additions. Any new live-only
channel signal must be priority 4.

## V2 resource subscriptions

Instead of every domain maintaining its own watcher list, notification owns follow state
per resource.

- `resource_domain IN ('task','document','channel','calendar_event')`
- `subscription_state IN ('active','unfollowed')` — `unfollowed` is an explicit opt-out
  that survives future auto-subscribe reasons
- `preference_level IN ('all','mentions','muted')`; direct-targeted events (mention,
  assignment) may still bypass `muted`
- `resource_subscription_reason` records *why*: `creator`, `reporter`, `assignee`,
  `manual_follow`, `commented`, `mentioned_auto`, `system` — so removing one reason does
  not unsubscribe someone who has another

`resource_surface` maps child surfaces onto their parent so that a comment in a task's
discussion channel notifies the task's subscribers: surface types `task_discussion`,
`task_description`, `document_comments`; surface domains `chat_channel`, `document`,
`document_comment_thread`; `inherits_subscription` defaults true.

RPCs: `GetResourceSubscription`, `SetResourceSubscriptionPreference`.

## Presence: the ping-pong protocol (feature 033)

Presence liveness is **client-attested only**. The server never refreshes a connection's
liveness on its own — that was the defect this protocol exists to remove.

Three constants, defined once in `internal/notification/constants.go` and mirrored in
`frontend/packages/apis/src/presence.ts` and `packages/notifications/src/types.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `PingIntervalSeconds` | 20 | how often the server challenges each open stream |
| `ResponsiveWindowSeconds` | 45 | max silence still counting as present and live-deliverable (two missed pings plus slack — one dropped pong must not demote a healthy connection) |
| `RemovalWindowSeconds` | 90 | when the janitor deletes the row (well past the responsive window, so a recovering client resumes without reconnecting) |

`active_connection.last_pong_at` is advanced **only** by a `PresencePong` RPC. Liveness is
derived, never stored as a status column — which is why every index on this write-hot
UNLOGGED table leads with `last_pong_at`.

`PresencePong` returns a `PongDirective`: `ACK` (carry on) or `RECONNECT` (the row is gone
— close the stream and re-establish; a late pong never resurrects a removed connection).

Pongs are coalesced by the **pong batcher** (`internal/notification/pong_batcher.go`),
which turns the pongs arriving at one instance into a single multi-row `UPDATE` per
organization per flush tick, drained on shutdown so no in-flight pong RPC hangs.

Presence statuses: `online`, `online_hidden`, `idle`, `offline`, `in_meeting`.

### Debugging presence

```sh
docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c \
  "select connection_id, employee_id, instance_id, presence_status, active_channel_id,
          now() - last_pong_at as silent_for
     from notification.active_connection"
```

If `silent_for` resets while a client is *not* answering, something server-side is
refreshing liveness — that is a regression of the exact defect 033 removed.

### Visibility

`notification.presence_visibility`: `everyone | departments | offline`, plus custom status
text and emoji. `departments` limits visibility to colleagues sharing a department —
resolved against the denormalised `active_connection.department_ids`.
`SetPresenceVisibility` / `GetPresenceSettings`; UI at `/workspace/settings/presence`.

## Push notifications

FCM via `firebase.google.com/go/messaging`. `notification.push_token` holds one row per
(employee, device, **token type**) with `permission_state`, endpoint, keys, user agent.
Registration upserts on `(organization_id, employee_id, device_identifier, token_type)`,
so both clients must send a *stable* identifier — mobile persists a UUID in `SecureStore`,
web in `localStorage`. A 24-hour cleanup worker prunes stale tokens. **When
`GOOGLE_APPLICATION_CREDENTIALS` is unset the FCM client is not created and push is
silently disabled** — the server logs a warning at startup and otherwise behaves normally.

`token_type` is a required field on `RegisterPushToken`, not a defaulted one: the call
wake dispatcher picks a transport from it, and a guessed type routes calls to a transport
that cannot reach the device — a phone that silently never rings.

| `token_type` | Carried by | Used for |
|---|---|---|
| `fcm` | every mobile device | routine notifications, and the Android call transport |
| `apns_voip` | iOS only | call wakes only, over the direct APNs connection |
| `web_push` | browsers | routine notifications |

An iOS device therefore holds **two rows under one `device_identifier`**, which is what
lets the dispatcher fan out per device rather than per token. `token_metadata` carries
`platform`, `deliveryProvider` and `nativeCallCapable`; a row with no recorded capability
is treated as not capable, because routing a device to a tier it cannot run means a phone
that never rings, while the reverse only costs the older ring.

The APNs VoIP credential (`APNS_VOIP_KEY_PATH`, `APNS_VOIP_KEY_ID`, `APNS_VOIP_TEAM_ID`,
`APNS_VOIP_TOPIC`, optional `APNS_VOIP_USE_SANDBOX`) follows the same posture as the
Firebase one: when it is unset the server starts, logs loudly, and every iOS device falls
to tier B. A *partially* configured credential is treated as a misconfiguration and fails
at startup rather than silently degrading.

Delivery only reads tokens with `is_valid = true`. A send rejected with
`registration-token-not-registered` (app uninstalled, token rotated) flips that token to
`is_valid = false` immediately, so a dead device stops costing an HTTPS round-trip on
every subsequent notification; re-registering via `RegisterPushToken` sets it back to
valid. A `mismatched-credential` rejection is treated as a *server* fault instead — FCM
returns that code both for a token from another Firebase project and for a service
account lacking `cloudmessaging.messages.create`, so the fan-out abandons the rest of the
batch, leaves every token valid, and `SendPushNotification` returns an error. The whole
per-employee fan-out also runs under a 10-second deadline because it happens inside the
caller's request transaction.

Payload guardrail (from `AGENTS.md`, and enforced by
`notification_frontend_parity_test.go`): every user-facing notification must carry
human-readable `title`/`message` **plus** route-critical `action_data` and
`navigation_target`, and mobile routing must branch on explicit `notification_type` rather
than inferring from loose IDs.

## Notification types

29 values, grouped: chat (`message`, `mention`, `reply`, `typing`, `reaction`), voice (4),
task (6), docs (3), ritual/evidence (4 — `evidence_submitted`, `evidence_approved`,
`evidence_rejected`, `ritual_instances_scheduled`), calendar (6), and
`account_removal_requested`. Source domains: `chat`, `crm`, `projects`, `hr`, `support`,
`finance`, `docs`, `system`, `calendar`.

`notification.AllNotificationTypes()` and the DB CHECK are one list in two places, and
`TestNotificationTypeCheckMatchesGoConstants` reads the constraint out of the live schema
and asserts they are equal. Before that guard the two had drifted by seven values, because
the contract test that was supposed to catch it iterated the Go list and validated it
against the Go validator.

`account_removal_requested` is published on `system` by `internal/compliance` when an
admin-provisioned worker asks to be removed from a workspace; it reaches that
workspace's owners. It is the one notification whose publish shares its caller's
transaction rather than being best-effort: a removal request nobody hears about is the
off-app dead end both app stores reject, so a failure to notify rolls the request back.
See [compliance-safety.md](compliance-safety.md).

Adding a type means changing four places in one PR (Constitution VIII): the DB CHECK (as a
migration), `internal/notification/constants.go`, the proto, and
`frontend/packages/apis/src/notification.ts` — plus the two `Record<NotificationType, …>`
maps in `frontend/packages/notifications/src/utils.ts`, which the union makes exhaustive.
Those maps are why the union matters beyond type-checking: a type missing from them falls
back to a generic bell icon and renders its **raw type string** as the label in the
notification centre, which is what every calendar, ritual and evidence notification did
while the union stopped at `doc_mentioned`.

## Client surfaces

- Web: `/workspace/notifications`, `/workspace/settings/notifications`,
  `/workspace/settings/presence`; SSE via `EventSource` against
  `/api/notifications/stream`.
- Mobile: `app/(app)/(notifications)/`, `hooks/use-sse.ts`, `use-presence.ts`,
  `use-app-state-presence.ts`, `use-push-notifications.ts`,
  `use-stream-recovery-refresh.ts`.
- Shared: `packages/notifications/` (`useSSEConnection`, `useNotifications`,
  `presenceState`), `packages/apis/src/notification.ts`, `presence.ts`, `push-tokens.ts`,
  `visibility.ts`, `notification-status.ts`.

## Tests

Sixteen files, the largest cluster in the suite: `notification_baseline_test.go`,
`notification_v2_*` (contract, delivery routing, direct target, document/task subscription,
subscription sync), `notification_delivery_consistency_test.go`,
`notification_routing_test.go`, `notification_stream_rules_test.go`,
`notification_frontend_parity_test.go`, `presence_ping_pong_test.go`,
`presence_pong_batching_test.go`, `presence_status_test.go`, `push_token_test.go`,
`stale_cleanup_test.go`.

## Known drift

**The clients listen for SSE event types the backend never sends.**
The server emits exactly three `EventType` values: `notification`, `ping` and
`connection_established`. Mobile subscribes to and branches on `chat_message` and
`chat_reaction` in `hooks/use-sse.ts` and three chat screens. Nothing breaks, because every
real event arrives as `notification` and the reaction branch has an
`event.notificationType === "reaction"` fallback beside the dead `type === "chat_reaction"`
check — but the vocabulary is fiction and reads as though a second event family exists.

**`muted_domains` omits `calendar`.** `notification.personal_preference.muted_domains` has
`CHECK (muted_domains <@ ARRAY['chat','projects','docs','crm','hr','support','finance','system'])`
— no `calendar`, although `calendar` is a valid `source_domain` and calendar publishes six
notification types. Calendar notifications cannot currently be domain-muted.
