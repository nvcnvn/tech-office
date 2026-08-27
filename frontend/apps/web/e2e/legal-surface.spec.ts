/**
 * Legal surface E2E (Feature 036, US2).
 *
 * Mirrors backend/integration/iam_terms_test.go. The privacy policy and terms must
 * be reachable by somebody who has not installed the app and is not signed in —
 * a store reviewer opening a URL — so most of this file runs signed out on
 * purpose.
 *
 * Pattern: Arrange via API, Act via UI, Assert via UI.
 */
import { test, expect } from '@playwright/test';
import { createTestOrg, loginAs, type TestUser } from './helpers/auth';

test.describe('Legal surface', () => {
  test.describe('when a visitor opens the privacy policy without signing in', () => {
    test('the page renders', async ({ page }) => { // FR-008
      await page.goto('/privacy');
      await expect(page.getByRole('heading', { name: 'Privacy policy', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'What we collect' })).toBeVisible();
    });

    test('it states what is erased and what is retained on deletion', async ({ page }) => { // FR-008
      await page.goto('/privacy');
      await expect(page.getByRole('heading', { name: 'Deleting your account' })).toBeVisible();
      await expect(page.getByText('What is erased:')).toBeVisible();
      await expect(page.getByText('What is kept:')).toBeVisible();
    });
  });

  test.describe('when a visitor opens the terms without signing in', () => {
    test('the page renders', async ({ page }) => { // FR-008
      await page.goto('/terms');
      await expect(page.getByRole('heading', { name: 'Terms of service', level: 1 })).toBeVisible();
    });

    test('the terms prohibit abusive content and state the consequences', async ({ page }) => { // FR-009
      await page.goto('/terms');
      await expect(page.getByRole('heading', { name: 'Content that is not allowed' })).toBeVisible();
      await expect(page.getByText('Harassment, bullying')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'What happens when someone posts it' }),
      ).toBeVisible();
      await expect(page.getByText('Their account is terminated across TechOffice.')).toBeVisible();
    });

    test('an abuse contact address is shown', async ({ page }) => { // FR-013
      await page.goto('/terms');
      await expect(page.getByRole('link', { name: 'abuse@transformar.work' }).first()).toBeVisible();
    });
  });

  test.describe('when a person signs up', () => {
    test('the terms and privacy policy are linked from that screen', async ({ page }) => { // FR-010
      await page.goto('/signup');
      await expect(page.getByRole('link', { name: 'terms of service' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'privacy policy' })).toBeVisible();
    });

    test('they cannot proceed without acknowledging the terms', async ({ page }) => { // FR-010
      const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      await page.goto('/signup');

      // The form validates on blur, so every field is filled and then blurred by
      // moving to the next one; the last is blurred explicitly.
      await page.getByLabel('Company Name').fill(`Terms Gate ${suffix.slice(0, 6)}`);
      await page.getByLabel('Subdomain').fill(`tg${suffix.slice(0, 12)}`);
      await page.getByLabel('Admin Email').fill(`terms+${suffix}@test.invalid`);
      await page.locator('input[name="adminPassword"]').fill('Test1234!Test1234!Aa');
      await page.getByLabel('First Name').fill('Terms');
      await page.getByLabel('Last Name').fill('Gate');
      await page.getByLabel('Last Name').blur();

      const submit = page.getByRole('button', { name: /create organization/i });
      await expect(submit).toBeDisabled();

      // Ticking the box is the only thing standing between here and a valid form.
      await page.getByRole('checkbox').check();
      await expect(submit).toBeEnabled();
    });
  });

  test.describe('when a person is signed in', () => {
    let owner: TestUser;

    test.beforeAll(async () => {
      owner = await createTestOrg();
    });

    test('settings links to the privacy policy, terms, and abuse contact', async ({ page }) => { // FR-013
      await loginAs(page, owner);
      await page.goto('/workspace/settings');
      await expect(page.getByTestId('settings-privacy-policy-link')).toBeVisible();
      await expect(page.getByTestId('settings-terms-link')).toBeVisible();
      await expect(page.getByTestId('settings-abuse-contact-link')).toBeVisible();
    });
  });
});
