# Contract: `TourService`

`backend/rpc/v1/tour.proto`. Two RPCs, both authenticated, both inferring employee and
organization from the auth context — no ids in the request, per Constitution I.

## `GetTour`

Returns the tour this caller should see, already selected, filtered and platform-adapted,
together with their progress and whether it should be offered.

```protobuf
service TourService {
  rpc GetTour(GetTourRequest) returns (GetTourResponse) {
    option (rpc.v1.access_control) = { required_permissions: ["tour.view"] };
  }

  rpc UpdateTourProgress(UpdateTourProgressRequest) returns (UpdateTourProgressResponse) {
    option (rpc.v1.access_control) = { required_permissions: ["tour.update"] };
  }
}

enum TourPlatform {
  TOUR_PLATFORM_UNSPECIFIED = 0;
  TOUR_PLATFORM_WEB = 1;
  TOUR_PLATFORM_MOBILE = 2;
}

enum TourAudience {
  TOUR_AUDIENCE_UNSPECIFIED = 0;
  TOUR_AUDIENCE_ADMINISTRATOR = 1;
  TOUR_AUDIENCE_WORKER = 2;
}

enum TourStatus {
  TOUR_STATUS_UNSPECIFIED = 0;
  TOUR_STATUS_NOT_STARTED = 1;   // no stored row
  TOUR_STATUS_IN_PROGRESS = 2;
  TOUR_STATUS_COMPLETED = 3;
  TOUR_STATUS_DISMISSED = 4;
}

// The surface a stop points at. Each client maps this to its own route; a client MUST
// handle every value, enforced by a test on both clients (Constitution VIII).
enum TourTarget {
  TOUR_TARGET_UNSPECIFIED = 0;
  TOUR_TARGET_NONE = 1;        // no action button — used for web-only stops shown on mobile
  TOUR_TARGET_PEOPLE = 2;
  TOUR_TARGET_PROJECTS = 3;
  TOUR_TARGET_RITUALS = 4;
  TOUR_TARGET_CHAT = 5;
  TOUR_TARGET_CALENDAR = 6;
  TOUR_TARGET_DOCS = 7;
  TOUR_TARGET_TODAY = 8;
  TOUR_TARGET_ALERTS = 9;
  TOUR_TARGET_SEARCH = 10;
}

message TourStop {
  string key = 1;            // stable id, also the client testID suffix
  string title = 2;
  string body = 3;           // already substituted for platform
  string action_label = 4;   // empty when target is TOUR_TARGET_NONE
  TourTarget target = 5;
}

message GetTourRequest {
  TourPlatform platform = 1; // required; UNSPECIFIED is rejected
}

message GetTourResponse {
  TourAudience audience = 1;
  string tour_id = 2;             // "administrator" | "worker"
  string content_version = 3;
  repeated TourStop stops = 4;    // already filtered and adapted; may be shorter than the definition
  TourStatus status = 5;
  int32 current_stop = 6;         // index into `stops`; 0 when not started
  bool should_offer = 7;          // true only when status is NOT_STARTED or IN_PROGRESS
}

message UpdateTourProgressRequest {
  TourStatus status = 1;   // IN_PROGRESS, COMPLETED or DISMISSED; NOT_STARTED is rejected
  int32 current_stop = 2;  // ignored unless status is IN_PROGRESS
}

message UpdateTourProgressResponse {
  TourStatus status = 1;
  int32 current_stop = 2;
}
```

## Behaviour

**Audience selection** — `iam.inviteUser` present in the caller's context permission set
selects `ADMINISTRATOR`; otherwise `WORKER`. The caller cannot ask for the other tour; there
is no audience field on the request. (FR-002)

**Stop filtering** — stops whose `required_permission` is absent from the caller's permission
set are omitted entirely, not disabled. The response's `stops` is the authoritative list and
`current_stop` indexes it. (FR-006)

**Platform adaptation** — for `TOUR_PLATFORM_MOBILE`, a stop marked web-only has its body
replaced by the "this is done on the web" note and its target forced to `TOUR_TARGET_NONE`
with an empty `action_label`, so no client can render an action that cannot work. (FR-023)

**`current_stop` is clamped on read.** The stored index addresses the *filtered* list, and
filtering depends on permissions, which can change between one call and the next. Revoking a
permission shortens the list and can leave the stored index past its end. `GetTour` therefore
returns `min(stored_current_stop, len(stops) - 1)`, clamped to `0` when the list is empty, so
a client can always render `stops[current_stop]`. The stored value is left alone — the clamp
is applied to the response, not written back, because the permission may be restored. A
`COMPLETED` tour is exempt: it reports `current_stop = len(stops)` as normal. (FR-015a)

**`should_offer`** — true when the stored status is `NOT_STARTED` or `IN_PROGRESS`; false for
`COMPLETED` and `DISMISSED`. This is the whole of the automatic-offer rule and it lives here
so it is stated once rather than in each client. It is deliberately independent of platform,
which is what makes FR-024 hold: a tour completed on web is not offered on mobile. (FR-007,
FR-024)

**`UpdateTourProgress` is an upsert** on `(organization_id, employee_id, tour_id)`, with the
tour id derived from the caller's audience — not sent by the client, so a caller cannot write
progress for a tour they are not being served. Repeating a write is a no-op beyond
`updated_at`. Restarting is `status = IN_PROGRESS, current_stop = 0`. (FR-010, FR-014, FR-017)

## Errors

Standard Connect codes; no domain error details are needed.

| Condition | Code |
|---|---|
| no auth context | `unauthenticated` |
| missing `tour.view` / `tour.update` | `permission_denied` (from the interceptor) |
| `platform` unspecified on `GetTour` | `invalid_argument` |
| `status` unspecified or `NOT_STARTED` on `UpdateTourProgress` | `invalid_argument` |
| `current_stop` negative, or greater than `len(stops)` for the caller's filtered tour | `invalid_argument` |

## What the clients own

Three behaviours are deliberately not in this contract, because only the client knows them:

- **When to show the offer.** The server says whether it *should* be offered; the client
  decides the moment — after the terms gate and any mandatory credential step, never while a
  deep-link redirect is pending, and never before the workspace has painted. (FR-008, FR-013)
- **Reopening after an action.** Acting on a stop closes the tour and navigates. The client
  reopens it at the same stop the next time the person lands on the surface the tour is
  offered from. No progress write is needed for this — the stored `current_stop` already says
  where to resume. (FR-012)
- **Route resolution.** `TourTarget` → a platform route, and for FR-013a the route must land
  where the thing is created, not on an empty list.

## Client wrapper

`frontend/packages/apis/src/tour.ts` exposes `getTour(platform)` and
`updateTourProgress(status, currentStop)` with the enums converted to string unions, matching
the conversion style already used in `preference.ts`. No client calls the generated stub
directly (Constitution VII).
