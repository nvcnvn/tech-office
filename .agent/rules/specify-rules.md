# tech-office Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-20

## Active Technologies
- Go 1.23 (backend), TypeScript / React 19 / Next.js 15 (frontend) + Connect-RPC (protobuf + buf), sqlc, forward-only `psql` migration runner (`backend/scripts/migrate.sh`), `github.com/nvcnvn/flows` v0.0.7 (reminder scheduling), pgx v5 (PostgreSQL driver), pnpm monorepo (026-calendar-system)
- PostgreSQL 18 + Citus (distributed, `calendar` schema — 12 new tables), Cloudflare R2 (evidence file uploads via existing `files` domain) (026-calendar-system)
- Go 1.23 (backend), TypeScript/React (frontend) + `github.com/teambition/rrule-go` (RFC 5545 recurrence), `github.com/nvcnvn/flows` (background workflow scheduling), ConnectRPC + Protobuf, sqlc, pgx/v5 (PostgreSQL) (026-calendar-system)
- PostgreSQL with Citus sharding — new `calendar` schema; migrations under `backend/k8s/base/database/migrations/` (026-calendar-system)
- TypeScript 5.8 / React Native 0.79 / Expo SDK 53 + Expo Router 5, React Query 5, `react-native-sse`, `@expo/ui` (to be installed), `date-fns` 3 (027-mobile-chat-notifications)
- React Query in-memory cache (no persistent storage; all server state) (027-mobile-chat-notifications)
- TypeScript 5.x, React 19, Next.js 15.5, Expo 55 / React Native 0.83, Go 1.25.0 + MUI 7, TanStack React Query 5, Expo Router, ConnectRPC, sqlc, Playwright, Maestro (028-ritual-submission-flow)
- PostgreSQL 18 + Citus, existing files storage/upload pipeline for evidence attachments (028-ritual-submission-flow)
- TypeScript 5.x, React 19, Next.js 15.5.2, Expo 55 / React Native 0.83.4, Go 1.25.0 + MUI 7, TanStack React Query 5, Expo Router, ConnectRPC, sqlc, Playwright, Maestro (029-ritual-ux-redesign)
- PostgreSQL 18 + Citus, existing collaboration/ritual/evidence tables, existing notification routing state (029-ritual-ux-redesign)

- (025-departments-org-chart)

## Project Structure

```text
src/
tests/
```

## Commands

# Add commands for 

## Code Style

: Follow standard conventions

## Recent Changes
- 029-ritual-ux-redesign: Added TypeScript 5.x, React 19, Next.js 15.5.2, Expo 55 / React Native 0.83.4, Go 1.25.0 + MUI 7, TanStack React Query 5, Expo Router, ConnectRPC, sqlc, Playwright, Maestro
- 028-ritual-submission-flow: Added TypeScript 5.x, React 19, Next.js 15.5, Expo 55 / React Native 0.83, Go 1.25.0 + MUI 7, TanStack React Query 5, Expo Router, ConnectRPC, sqlc, Playwright, Maestro
- 027-mobile-chat-notifications: Added TypeScript 5.8 / React Native 0.79 / Expo SDK 53 + Expo Router 5, React Query 5, `react-native-sse`, `@expo/ui` (to be installed), `date-fns` 3


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
