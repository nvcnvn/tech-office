# Contract: `.github/workflows/checks.yml` — job `typecheck-mobile`

**Covers**: FR-022, FR-023, FR-024, FR-025, FR-026, FR-027 (verification), SC-005

This is the repository's first quality-check workflow. `.github/workflows/` currently holds only
`publish-images.yml`, which publishes images on `v*` tags.

---

## Triggers

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

Every pull request targeting the default branch, and every push to it (FR-022). No
`paths` or `paths-ignore` filter — see "Why nothing is skipped" below.

## Permissions

```yaml
permissions:
  contents: read
```

The job reads the repository and reports a check. It needs nothing else; `publish-images.yml`'s
`packages: write` is specific to publishing.

## Job contract

| Property | Value |
|---|---|
| Runner | `ubuntu-latest` (GitHub-hosted; the repository is public, so runner minutes are free) |
| Steps | `actions/checkout` → `pnpm/action-setup` → `actions/setup-node` (`node-version: 22`, `cache: pnpm`, `cache-dependency-path: frontend/pnpm-lock.yaml`) → `pnpm install --frozen-lockfile` in `frontend/` → `pnpm run typecheck:mobile` in `frontend/` |
| Command run | `pnpm run typecheck:mobile` — byte-identical to the local command (FR-026) |
| Concurrency | cancel superseded runs on the same ref, so a rapid push sequence does not queue |

`pnpm/action-setup` needs no `version` input: `frontend/package.json` declares
`"packageManager": "pnpm@10.15.1+sha512.…"` and the action resolves it from there, so CI and a
developer's machine cannot drift on pnpm versions.

`--frozen-lockfile` makes a lockfile that does not match `package.json` a build failure rather
than a silent re-resolution. That is what makes "CI passed" and "it passed locally" mean the same
thing (FR-026).

## No external services (FR-025)

The job touches no database, backend, device, emulator or browser. `tsc --noEmit` reads files and
exits. Nothing in the install needs one either: no package in the pnpm workspace declares a
`postinstall` or `prepare` script, and `onlyBuiltDependencies` is not configured, so no native
build step runs.

No `pnpm build` and no `buf generate` step is needed. The `apis`, `rpc` and `@tech-office/links`
workspace packages resolve to their TypeScript sources, and the generated protobuf code
(`frontend/packages/rpc/rpc/v1/*_pb.ts`) is tracked in git.

## Failure contract (FR-023)

`tsc` writes each diagnostic as `path/to/file.tsx(LINE,COL): error TSxxxx: message` and exits
non-zero; `pnpm run` propagates the exit code and the step fails the job. The file, line and
error text are therefore in the run's log without any reporter configuration.

## Passing baseline (FR-024, FR-027)

Measured at `a33070a`, from `frontend/`:

```
$ pnpm run typecheck:mobile     # exit 0, 2.6s
```

170 of 175 mobile sources are checked; the five omitted are the `src/**/*.check.ts` files the
tsconfig excludes on purpose. The workflow is therefore merged against a green baseline, not red.

## Acceptance test (US3's Independent Test)

1. Push a branch introducing a deliberate mobile type error. The run fails and its log names the
   file, line and error.
2. Revert it. The run passes.

Both directions are checked. A gate verified only in the passing direction is not verified.

## Why nothing is skipped (FR-004 of US3)

`paths-ignore` was considered for backend-only and deploy-only changes and **rejected**. A
required status check that is skipped by a path filter reports as *pending*, not *passing*, and
blocks the merge it was meant to wave through — a well-known GitHub Actions trap. The job is
~3 s of `tsc` plus a pnpm install warmed by `actions/setup-node`'s cache, so running it
unconditionally is both simpler and comfortably inside SC-005's five-minute budget for every
change, including ones that touch no TypeScript.

## Why one file with a named job

`checks.yml` with job `typecheck-mobile`, rather than `typecheck-mobile.yml`, so the gates this
feature defers — the Go integration suite, the web E2E suite, `pnpm lint` (D67) — can be added
as further jobs without renaming the workflow or re-pointing a branch protection rule. FR-024's
"the workflow must pass on the default branch" holds for the single job that exists today.
