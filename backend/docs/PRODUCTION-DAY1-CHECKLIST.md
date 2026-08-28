# Production Day-1 Checklist

Use this list for the first production backend, web, and mobile-ready deployment. It is intentionally strict and excludes optional follow-up work such as public mobile store release, SES email, call recording, and transcription.

The deployment itself is the Docker Swarm stack in [`deploy/`](../../deploy/README.md) —
that runbook covers the mechanics (fleet layout, profiles, backups, upgrades). This list
is the product-level checklist that sits on top of it: DNS, SSO, app links, and the
smoke tests that prove a real user can sign in and place a call.

## Final production endpoints

- [ ] `transformar.work` serves the web UI over HTTPS.
- [ ] `transformar.api.devguards.com` is proxied to `2604:2dc0:205:dd00::11` for backend HTTPS/RPC traffic.
- [ ] `transformar.media.devguards.com` is proxied to `2604:2dc0:205:dd00::11` for LiveKit HTTPS/WebSocket signaling.
- [ ] WebRTC media reaches the voice node directly on its own ports. There is no TURN hostname in this deployment — the embedded TURN server is off, because TURN/TLS wants 443 and Traefik owns it. ICE-TCP on `7881` is the fallback for clients that cannot use UDP.
- [ ] Cloudflare proxy mode is correct for each hostname: the web, API and media *signalling* hostnames can be proxied; the UDP media path must not be, unless Spectrum is configured for it.

## Required before first deploy

- [ ] A single release tag has been chosen for all release artifacts, for example `RELEASE_TAG=$(date -u +%Y%m%d%H%M%S)`.
- [ ] Images exist where every node can pull them. `tech-office-backend`, `tech-office-backend-migrate` and `tech-office-postgres` are published to `ghcr.io/nvcnvn/` by `.github/workflows/publish-images.yml`. The web image is welded to its deployment's hostnames, so this one pulls `ghcr.io/nvcnvn/tech-office-web-transformar` via `WEB_IMAGE`; any other deployment builds its own with `deploy/scripts/build-images.sh`.
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
- [ ] `deploy/.env` has been created from `deploy/.env.example` and every REQUIRED value is filled in, and `deploy/scripts/bootstrap.sh` has run.
- [ ] Node labels are assigned for the fleet's size (`edge db app voice processing obs`), and the machines are on one internal network with the swarm ports open between them.
- [ ] The `tech-office-postgres` image is the one in use — the deployment's PostgreSQL needs `citus`, `pg_textsearch`, `pgroonga` and `pgbackrest`, and a stock `postgres` image has none of them.
- [ ] `DATABASE_URL` matches `POSTGRES_PASSWORD` (bootstrap rewrites it) and resolves over the overlay network.
- [ ] `JWT_PRIVATE_KEY_PATH` points at a mounted production signing key. Do not allow the backend to fall back to the ephemeral dev signer.
- [ ] `WEBAPP_URL=https://transformar.work`. This value is used for IAM email links and must match the public web host.
- [ ] `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, and `R2_ENDPOINT` are set to the real production bucket. The current backend startup path requires R2 configuration.
- [ ] Every `localhost`, `192.168.x.x`, and `.dev-keys` value from local development has been removed from the production environment.
- [ ] `LIVEKIT_API_SECRET` is a real 32+ character secret (bootstrap generates one), and `PUBLIC_LIVEKIT_URL` — derived from `MEDIA_DOMAIN` — is the address clients can actually reach. The server initializes the voice service on startup and must not ship with dev defaults.
- [ ] `LIVEKIT_TRANSPORT` is chosen deliberately: `mux` (one UDP port on the overlay) or `host` (a `5000-6000/udp` range on the voice node's own network stack, which also needs `LIVEKIT_HOST`).
- [ ] `LIVEKIT_NODE_IP` is empty for an internet-facing deployment (LiveKit discovers its public address over STUN) or set to the voice node's LAN IP for a LAN-only one. Getting this wrong looks like calls that connect and then have no audio.
- [ ] The edge firewall allows the chosen media ports straight to the voice node. Traefik does not carry media, only signalling.
- [ ] TLS is settled: `TLS_MODE=acme` with port 80 reachable from the internet and public DNS for all three hostnames, or `TLS_MODE=file` with a real certificate in `deploy/secrets/tls.crt` and `deploy/secrets/tls.key`.
- [ ] `deploy/secrets/` holds a real `jwt-private.pem`, and — if push is in scope — a real `fcm.json` and `apns.p8`. Placeholders leave those features switched off, which the backend logs loudly at startup.
- [ ] Backups are configured and the bucket is reachable: `BACKUP_S3_*` filled in, `BACKUP_CIPHER_PASS` stored somewhere outside the fleet.

## First deployment steps

- [ ] `deploy/scripts/bootstrap.sh` — initialises the swarm, labels the nodes, generates the keys, writes `deploy/secrets/pgbackrest.conf`. Copy `deploy/.env` and `deploy/secrets/` somewhere safe afterwards.
- [ ] `deploy/scripts/build-images.sh` — builds the web image with this deployment's URLs and writes the release tag back into `deploy/.env`. It pushes to `REGISTRY` when one is set, which a fleet of more than one machine requires.
- [ ] `deploy/scripts/deploy.sh` — first pass brings up PostgreSQL alone, runs migrations, then deploys everything and smoke-tests the three public endpoints.
- [ ] For a mobile production build, run `make prod-build-mobile RELEASE_TAG=<tag>` after EAS credentials and signing are ready. Mobile packaging/submission can be handled separately from Day-1 backend/web deployment.
- [ ] Confirm `docker stack ps techoffice` shows no failed tasks and `https://<API_DOMAIN>/healthz` returns `200`.
- [ ] Confirm the web app serves `/.well-known/*` static files directly.
- [ ] `deploy/scripts/verify-restore.sh` passes. A backup that has never been restored is not a backup, and Day 1 is the cheapest time to find that out.

## Day-1 smoke checks

- [ ] Sign-in works after a backend restart, confirming the JWT signing key is persistent.
- [ ] Basic RPC traffic reaches `https://transformar.api.devguards.com` from the web UI and from a production-configured mobile build.
- [ ] File upload works end to end, confirming database, R2, and core backend wiring.
- [ ] A canonical link such as `https://transformar.work/o/<tenant-key>/r/<resource-type>/<resource-id>` opens the web resolver and, on an installed mobile build, opens the app through verified app links.
- [ ] `curl -i https://transformar.work/.well-known/apple-app-site-association` returns `200` with JSON and no redirect.
- [ ] `curl -i https://transformar.work/.well-known/assetlinks.json` returns `200` with JSON and no redirect.
- [ ] A voice join token can be created with the production LiveKit settings, and at least one real client completes signalling through `transformar.media.devguards.com:443` and gets audio over direct UDP media. Test from a phone on mobile data, not only from the office LAN — that is the path that exposes a wrong `LIVEKIT_NODE_IP` or a closed media port.
- [ ] If the observability profile is deployed, OpenObserve is receiving metrics (`up`, `pg_up`, `node_*` streams are populated) and the alert set from `deploy/config/openobserve/alerts.json` exists.

## Explicitly out of day 1

- [ ] Public App Store / Play Store submission can be handled after internal production builds are validated.
- [ ] Mobile push via Firebase Admin can be enabled later by dropping a real `deploy/secrets/fcm.json` in place and redeploying; the path is wired up and the backend enables the provider when the file is real rather than a placeholder. The same is true of APNs VoIP and `deploy/secrets/apns.p8`.
- [ ] SES email delivery can be enabled later by filling `AWS_REGION` and `SES_*` values.
- [ ] Voice recording and transcription can be enabled later by filling `VOICE_RECORDING_*` and `WHISPER_*` values.