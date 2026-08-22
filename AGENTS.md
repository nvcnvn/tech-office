# Project Constitution & Governance  - MUST ALWAYS FOLLOW
- **[`.specify/memory/constitution.md`](./.specify/memory/constitution.md)** - Core principles, technical stack, operational constraints, and governance

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