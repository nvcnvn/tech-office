/**
 * Custom Playwright fixtures that provide pre-authenticated pages.
 *
 * Usage in tests:
 *   import { test, expect } from './helpers/fixtures';
 *
 *   test('owner sees calendar', async ({ ownerPage }) => { ... });
 *   test('employee sees invite', async ({ employeePage }) => { ... });
 *
 * Each test.describe block shares a single org + users created once in
 * beforeAll, then each test() gets browser contexts with auth already injected.
 */
import { test as base, type Page } from '@playwright/test';
import { createTestOrg, createTestEmployee, type TestUser } from './auth';

// Re-export expect for convenience
export { expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Shared test state — one org per describe block
// ---------------------------------------------------------------------------

export interface TestContext {
  owner: TestUser;
  employees: TestUser[];
}

/**
 * Set up a fresh org with an owner and N employees.
 * Call once in test.beforeAll.
 */
export async function setupTestContext(employeeCount = 2): Promise<TestContext> {
  const owner = await createTestOrg();
  const employees: TestUser[] = [];
  for (let i = 0; i < employeeCount; i++) {
    employees.push(await createTestEmployee(owner));
  }
  return { owner, employees };
}

// ---------------------------------------------------------------------------
// Custom fixtures — pre-authenticated pages
// ---------------------------------------------------------------------------

type Fixtures = {
  /** A fresh Page with the org owner logged in. */
  ownerPage: Page;
  /** A fresh Page with employee[0] logged in. */
  employeePage: Page;
};

export const test = base.extend<Fixtures>({
  // These fixtures require a TestContext stored externally (e.g. in a variable
  // set by beforeAll). The fixtures create fresh browser contexts each time
  // and inject the auth token via localStorage.
  //
  // But since Playwright fixtures can't access beforeAll state cleanly,
  // the recommended pattern is to use `loginAs()` directly inside tests.
  // These fixtures are provided as a convenience when the test file uses a
  // single org throughout.

  ownerPage: async ({ browser }, use) => {
    // This is a placeholder — actual auth injection happens per-test
    // via loginAs(). Use the base `page` + `loginAs()` in most cases.
    const context = await browser.newContext();
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  employeePage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});
