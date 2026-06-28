# tech-office Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-05-10

## Active Technologies
- TypeScript 5.9.x for frontend implementation; Go 1.25.x for any supporting backend read contracts + Next.js 15.5.2, React 19.1, MUI 7.3.2, TanStack React Query 5.x, Connect RPC API packages, PostgreSQL/Citus, sqlc (031-context-rail-redesign)
- Existing PostgreSQL/Citus tenant data for calendar, chat, collaboration, IAM, and notification summaries; browser session persistence for rail open or closed state (031-context-rail-redesign)
- Go 1.25.0 backend; TypeScript 5; Next.js 15.5.2/React 19 web; Expo 55/React Native 0.83 mobile + Connect RPC, protobuf, sqlc/pgx, PostgreSQL/Citus, existing notification SSE and files/R2 services, LiveKit Server and LiveKit server SDK/token APIs with LiveKit built-in TURN over TLS, `livekit-client` for web, LiveKit React Native client modules for mobile, MediaRecorder/Web Audio on web, Expo audio recording module for mobile voice messages (032-voice-communication-support)
- PostgreSQL/Citus tenant tables in a new `voice` schema plus small `chat.message` metadata extensions; R2/object storage through existing file metadata for voice-message audio, call recordings, and transcripts; Redis only for LiveKit distributed coordination if multi-node LiveKit is enabled (032-voice-communication-support)

- Go 1.25.0 backend; TypeScript 5.9.x frontend; React 19; Next.js 15.5.2 web; Expo SDK 55 / Expo Router 55 / React Native 0.83.4 mobile + Connect RPC, sqlc, PostgreSQL/Citus, Next.js, Expo Router, expo-linking, Playwright, Maestro (030-ritual-ux-redesign)

## Project Structure

```text
backend/
frontend/
tests/
```

## Commands

npm test && npm run lint

## Code Style

Go 1.25.0 backend; TypeScript 5.9.x frontend; React 19; Next.js 15.5.2 web; Expo SDK 55 / Expo Router 55 / React Native 0.83.4 mobile: Follow standard conventions

## Recent Changes
- 032-voice-communication-support: Added Go 1.25.0 backend; TypeScript 5; Next.js 15.5.2/React 19 web; Expo 55/React Native 0.83 mobile + Connect RPC, protobuf, sqlc/pgx, PostgreSQL/Citus, existing notification SSE and files/R2 services, LiveKit Server and LiveKit server SDK/token APIs with LiveKit built-in TURN over TLS, `livekit-client` for web, LiveKit React Native client modules for mobile, MediaRecorder/Web Audio on web, Expo audio recording module for mobile voice messages
- 031-context-rail-redesign: Added TypeScript 5.9.x for frontend implementation; Go 1.25.x for any supporting backend read contracts + Next.js 15.5.2, React 19.1, MUI 7.3.2, TanStack React Query 5.x, Connect RPC API packages, PostgreSQL/Citus, sqlc

- 030-ritual-ux-redesign: Added Go 1.25.0 backend; TypeScript 5.9.x frontend; React 19; Next.js 15.5.2 web; Expo SDK 55 / Expo Router 55 / React Native 0.83.4 mobile + Connect RPC, sqlc, PostgreSQL/Citus, Next.js, Expo Router, expo-linking, Playwright, Maestro

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
