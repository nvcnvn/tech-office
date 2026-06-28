# Quickstart: Canonical Cross-Platform Resource Links

## Goal

Build and verify one backend-owned canonical HTTPS link flow on the main global product host that works across Next.js web, Expo mobile, iOS Universal Links, and Android App Links while preserving graceful auth, access, preview, and fallback behavior.

## Implementation Order

1. Implement backend canonical target types, generation rules, legacy normalization rules, and Connect RPC / gRPC resolver and preview methods.
2. Add a dedicated canonical route namespace on the main global web host, including a stable tenant hint segment, and connect it to backend resolution.
3. Host `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` from the web app with production HTTPS and no redirects.
4. Update Expo app configuration with `ios.associatedDomains` and `android.intentFilters` using verified HTTPS host entries.
5. Add mobile native inbound rewrite logic in `frontend/apps/mobile/src/app/+native-intent.tsx` for legacy or irregular native link inputs.
6. Add web route translation through middleware or resolver-page redirects backed by the canonical-link Connect RPC contract.
7. Add copy-link, paste-detection, and preview-card behavior.
8. Add backend integration scenarios, Playwright E2E scenarios, and Maestro happy-path coverage.

## Key Platform Setup

### Web host

- Serve canonical links from the main single global product host.
- Serve `/.well-known/apple-app-site-association` with no extension, over HTTPS, with no redirects.
- Serve `/.well-known/assetlinks.json` over HTTPS with `application/json` content type.
- Keep canonical route handling deterministic even if tenant-local web routes differ.
- Use a canonical path shape such as `/o/<tenant-key>/r/<resource-type>/<resource-id>` for tenant-scoped resources so backend resolution can recover tenant context before querying distributed tables.
- Ensure CDNs and reverse proxies do not rewrite `/.well-known/*` requests to HTML, auth middleware, or locale redirects.
- Keep the verified-link route scope intentionally narrow so only canonical links are claimed on the main host.

### iOS / Expo

- Add `ios.associatedDomains` entries in `frontend/apps/mobile/app.json` for the main global host using `applinks:<domain>` format.
- Rebuild the app after associated-domain changes; iOS association refresh is not immediate.
- Validate incoming parameters defensively before navigation.
- Treat AASA refresh as cache-sensitive: reinstalling the app or shipping a new build is often required before a changed AASA file is honored.

### Android / Expo

- Add `android.intentFilters` with `autoVerify: true` for the main global host in `frontend/apps/mobile/app.json`.
- Include the HTTPS host scope needed for canonical links without depending on Android-15-only dynamic rules for correctness.
- Publish the correct SHA-256 fingerprints in `assetlinks.json` for the signing keys used by development and production builds as needed.
- Expect domain verification to lag after deploys or fresh installs; Android may take tens of seconds before opening the app directly.

## Rollout And Troubleshooting

### AASA caching and iOS verification

- Confirm `https://<global-host>/.well-known/apple-app-site-association` is publicly reachable with `200` and no redirect chain.
- Keep the file extensionless and return JSON bytes, not HTML.
- After changing AASA contents, reinstall the app or a new build before concluding that Universal Links are broken.
- If Safari continues to open the website after a valid deploy, assume cache first and verify device install state before changing routing code.

### Android verification delay

- Confirm `https://<global-host>/.well-known/assetlinks.json` is publicly reachable with `200` and `application/json`.
- Verify the package name and SHA-256 fingerprint exactly match the installed build.
- After install or deploy, wait for verification before treating browser fallback as a regression.
- Use `adb shell pm get-app-links <package-name>` when debugging device-side verification state.

### Tenant-path canonical links

- Canonical links must keep the tenant key in the path: `/o/<tenant-key>/r/...`.
- Do not move tenant identity into ad hoc query parameters for tenant-scoped resources.
- If resolution lands in the wrong tenant, inspect the generated canonical URL first, then the backend tenant lookup, before investigating client routing.

### Main-host debugging

- Verify the failing link on the main global host first, not a tenant subdomain or local route alias.
- Check for CDN redirects, auth redirects, locale redirects, and static-export fallbacks that may intercept `/.well-known/*` or `/o/*/r/*`.
- If a mobile device opens the browser instead of the app, compare the exact canonical URL against the AASA and intent-filter path scope before changing resolver logic.
- If web resolution fails while the backend contract is healthy, debug the resolver page on the main host rather than workspace-local routes.

## Validation Commands

### Repo checks

```sh
pnpm --dir frontend exec tsc -p apps/mobile/tsconfig.json --noEmit
cd backend && go test ./integration/...
pnpm --dir frontend --filter web exec playwright test --config=e2e/playwright.config.ts
make test-mobile
```

### Android App Link launch test

```sh
adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://<global-host>/o/<tenant-key>/r/<resource-type>/<resource-id>" com.devguards.TechOffice
```

### iOS verification test

- Install a development or production build on a real device.
- Open the canonical HTTPS link from Safari, Notes, Mail, or another app.
- If the app does not open after association changes, reinstall or rebuild after confirming the AASA file is valid and publicly reachable.

## Expected Outcomes

- A canonical task link opens the correct task in web and mobile.
- The canonical link carries enough stable tenant context to resolve the correct tenant-scoped resource without relying on the current active tenant alone.
- If the app is installed and verified, mobile opens the app directly.
- If verification or app installation is unavailable, the same link opens the browser destination.
- Signed-out users return to the intended destination after auth.
- Access-denied and not-found states are explicit.
- Internal previews render when metadata is available and degrade to raw clickable links when it is not.