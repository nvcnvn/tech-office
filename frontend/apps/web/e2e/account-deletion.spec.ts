/**
 * Account deletion E2E (Feature 036, US1).
 *
 * Mirrors backend/integration/iam_account_deletion_test.go and
 * iam_removal_request_test.go.
 *
 * Note on fixtures: createTestEmployee builds an admin-provisioned PIN account, so
 * every "employee" here is on the request-removal path by construction — which is
 * exactly what the second half of this file needs.
 */
import { test, expect } from '@playwright/test';
import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';

test.describe('Account deletion', () => {
  test.describe('when a person opens account settings', () => {
    let owner: TestUser;

    test.beforeAll(async () => {
      owner = await createTestOrg();
    });

    test('the settings page offers account deletion', async ({ page }) => { // FR-001
      await loginAs(page, owner);
      await page.goto('/workspace/settings');
      await expect(page.getByTestId('delete-account-section')).toBeVisible();
      await expect(page.getByTestId('delete-account-open')).toBeVisible();
    });

    test('it states what is erased and what is retained, with a reason for each', async ({ page }) => { // FR-002
      await loginAs(page, owner);
      await page.goto('/workspace/settings');

      const erased = page.getByTestId('delete-account-erased');
      await expect(erased).toBeVisible();
      await expect(erased.getByRole('listitem').first()).toBeVisible();

      const retained = page.getByTestId('delete-account-retained');
      await expect(retained).toBeVisible();
      // A retained category with no reason is a disclaimer, not an explanation.
      await expect(
        retained.getByText('They are part of that workspace', { exact: false }),
      ).toBeVisible();
    });

    test('the confirmation requires the exact phrase', async ({ page }) => { // FR-002
      await loginAs(page, owner);
      await page.goto('/workspace/settings');
      await page.getByTestId('delete-account-open').click();

      const confirm = page.getByTestId('delete-account-confirm');
      await expect(confirm).toBeDisabled();

      await page.getByTestId('delete-account-phrase').fill('delete');
      await expect(confirm).toBeDisabled();

      await page.getByTestId('delete-account-phrase').fill('delete my account');
      await expect(confirm).toBeEnabled();
    });
  });

  test.describe('when a sole owner of a populated workspace tries to delete', () => {
    let owner: TestUser;

    test.beforeAll(async () => {
      owner = await createTestOrg();
      await createTestEmployee(owner);
    });

    test('the page lists the blocking workspaces', async ({ page }) => { // FR-005
      await loginAs(page, owner);
      await page.goto('/workspace/settings');

      const blocked = page.getByTestId('delete-account-blocked');
      await expect(blocked).toBeVisible();
      // Naming the workspace is the point: a bare refusal tells the person nothing
      // about what to do instead.
      // Rendered as a link, because it navigates to the organization settings page.
      await expect(blocked.getByRole('link', { name: /transfer or close/i })).toBeVisible();
      await expect(page.getByTestId('delete-account-open')).toBeDisabled();
    });
  });

  test.describe('when a provisioned worker opens account settings', () => {
    let owner: TestUser;
    let worker: TestUser;

    test.beforeAll(async () => {
      owner = await createTestOrg();
      worker = await createTestEmployee(owner);
    });

    test('they see the request-removal path and their workspace name', async ({ page }) => { // FR-007b
      await loginAs(page, worker);
      await page.goto('/workspace/settings');

      await expect(page.getByTestId('removal-request-section')).toBeVisible();
      // The deletion path must not be offered to somebody it would refuse.
      await expect(page.getByTestId('delete-account-section')).toHaveCount(0);
      await expect(page.getByText(/created this account/i)).toBeVisible();
    });

    test('they can submit a removal request', async ({ page }) => { // FR-007c
      await loginAs(page, worker);
      await page.goto('/workspace/settings');

      await page.getByTestId('removal-request-note').fill('I have left the company.');
      await page.getByTestId('removal-request-submit').click();

      await expect(page.getByTestId('removal-request-status')).toBeVisible();
      await expect(page.getByText(/with the workspace owners/i)).toBeVisible();
    });

    test('an owner sees it in the removal queue and can decline it', async ({ page }) => { // FR-007d
      await loginAs(page, owner);
      await page.goto('/workspace/settings/removal-requests');

      await expect(page.getByTestId('removals-list')).toBeVisible();
      const decline = page.getByTestId(/^removal-decline-/).first();
      await expect(decline).toBeVisible();
      await decline.click();
      await page.getByTestId('removal-decision-confirm').click();

      await expect(page.getByTestId('removals-empty')).toBeVisible();
    });

    test('the worker can see the decision', async ({ page }) => { // FR-007d
      await loginAs(page, worker);
      await page.goto('/workspace/settings');
      await expect(page.getByText(/was declined/i)).toBeVisible();
    });
  });
});
