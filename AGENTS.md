# Project Constitution & Governance  - MUST ALWAYS FOLLOW
- **[`.specify/memory/constitution.md`](./.specify/memory/constitution.md)** - Core principles, technical stack, operational constraints, and governance

# Domain Snapshots - READ BEFORE CHANGING BEHAVIOUR
- **[`docs/domain/`](./docs/domain/)** is the source of truth for how the system behaves
  **today**, one document per domain plus a `README.md` index and drift register.
- `specs/NNN-*` records historical **intent** only. Specs are incremental and some are
  stale (024 is titled "passkey" but shipped as PIN). Never reconstruct current behaviour
  by reading specs in sequence — read the domain snapshot, then verify against the code.
- Where a spec and the code disagree, **the code wins** and the disagreement belongs in the
  drift register in [`docs/domain/README.md`](./docs/domain/README.md).
- **Updating the snapshot is part of the Definition of Done** (Constitution principle XII),
  not a follow-up task. Any change that alters an RPC surface, a database constraint, a
  background job cadence, or a cross-domain call MUST update the affected domain document
  in the same change set, after the integration suite passes.
- Delete superseded behaviour rather than annotating it. These documents describe the
  present tense; they are not a changelog.

# Debugging Instructions
- Check [backend/database/scripts/schema.sql](./backend/database/scripts/schema.sql) for the latest database schema.
- Use docker for checking local data:
```sh
docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c \
  "select connection_id, employee_id, instance_id, presence_status, active_channel_id,
          now() - last_pong_at as silent_for
     from notification.active_connection"
```

`last_pong_at` is advanced only by a client answering a presence ping. If `silent_for`
resets while a client is not answering, something server-side is refreshing liveness —
that is the defect the ping-pong protocol exists to prevent. A connection is a
live-delivery target only while `silent_for <= 45s`, and the janitor deletes it at 90s.

# Notification Payload & Routing Guardrail
- When adding or changing notification types, update the backend payload contract and mobile route resolver together. Backend notifications must include human-readable title/message text plus route-critical `actionData` and `NavigationTarget` fields; mobile routing should branch by explicit `notificationType` for special cases instead of inferring from loose IDs.
- Add or update integration tests that assert notification title/message, route-critical payload fields, and `NavigationTarget` for user-facing notification types.