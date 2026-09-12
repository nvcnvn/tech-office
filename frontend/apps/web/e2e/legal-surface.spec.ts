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

      // CORRECTED ASSERTION (feature 061). This used to read
      // `await expect(submit).toBeDisabled()`, and it failed — the button is enabled.
      // The assertion was wrong about the product, not the other way round: SignupForm
      // deliberately does NOT gate the submit button on formState.isValid, and says why
      // in a comment on the button. The form validates on blur, so isValid lagged a field
      // the user had just typed and not yet left; they typed the last field, clicked, and
      // nothing happened. handleSubmit validates the whole form and shows the errors,
      // which is the same protection without the dead first click.
      //
      // FR-010 is about what the product must refuse, not about which control is greyed
      // out, so the corrected assertion checks the refusal itself: clicking submit with
      // the box unticked must not create anything, and must say why. That is a stronger
      // guard than the original — a disabled button proves nothing about what the
      // submit handler would have done.
      const submit = page.getByRole('button', { name: /create organization/i });
      const acknowledgement = page.getByRole('checkbox');
      await expect(acknowledgement).not.toBeChecked();

      await submit.click();
      await expect(
        page.getByText('You must accept the terms of service and privacy policy'),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/signup/);

      // Ticking the box is the only thing standing between here and a valid form.
      await acknowledgement.check();
      await expect(
        page.getByText('You must accept the terms of service and privacy policy'),
      ).toHaveCount(0);
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
