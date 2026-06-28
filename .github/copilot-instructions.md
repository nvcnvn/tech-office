# Project Constitution & Governance  - MUST ALWAYS FOLLOW
- **[`.specify/memory/constitution.md`](../.specify/memory/constitution.md)** - Core principles, technical stack, operational constraints, and governance

# Debugging Instructions
- Check [backend/database/scripts/schema.sql](../backend/database/scripts/schema.sql) for the latest database schema.
- Use docker for checking local data:
```sh
docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c "select * from notification.active_connection"
```

# Notification Payload & Routing Guardrail
- When adding or changing notification types, update the backend payload contract and mobile route resolver together. Backend notifications must include human-readable title/message text plus route-critical `actionData` and `NavigationTarget` fields; mobile routing should branch by explicit `notificationType` for special cases instead of inferring from loose IDs.
- Add or update integration tests that assert notification title/message, route-critical payload fields, and `NavigationTarget` for user-facing notification types.

# UUID
Use internal package `dbuuid` for UUID operations instead of `github.com/google/uuid` directly. This ensures consistent handling of UUIDs and NullUUIDs across the codebase.
- Import path: `github.com/nvcnvn/tech-office/backend/database/dbuuid`
- Generating new UUID: use `dbuuid.Must()`
- Parsing UUID from string: use `dbuuid.Parse()`
- Converting `dbuuid.UUID` to `dbuuid.NullUUID`: use `dbuuid.UUIDToNullUUID()`
- Converting `dbuuid.NullUUID` to `dbuuid.UUID`: use `dbuuid.NullUUIDToUUID()`
- For pointer conversions, handle nil checks appropriately before conversion.
