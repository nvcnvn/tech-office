# Web App

## Environment Setup

Create `.env.local` in this directory with the values required for local auth and API access:

```bash
NEXT_PUBLIC_ZITADEL_ISSUER=https://techofficeinstance-elao17.us1.zitadel.cloud
NEXT_PUBLIC_BASE_URL=http://localhost:13000
NEXT_PUBLIC_API_URL=http://localhost:18080
NEXT_PUBLIC_API_BASE_URL=http://localhost:18080
```

Production builds must set:

```bash
NEXT_PUBLIC_BASE_URL=https://transformar.work
NEXT_PUBLIC_API_URL=https://transformar.api.devguards.com
NEXT_PUBLIC_API_BASE_URL=https://transformar.api.devguards.com
```

See `.env.local.example` for the current template.

Copy `public/firebase-config.json` to `firebase-config.local.json`, fill in real Firebase values, and keep committed defaults as placeholders only. At runtime the app still reads `public/firebase-config.json`, so either replace that file locally or symlink it to the local copy.

## Local Development

Run the web app from this directory:

```bash
pnpm dev
```

The app is expected at `http://localhost:13000`.

## Canonical Link Host Responsibilities

This app owns the main-host canonical route namespace and the verified-link association artifacts used by mobile.

- Canonical resolver URLs live under `/o/<tenant-key>/r/...`.
- `/.well-known/apple-app-site-association` must be served from the main production host with no extension, no redirect, and a JSON response body.
- `/.well-known/assetlinks.json` must be served from the same host over HTTPS with `application/json`.
- The verified-link scope must stay narrow enough to capture canonical links without claiming unrelated product paths on Android 14 and lower.
- Deployments must preserve these files as static responses. CDN rewrites, auth gates, HTML fallbacks, or framework redirects on `/.well-known/*` break verification.

## Deployment Checklist For Canonical Links

Before shipping canonical-link changes, verify all of the following on the production host:

- `curl -i https://transformar.work/.well-known/apple-app-site-association` returns `200` and does not redirect.
- `curl -i https://transformar.work/.well-known/assetlinks.json` returns `200` with `content-type: application/json`.
- `https://transformar.work/o/<tenant-key>/r/<resource-type>/<resource-id>` reaches the web resolver route directly on the main host.
- The AASA file still limits iOS capture to `/o/*/r/*`.
- The Android asset links file contains the SHA-256 fingerprints for every signing key that should open verified links in that environment.

## Notes

- Keep the main-host canonical route independent of middleware-only behavior. Static hosting and direct route hits must still work.
- If you rotate Android signing keys, update `assetlinks.json` in the same deployment window as the mobile build.
- If you change the production bundle identifier or Apple team ID, update the AASA `appID` immediately or iOS Universal Links will stop opening the app.
