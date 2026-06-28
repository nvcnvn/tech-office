# Production Day-1 Checklist

Use this list for the first production backend, web, and mobile-ready deployment. It is intentionally strict and excludes optional follow-up work such as public mobile store release, SES email, call recording, and transcription.

## Final production endpoints

- [ ] `transformar.work` serves the web UI over HTTPS.
- [ ] `transformar.api.devguards.com` is proxied to `2604:2dc0:205:dd00::11` for backend HTTPS/RPC traffic.
- [ ] `transformar.media.devguards.com` is proxied to `2604:2dc0:205:dd00::11` for LiveKit HTTPS/WebSocket signaling.
- [ ] `transformar-turn.media.devguards.com` is DNS-only to `15.204.101.221` for TURN/UDP and any non-HTTP media edge traffic.
- [ ] Cloudflare proxy mode is correct for each hostname: `transformar.api.devguards.com` and `transformar.media.devguards.com` can be proxied, while `transformar-turn.media.devguards.com` stays DNS-only unless Spectrum or another L4 proxy is configured.

## Required before first deploy

- [ ] A single release tag has been chosen for all release artifacts, for example `RELEASE_TAG=$(date -u +%Y%m%d%H%M%S)`.
- [ ] Real production images for the backend and web app exist in your registry. This repo includes `backend/Dockerfile`, `frontend/Dockerfile`, and the `make prod-build` / `make prod-publish` paths.
- [ ] The web image was built with `NEXT_PUBLIC_BASE_URL=https://transformar.work`, `NEXT_PUBLIC_API_URL=https://transformar.api.devguards.com`, and `NEXT_PUBLIC_API_BASE_URL=https://transformar.api.devguards.com`.
- [ ] **Google SSO**: A Google OAuth 2.0 Web Client ID has been created in [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials. The client is configured with:
  - **Authorized JavaScript origins** (no trailing slash):
    - `https://transformar.work`
    - `http://localhost:13000` *(dev only — remove or leave; it is harmless in prod)*
  - **Authorized redirect URIs**: not required for the GIS credential flow (`GoogleLogin` component) — leave empty unless you add an auth-code flow later.
  - Pass the Client ID to the web image build as `PROD_GOOGLE_CLIENT_ID=<id>.apps.googleusercontent.com`.
- [ ] **Apple SSO**: A Services ID (e.g. `work.transformar.web`) has been created in [Apple Developer](https://developer.apple.com/account/resources/identifiers/list/serviceId) with Sign in with Apple enabled and configured with:
  - **Domains and Subdomains**: `transformar.work`
  - **Return URLs**: `https://transformar.work/signin`
  - *(For local dev only add `localhost` as domain and `http://localhost:13000/signin` as return URL — Apple requires HTTPS in production but allows localhost for testing.)*
  - Pass it to the web image build as `PROD_APPLE_CLIENT_ID=work.transformar.web`.
- [ ] **Backend SSO audience validation**: `GOOGLE_CLIENT_IDS` is set to a comma-separated list of all OAuth Client IDs (web, iOS, Android) that the backend should accept in Google id_tokens. `APPLE_CLIENT_IDS` is set to the Apple Service ID(s) and app bundle ID(s). These are **runtime** env vars for the backend pod — without them the backend logs a warning and skips audience validation, which is insecure in production.
- [ ] The mobile production build environment includes `EXPO_PUBLIC_API_URL=https://transformar.api.devguards.com` and `EXPO_PUBLIC_WEB_URL=https://transformar.work`. `frontend/apps/mobile/eas.json` now sets these for the production profile.
- [ ] The mobile native app-link trust points at `transformar.work`: iOS associated domains include `applinks:transformar.work`, Android intent filters include `https://transformar.work/o/`, and the app is signed with keys matching the association files.
- [ ] `https://transformar.work/.well-known/apple-app-site-association` and `https://transformar.work/.well-known/assetlinks.json` are served without auth, redirects, or HTML fallbacks.
- [ ] The production Kubernetes namespace exists or will be created from `backend/k8s/overlays/prod/namespace.yaml`.
- [ ] The production database is provisioned separately, for example via StackGres, and exposes the required extensions from `backend/database/scripts/schema.sql`, including `citus` and `pgroonga`.
- [ ] `DATABASE_URL` points at the external production coordinator endpoint and uses production TLS and credentials.
- [ ] `JWT_PRIVATE_KEY_PATH` points at a mounted production signing key. Do not allow the backend to fall back to the ephemeral dev signer.
- [ ] `WEBAPP_URL=https://transformar.work`. This value is used for IAM email links and must match the public web host.
- [ ] `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, and `R2_ENDPOINT` are set to the real production bucket. The current backend startup path requires R2 configuration.
- [ ] Every `localhost`, `192.168.x.x`, and `.dev-keys` value from local development has been removed from the production environment.
- [ ] `LIVEKIT_URL=ws://livekit.tech-office-prod.svc.cluster.local:7880` or another internal LiveKit service URL, and `PUBLIC_LIVEKIT_URL=wss://transformar.media.devguards.com`. The current server initializes the voice service on startup and should not ship with dev defaults.
- [ ] `livekit-secrets` contains `LIVEKIT_KEYS` with the real production key mapping and, when used, `LIVEKIT_WEBHOOK_URL=https://transformar.api.devguards.com/api/livekit/webhook`. The backend now derives its LiveKit API key pair from that shared secret unless you intentionally override it with explicit `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` env vars.
- [ ] Gateway API is installed and the prod `public-gateway` listeners are accepted for `transformar.api.devguards.com:443` and `transformar.media.devguards.com:443`.
- [ ] The TLS secrets referenced by `backend/k8s/overlays/prod/gateway.yaml` exist in the prod namespace, or the listener certificate references have been updated to the real secret names.
- [ ] `PUBLIC_LIVEKIT_URL` resolves `transformar.media.devguards.com` to the Gateway address on `443/tcp`, and `transformar-turn.media.devguards.com` resolves to the dedicated TURN/TLS or UDP media edge.
- [ ] OVH edge firewall and the Kubernetes node path allow `5000-6000/udp` directly to the LiveKit nodes for RTC media.
- [ ] If production clients must relay TURN traffic to private, VPN, or internal peer addresses, `backend/k8s/base/livekit/configmap.yaml` includes the required `turn.allow_restricted_peer_cidrs` entries. Otherwise, keep the LiveKit 1.12 default deny behavior.
- [ ] `backend-secrets`, `jwt-signing-key`, and `livekit-secrets` exist in the cluster before applying the backend Deployment.

## First deployment steps

- [ ] Run `make prod-print-env` and confirm the release tag plus public URLs are correct.
- [ ] Build backend and web with the same tag: `make prod-build RELEASE_TAG=<timestamp> BACKEND_IMAGE=<registry>/tech-office-backend WEB_IMAGE=<registry>/tech-office-web`.
- [ ] Push backend and web images: `make prod-publish RELEASE_TAG=<timestamp> BACKEND_IMAGE=<registry>/tech-office-backend WEB_IMAGE=<registry>/tech-office-web`, or push the images manually after `make prod-build`.
- [ ] Update `backend/k8s/overlays/prod/kustomization.yaml` to reference the pushed backend image tag. Apply the equivalent image/tag update in the web deployment system.
- [ ] For a mobile production build, run `make prod-build-mobile RELEASE_TAG=<timestamp>` after EAS credentials and signing are ready. Mobile packaging/submission can be handled separately from Day-1 backend/web deployment.
- [ ] Fill and apply `backend/k8s/overlays/prod/secrets.example.yaml`, or provision equivalent runtime secrets such as the shared `livekit-secrets`, before applying the prod overlay.
- [ ] Apply the prod overlay. It now includes the backend app plus the required in-cluster runtime services from this repo.
- [ ] Run `backend/scripts/migrate.sh up` against the externally managed production database.
- [ ] Confirm the backend pods become Ready and `/healthz` returns `200`.
- [ ] Deploy the web image behind `https://transformar.work` and confirm it serves `/.well-known/*` static files directly.

## Day-1 smoke checks

- [ ] Sign-in works after a backend restart, confirming the JWT signing key is persistent.
- [ ] Basic RPC traffic reaches `https://transformar.api.devguards.com` from the web UI and from a production-configured mobile build.
- [ ] File upload works end to end, confirming database, R2, and core backend wiring.
- [ ] A canonical link such as `https://transformar.work/o/<tenant-key>/r/<resource-type>/<resource-id>` opens the web resolver and, on an installed mobile build, opens the app through verified app links.
- [ ] `curl -i https://transformar.work/.well-known/apple-app-site-association` returns `200` with JSON and no redirect.
- [ ] `curl -i https://transformar.work/.well-known/assetlinks.json` returns `200` with JSON and no redirect.
- [ ] A voice join token can be created with the production LiveKit settings, and at least one real client can complete signaling through `transformar.media.devguards.com:443`, TURN/TLS or relay fallback through `transformar-turn.media.devguards.com`, and direct UDP media on `5000-6000/udp`.

## Explicitly out of day 1

- [ ] Public App Store / Play Store submission can be handled after internal production builds are validated.
- [ ] Mobile push via Firebase Admin can be enabled later by creating the optional `fcm-service-account` secret; `GOOGLE_APPLICATION_CREDENTIALS` is already wired to the mounted path.
- [ ] SES email delivery can be enabled later by filling `AWS_REGION` and `SES_*` values.
- [ ] Voice recording and transcription can be enabled later by filling `VOICE_RECORDING_*` and `WHISPER_*` values.