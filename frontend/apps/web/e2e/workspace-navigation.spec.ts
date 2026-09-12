/**
 * Workspace navigation E2E (Feature 062, US2).
 *
 * The workspace nav advertised eleven areas, three of which — CRM, Finance and HR —
 * were `enabled: false` placeholders for modules that were never built. Nothing in the
 * type system objects to a nav entry that goes nowhere, which is why this assertion
 * exists rather than a type.
 *
 * Note on shortcuts: the `⌘n` label beside each entry is copy, not a binding — the web
 * app registers no meta-key handler for them. So this file asserts the labels form a
 * contiguous, gapless run, which is what a reader of the nav can actually check, rather
 * than pressing keys that nothing listens for.
 */
import { test, expect } from '@playwright/test';
import { createTestOrg, loginAs, type TestUser } from './helpers/auth';

test.describe('Workspace navigation', () => {
  let owner: TestUser;

  test.beforeAll(async () => {
    owner = await createTestOrg();
  });

  test('every entry it shows is one a person can open', async ({ page }) => { // FR-005
    await loginAs(page, owner);
    await page.goto('/workspace');

    const entries = page.locator('[data-testid^="workspace-tab-"]');
    await expect(entries.first()).toBeVisible();

    const count = await entries.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const entry = entries.nth(i);
      const testId = await entry.getAttribute('data-testid');
      if (testId?.endsWith('-badge')) continue;

      // A disabled entry renders as a <button>; a real one renders as a link with an href.
      const tag = await entry.evaluate((el) => el.tagName.toLowerCase());
      expect(tag, `${testId} must be a link, not a disabled placeholder`).toBe('a');

      const href = await entry.getAttribute('href');
      expect(href, `${testId} must point somewhere`).toBeTruthy();

      const response = await page.request.get(href as string);
      expect(
        response.status(),
        `${testId} advertises ${href}, which must be a real route`,
      ).toBeLessThan(400);
    }
  });

  test('the advertised shortcuts run from 1 without a gap', async ({ page }) => { // FR-005
    await loginAs(page, owner);
    await page.goto('/workspace');

    const entries = page.locator('[data-testid^="workspace-tab-"]');
    await expect(entries.first()).toBeVisible();

    const labels = await entries.allInnerTexts();
    const shortcuts = labels
      .map((text) => text.match(/⌘(.)/)?.[1])
      .filter((key): key is string => Boolean(key));

    expect(shortcuts.length).toBeGreaterThan(0);

    // Every advertised key is a digit, and they count up from 1 with nothing skipped.
    // "⌘-" and "⌘=" were what a run of dead placeholder entries looked like.
    const expected = shortcuts.map((_, index) => String(index + 1));
    expect(shortcuts).toEqual(expected);
  });
});
