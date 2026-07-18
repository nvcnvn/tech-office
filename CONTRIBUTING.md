# Contributing to TechOffice

Thanks for your interest in contributing! This guide covers the workflow and the ground rules. For architecture, tech stack, and the local development quickstart, see the [README](README.md).

## Ground rules

1. **Read the constitution.** [.specify/memory/constitution.md](.specify/memory/constitution.md) is the binding rulebook for this project — multi-tenancy rules, testing requirements, and service architecture are enforced in review. The [README's Design Principles section](README.md#design-principles) is the short version.
2. **Spec-driven workflow.** Non-trivial features start with a spec in [specs/](specs/) and test scenario stubs that act as the behavioral contract *before* implementation. Small fixes can go straight to a PR.
3. **Tests are the definition of done.**
   - Backend changes need integration tests in `backend/integration/` (no unit tests mocking internals).
   - User-facing web changes need Playwright E2E tests in `frontend/apps/web/e2e/`.
   - Mobile UI changes need a Maestro flow in `frontend/apps/mobile/.maestro/`.
   - The **full** suites must pass (`make test`), not just your new tests — existing tests are regression guards.

## Making changes

### Database schema changes

All in the same PR:

1. Update the authoritative schema first: `backend/database/scripts/schema.sql`.
2. Add a timestamped, forward-only migration under `backend/k8s/base/database/migrations/` (`YYYYMMDDHHMMSS_description.up.sql`), validated with `cd backend && ./scripts/migrate.sh`.
3. Regenerate `sqlc` code.

Remember the Citus constraints: every tenant table carries `organization_id`, all unique indexes and primary keys lead with it, composite foreign keys only, no triggers, no `now()` in `ON CONFLICT DO UPDATE`.

### API changes

1. Define or change the contract in `backend/rpc/v1/*.proto` — every RPC must declare `allowed_roles` in its `access_control` option.
2. Regenerate Go and TypeScript clients with `buf generate` (TypeScript lands in `frontend/packages/rpc`).
3. Expose the call to apps through a typed wrapper in `frontend/packages/apis` — apps never import protobuf types directly.

### Frontend conventions

- All interactive elements need `data-testid` attributes.
- All colors come from the theme system (`useThemeColors()`) — no hardcoded values.
- Shared string constants must be named constants matching the backend exactly; literals where a constant exists are treated as bugs.

## Before you push

```sh
make check-tracked-files        # no large/binary files tracked in git
cd frontend && pnpm lint        # for frontend changes
cd frontend && pnpm typecheck:mobile   # for mobile changes
make test                       # backend + web E2E suites
```

## Pull requests

- Keep schema, migrations, generated code, and tests together in one PR.
- Schema/API changes need a migration plan; tenant-isolation changes get a security-focused review of `organization_id` filters.
- Not sure where to start? Issues and the [Roadmap](README.md#roadmap) are good entry points — or open a discussion first for bigger ideas.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
