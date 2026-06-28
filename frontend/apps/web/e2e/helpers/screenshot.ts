/**
 * Optional per-step screenshot helper for E2E tests.
 *
 * Enable via env var: E2E_SCREENSHOTS=1
 * Screenshots are saved to: tmp/e2e-screenshots/<test-slug>/<NN>_<label>.png
 *
 * Usage:
 *   import { stepScreenshot } from './helpers/screenshot';
 *
 *   test('something', async ({ page }, testInfo) => {
 *     await loginAs(page, owner);
 *     await stepScreenshot(page, testInfo, 'after-login');
 *     await page.goto('/workspace/calendar');
 *     await stepScreenshot(page, testInfo, 'calendar-loaded');
 *   });
 */
import type { Page, TestInfo } from '@playwright/test';
import * as path from 'path';

export const SCREENSHOTS_ENABLED =
  process.env.E2E_SCREENSHOTS === '1' || process.env.E2E_SCREENSHOTS === 'true';

const OUTPUT_DIR = path.resolve(__dirname, '../../tmp/e2e-screenshots');

// Per-test step counters keyed by testInfo.testId
const counters = new Map<string, number>();

/**
 * Take a labelled screenshot if E2E_SCREENSHOTS is enabled.
 * No-op otherwise — safe to sprinkle liberally.
 */
export async function stepScreenshot(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  if (!SCREENSHOTS_ENABLED) return;

  const n = (counters.get(testInfo.testId) ?? 0) + 1;
  counters.set(testInfo.testId, n);

  const testSlug = testInfo.titlePath
    .join('--')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const filePath = path.join(
    OUTPUT_DIR,
    testSlug,
    `${String(n).padStart(2, '0')}_${safeLabel}.png`,
  );

  await page.screenshot({ path: filePath, fullPage: true });
}

