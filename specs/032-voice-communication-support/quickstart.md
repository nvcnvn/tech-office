# Quickstart: Voice Communication Support

This quickstart describes the expected local workflow after implementation tasks are completed.

## 1. Configure Local Media Infrastructure

Add local development secrets in the existing backend environment mechanism:

```sh
LIVEKIT_URL=ws://localhost:7880
PUBLIC_LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecretdevsecretdevsecretdevsecret
LIVEKIT_WEBHOOK_URL=http://backend:8080/api/livekit/webhook
VOICE_RECORDING_ENABLED=true
VOICE_RECORDING_BUCKET=<existing-r2-bucket>
VOICE_RECORDING_ENDPOINT=<r2-or-s3-endpoint>
VOICE_RECORDING_REGION=auto
VOICE_RECORDING_ACCESS_KEY_ID=<access-key-id>
VOICE_RECORDING_SECRET_ACCESS_KEY=<secret-access-key>
VOICE_RECORDING_FORCE_PATH_STYLE=true
VOICE_RECORDING_PREFIX=voice-recordings
VOICE_MAX_PARTICIPANTS=25
```

Local Docker Compose includes a LiveKit service with:

- `7880/tcp` for HTTP/WebSocket signaling and API
- `7881/tcp` for TCP RTC fallback
- `50000-50100/udp` for UDP RTC media
- `5349/tcp` for LiveKit built-in TURN over TLS

SSE remains the discovery path. LiveKit owns WebRTC signaling, ICE server discovery, and TURN-over-TLS connectivity.

## 2. Generate Backend Code

From the repository root:

```sh
cd backend
buf generate
sqlc generate
```

Run the forward-only migration workflow from the backend scripts after the migration file is added:

```sh
./scripts/migrate.sh
```

## 3. Start Services

From the repository root, start infrastructure and backend services using the repo's helper targets:

```sh
make voice-dev-infra-up
make voice-dev-backend
```

The helper automatically exports a consistent local voice env before `docker compose up` and `go run ./cmd`:

```sh
make voice-dev-print-env
```

For same-machine browser testing, the helper defaults to `TECH_OFFICE_HOST_IP=127.0.0.1`. For physical devices, run both commands with your LAN IP so the backend returns a reachable LiveKit URL:

```sh
TECH_OFFICE_HOST_IP=192.168.1.178 make voice-dev-infra-up
TECH_OFFICE_HOST_IP=192.168.1.178 make voice-dev-backend
```

## 4. Start Frontend Clients

Web:

```sh
pnpm --dir frontend --filter web dev
```

Mobile:

```sh
pnpm --dir frontend --filter mobile start
```

Use an Expo development client because LiveKit React Native and microphone capture require native modules.

## 5. Manual Smoke Flow

1. Sign in as two employees in the same organization.
2. Open the same direct message, channel, or task chat on both clients.
3. Start a voice call from employee A.
4. Verify employee B receives the high-priority incoming-call surface through SSE/push notification handling.
5. Join from employee B and confirm the call uses a single active session.
6. Leave from one participant and verify the call stays active for the other.
7. Leave from the final participant and verify the active indicator clears.
8. Verify the room shows a completed call record with participants and timing.
9. Record and send a voice message; verify playback, sender, timestamp, and retry/cancel behavior.

## 6. Required Verification

Constrained-network voice smoke:

- [ ] Run a 10-minute two-participant voice call on a cellular or network-shaped connection with at least one mobile client.
- [ ] Confirm both participants remain connected or recover automatically after a brief network transition.
- [ ] Confirm speech remains intelligible in both directions for ordinary workplace conversation.
- [ ] Confirm the UI shows a degraded-quality affordance when packet loss, relay-only ICE, or poor connection stats are simulated.
- [ ] Confirm final leave clears the active call indicator within 5 seconds.
- [ ] Capture the LiveKit room name, client platform, network profile, and any relay/TURN configuration used for the run.

Backend integration:

```sh
cd backend
go test -v -count=1 -timeout 180s -run 'TestVoiceCommunicationLifecycle|TestVoiceMessageUploadLifecycle|TestVoiceConstantSync' ./integration
```

Web E2E:

```sh
pnpm --dir frontend --filter web exec playwright test --config=e2e/playwright.config.ts e2e/voice-communication.spec.ts
```

Mobile typecheck:

```sh
pnpm --dir frontend exec tsc -p apps/mobile/tsconfig.json --noEmit
```

Mobile blackbox suite:

```sh
cd frontend/apps/mobile
/opt/homebrew/Cellar/maestro/2.3.0/libexec/bin/maestro test $(grep -v '^#' .maestro/.env | grep '=' | sed 's/^/-e /' | tr '\n' ' ') .maestro/voice-communication.yaml
```

## 7. Documentation Update

After implementation and passing tests, add or update:

```text
backend/docs/VOICE-COMMUNICATION-ARCHITECTURE.md
backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md
```

The docs should describe the VoiceService, LiveKit integration, SSE discovery events, LiveKit TURN-over-TLS networking, artifact processing, and operational runbooks for failed webhooks or stale active calls.