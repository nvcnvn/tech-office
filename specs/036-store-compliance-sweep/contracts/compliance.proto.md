# Contract: `rpc/v1/compliance.proto`

New `ComplianceService`, 11 RPCs. Every RPC carries `rpc.v1.access_control` per Principle III.
`organization_id` never appears in a user-facing request message (Principle I) — it comes from
the auth context via the interceptor.

Message shapes are given as field lists rather than literal proto so this stays a contract
rather than a copy of the implementation.

---

## Reporting

### `ReportContent` — `compliance.reportContent`

Files a report. FR-014, FR-015, FR-016.

**Request**: `target_kind` (enum), `target_id`, `reason` (enum), `note` (optional).

**Response**: `report_id`, `created_at`.

The server resolves the reported author and takes the content snapshot itself by calling the
owning domain's service — the client does not supply either, so a client cannot forge who
authored what. Returns `already_exists` if this reporter has an outstanding report against the
same target.

### `ListReports` — `compliance.reviewReports`

The review queue. FR-017. Web-only surface (Constitution XIII).

**Request**: `status_filter` (optional enum), `cursor` (optional — UUID v7, nullable per
Principle IX), `limit`.

**Response**: repeated report summary, `next_cursor`.

Each summary carries reporter and reported display names, `target_kind`, the reason, the
snapshot, `status` and timestamps.

### `GetReport` — `compliance.reviewReports`

One report in full, including a deep link to the live content when it still exists.

### `ResolveReport` — `compliance.reviewReports`

Records an outcome. FR-017, FR-018.

**Request**: `report_id`, `outcome` (`actioned` | `dismissed`), `outcome_note` (required).

Rejects an empty note, and rejects resolving an already-resolved report.

---

## Blocking

### `BlockPerson` — `compliance.blockPerson`

FR-019, FR-020, FR-022.

**Request**: `employee_id`.

**Response**: `block_id`, `created_at`.

Emits no notification of any kind — the absence is the requirement, and the integration test
asserts it.

### `UnblockPerson` — `compliance.blockPerson`

FR-019. Idempotent: unblocking someone who is not blocked succeeds.

### `ListBlockedPeople` — `compliance.blockPerson`

FR-024. Returns the caller's own block list only; there is no RPC that reveals who has blocked
a given person, which is what keeps FR-022 true at the API layer rather than only in the UI.

---

## Removal requests

### `GetAccountRemovalPath` — authenticated, no additional permission

FR-007b. Tells the client which path this person gets, so mobile can render the right screen
without inferring it.

**Response**: `path` (`self_delete` | `request_removal`), `managing_organization_name`
(populated for `request_removal`), `outstanding_request` (optional, if one already exists).

### `RequestAccountRemoval` — authenticated, no additional permission

FR-007c. Creates the request and notifies the organization's owners through the existing
notification domain. Returns the existing request if one is already outstanding rather than
erroring.

### `ListRemovalRequests` — `compliance.manageRemovalRequests`

FR-007d. Web-only.

### `DecideRemovalRequest` — `compliance.manageRemovalRequests`

FR-007d. `grant` ends the membership and, when it was the person's last, enqueues the global
purge. `decline` is terminal for that request.

---

## Authorization summary

| Permission | Default roles | Surfaces |
|---|---|---|
| `compliance.reportContent` | all, including Employee | mobile + web |
| `compliance.blockPerson` | all, including Employee | mobile + web |
| `compliance.reviewReports` | Owner, Operator | web only |
| `compliance.manageRemovalRequests` | Owner, Operator | web only |

`GetAccountRemovalPath` and `RequestAccountRemoval` require authentication but no permission:
every person must be able to reach their own removal path regardless of how few permissions
their role carries.
