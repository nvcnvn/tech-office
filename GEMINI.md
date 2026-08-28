# Project Constitution & Governance  - MUST ALWAYS FOLLOW
- **[`.specify/memory/constitution.md`](./.specify/memory/constitution.md)** - Core principles, technical stack, operational constraints, and governance

# Debugging Instructions
- Check [backend/database/scripts/schema.sql](./backend/database/scripts/schema.sql) for the latest database schema.
  It is generated from [backend/database/migrations/](./backend/database/migrations/) — read it freely, never edit it.
  To change the schema, add a forward-only `.up.sql` migration and run `backend/scripts/regen-schema.sh`, then `sqlc generate`.
- Use docker for checking local data:
```sh
docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c "select * from notification.active_connection"
```