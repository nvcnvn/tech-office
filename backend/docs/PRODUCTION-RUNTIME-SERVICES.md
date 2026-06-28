# Production Runtime Services

This repository manages the production backend application and the required in-cluster runtime services it depends on. The production database is intentionally not managed here and is expected to be provisioned separately, for example through StackGres.

## Included services in the prod overlay

- `backend`: main API and RPC server
- `clamav`: malware scanning for uploaded files
- `gotenberg`: office document to PDF conversion
- `livekit`: real-time voice signaling, media orchestration, and built-in TURN over TLS

## Deployment order

1. Provision the external production database and obtain its read-write endpoint.
2. Fill and apply `backend/k8s/overlays/prod/secrets.example.yaml`, or provision equivalent secrets through your secret manager. The required objects are `backend-secrets`, `jwt-signing-key`, and the shared `livekit-secrets`. Create `fcm-service-account` only when mobile push is enabled.
3. Configure Cloudflare DNS and proxy mode, OVH edge firewall rules, and the Cilium Gateway listeners so the backend API, LiveKit signal host, TURN/TLS host, and UDP media range are reachable on the intended network path.
4. Apply `backend/k8s/overlays/prod`.
5. Run `backend/scripts/migrate.sh up` against the external production database.

## Notes

- `backend/k8s/overlays/prod` is the single production overlay in this repo.
- `backend/k8s/overlays/prod/gateway.yaml`, `backend-route.yaml`, and `livekit-signal-route.yaml` move the public backend API host and the client-facing LiveKit signal host to Gateway API listeners on `443/tcp`. Create matching TLS secrets such as `backend-tls` and `livekit-signal-tls`, or adjust the listener certificate references to your wildcard secret names.
- `backend/k8s/base/livekit/secrets.example.yaml` documents the shared LiveKit secret shape expected by both the backend and the LiveKit runtime manifests.
- `livekit-secrets` must include `LIVEKIT_KEYS`, with a mapping such as `prodkey: <32+ character secret>`. The backend now reads that same secret and derives its API key pair from the first mapping entry unless explicit `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` env vars are set. `LIVEKIT_WEBHOOK_URL` should point at the public backend webhook endpoint when webhook reconciliation is enabled.
- The base LiveKit Service is now a `ClusterIP` that exposes `7880/tcp` for in-cluster signaling and API access, plus `443/tcp` for TURN/TLS-aware L4 routing if your Gateway implementation supports it. Public `transformar.media.devguards.com` traffic is expected to arrive through the Gateway API listener on `443/tcp`, while `transformar-turn.media.devguards.com:443` is handled by a dedicated L4 TCP or TLS edge.
- The LiveKit pod now uses host networking and a direct UDP media range of `5000-6000/udp`. This matches LiveKit's Kubernetes guidance for direct network access and means you should schedule at most one LiveKit pod per node.
- `turn.domain` is `transformar-turn.media.devguards.com` and `turn.tls_port` is `443`. With `turn.external_tls=true`, the external edge terminates TLS and forwards plaintext TURN traffic to LiveKit. If you choose direct node exposure instead of an L4 TLS edge, switch `external_tls` off and mount TURN certs into the pod.
- Cloudflare can proxy the `api.` and `voice.` hosts on `443/tcp`, but raw TURN/TLS and UDP media should remain DNS-only unless you are using Spectrum for those hosts.
- OVH edge firewall and Cilium node policies must allow inbound `5000-6000/udp` directly to the LiveKit nodes. The Gateway listeners do not replace that UDP media path.
- LiveKit 1.12+ uses explicit TURN credential TTL handling. Keep `turn.ttl_seconds` non-zero in `backend/k8s/base/livekit/configmap.yaml`.
- LiveKit 1.12+ denies restricted or private TURN peer CIDRs by default. If your deployment must relay TURN traffic to private, VPN, or internal client addresses, add the required CIDRs under `turn.allow_restricted_peer_cidrs` in `backend/k8s/base/livekit/configmap.yaml`.
- `backend/k8s/base/backend/configmap.yaml` points the backend at the in-cluster service names created by the prod overlay.