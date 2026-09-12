import { defineConfig, devices } from '@playwright/test';

const e2eBaseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: e2eBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Still `next dev`, after measuring both alternatives.
    //
    // A production build removes on-demand compilation outright and is what research R2
    // preferred. Measured and rejected on cost: with `output: "standalone"` the
    // file-tracing step alone took about forty minutes on this monorepo, and with
    // tracing, ESLint and type checking all disabled for an E2E-only build, the webpack
    // compile still had not finished after fifty. A route-warming globalSetup was then
    // tried as feature 061's named fallback and also removed: it does not reduce the
    // compile cost, only moves it, and warming every route serially had not finished
    // after ninety minutes. `make test-frontend` has to be a command an engineer will
    // actually run before calling a feature done.
    //
    // What remains is drift: on a COLD .next-e2e a cold-route navigation can still lose
    // its race with the compiler and time out. It is recorded rather than papered over —
    // explicitly not with `retries`, which would make a suite that cannot say no even
    // less able to.
    command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3100',
    // Its own build directory, so this server cannot share a compilation cache with a
    // developer's `pnpm --filter web dev` on :13000. Two dev servers on one .next evict
    // each other's compiled routes continuously: with a stale dev server running, a
    // full-suite run went from nine minutes to hours, next-server pinned at ~245% CPU.
    env: { NEXT_DIST_DIR: '.next-e2e' },
    url: `${e2eBaseUrl}/signin/`,
    reuseExistingServer: false,
    // A cold start compiles the entry route from scratch, which can exceed two minutes
    // on a loaded machine.
    timeout: 300_000,
  },
});
