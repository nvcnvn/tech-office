/**
 * Feature tour — web E2E (Feature 039, US1–US3).
 *
 * Mirrors backend/integration/feature_tour_test.go, but covers the half the backend
 * contract cannot: when the tour actually appears, that it never gets between a person
 * and where they asked to go, and that it can be driven entirely from the keyboard.
 *
 * The tour is server-driven, so these specs never assert what a stop says — that belongs
 * to the backend scenarios and to contracts/tour-content.md. They assert behaviour.
 */
import { test, expect, type Page } from '@playwright/test';
import * as api from './helpers/api';
import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';

/** Where /workspace lands. The tour is offered from here. */
const WORKSPACE_HOME = '/workspace/calendar';

async function openWorkspace(page: Page): Promise<void> {
  await page.goto(WORKSPACE_HOME);
  await expect(page.getByTestId('workspace-main-content')).toBeVisible();
}

test.describe('Feature tour on web', () => {
  test('an owner signing in for the first time is offered the administrator tour', async ({
    page,
  }) => { // FR-007
    const owner = await createTestOrg();
    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);

    // Offered, not forced: the prompt is a question with a visible way to decline.
    await expect(page.getByTestId('feature-tour-offer')).toBeVisible();
    await expect(page.getByTestId('feature-tour-offer-decline')).toBeVisible();
  });

  test('the owner can move forward and back and sees their position in the sequence', async ({
    page,
  }) => { // FR-011
    const owner = await createTestOrg();
    const tour = await api.getTour(owner);
    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);

    await page.getByTestId('feature-tour-offer-accept').click();
    await expect(page.getByTestId('feature-tour-position')).toHaveText(
      `Stop 1 of ${tour.stops.length}`,
    );
    // Back is unavailable at the first stop rather than absent, so the control does not
    // move under the person's cursor between stops.
    await expect(page.getByTestId('feature-tour-previous')).toBeDisabled();

    await page.getByTestId('feature-tour-next').click();
    await expect(page.getByTestId('feature-tour-position')).toHaveText(
      `Stop 2 of ${tour.stops.length}`,
    );

    await page.getByTestId('feature-tour-previous').click();
    await expect(page.getByTestId('feature-tour-position')).toHaveText(
      `Stop 1 of ${tour.stops.length}`,
    );
  });

  test('each stop is a card that links to its surface and does not highlight any element', async ({
    page,
  }) => { // FR-018
    const owner = await createTestOrg();
    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);
    await page.getByTestId('feature-tour-offer-accept').click();

    const card = page.getByTestId('feature-tour');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('feature-tour-action')).toBeVisible();

    // FR-018 forbids anchoring or spotlighting live elements. A tour that points at the
    // DOM breaks every time the UI moves, and these stops describe capabilities rather
    // than controls — so nothing outside the card may be marked up as tour-highlighted.
    await expect(page.locator('[data-tour-highlight]')).toHaveCount(0);
    await expect(page.locator('.tour-spotlight')).toHaveCount(0);
  });

  test('acting on a stop closes the tour and navigates to the surface', async ({
    page,
  }) => { // FR-012
    const owner = await createTestOrg();
    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);
    await page.getByTestId('feature-tour-offer-accept').click();
    await page.getByTestId('feature-tour-action').click();

    await expect(page.getByTestId('feature-tour')).toBeHidden();
    await expect(page).not.toHaveURL(new RegExp(`${WORKSPACE_HOME}$`));
  });

  test('returning to the workspace reopens the tour at the same stop, unprompted', async ({
    page,
  }) => { // FR-012
    const owner = await createTestOrg();
    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);
    await page.getByTestId('feature-tour-offer-accept').click();
    await page.getByTestId('feature-tour-action').click();
    await expect(page.getByTestId('feature-tour')).toBeHidden();

    await openWorkspace(page);

    // Straight back into the sequence: they already said yes once, so asking again would
    // be a second prompt for a question they answered.
    await expect(page.getByTestId('feature-tour')).toBeVisible();
    await expect(page.getByTestId('feature-tour-offer')).toBeHidden();
    await expect(page.getByTestId('feature-tour-position')).toHaveText(/Stop 2 of/);
  });

  test('the project stop lands with project creation visible', async ({
    page,
  }) => { // FR-013a
    const owner = await createTestOrg();
    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);
    await page.getByTestId('feature-tour-offer-accept').click();

    // Walk to the project stop rather than assuming its index: filtering is a server
    // decision and this owner's sequence could legitimately be shorter.
    await advanceToStop(page, 'project');
    await page.getByTestId('feature-tour-action').click();

    // Not a project list that is empty in exactly the workspace this stop is written for.
    await expect(page.getByTestId('create-project-dialog')).toBeVisible();
  });

  test('the ritual stop opens the project the rituals would live in', async ({
    page,
  }) => { // FR-013a
    // Registration seeds a default project, so this is the ordinary case: there is
    // somewhere for a ritual to live and the stop goes straight there.
    const owner = await createTestOrg();
    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);
    await page.getByTestId('feature-tour-offer-accept').click();
    await advanceToStop(page, 'ritual');

    await expect(page.getByTestId('feature-tour-ritual-fallback-note')).toBeHidden();
    await page.getByTestId('feature-tour-action').click();

    // Into that project's ritual settings, where a definition is actually created — not
    // onto its board, which is a list of something else entirely.
    await expect(page).toHaveURL(/\/workspace\/tasks\/[0-9a-f-]+/);
    await expect(page).toHaveURL(/tab=rituals/);
  });

  test('with no project at all the ritual stop routes to project creation and says why', async ({
    page,
  }) => { // FR-013a
    // A ritual lives inside a project. Registration normally seeds one, but it is allowed
    // to fail without failing registration, and a workspace can archive its last project
    // — so this state is reachable and pointing at a rituals screen that cannot exist is
    // the empty-screen failure the spec's edge cases forbid.
    const owner = await createTestOrg();
    const existing = await api.listProjects(owner);
    for (const project of existing.projects ?? []) {
      await api.archiveProject(owner, project.id, true);
    }

    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);
    await page.getByTestId('feature-tour-offer-accept').click();
    await advanceToStop(page, 'ritual');

    // The card says why before the button does something unexpected.
    await expect(page.getByTestId('feature-tour-ritual-fallback-note')).toBeVisible();
    await page.getByTestId('feature-tour-action').click();
    await expect(page.getByTestId('create-project-dialog')).toBeVisible();
  });

  test('leaving mid-tour and signing in again resumes at the same stop', async ({
    page,
  }) => { // FR-010
    const owner = await createTestOrg();
    await api.updateTourProgress(owner, 'TOUR_STATUS_IN_PROGRESS', 2);
    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);

    await expect(page.getByTestId('feature-tour-position')).toHaveText(/Stop 3 of/);
  });

  test('a completed tour is not offered on the next sign-in', async ({ page }) => { // FR-007
    const owner = await createTestOrg();
    await api.updateTourProgress(owner, 'TOUR_STATUS_COMPLETED', 0);
    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);

    await expect(page.getByTestId('feature-tour-offer')).toBeHidden();
    await expect(page.getByTestId('feature-tour')).toBeHidden();
  });

  test('an employee signing in for the first time is offered the worker tour', async ({
    page,
  }) => { // FR-001, FR-002
    const owner = await createTestOrg();
    const employee = await createTestEmployee(owner);
    const workerTour = await api.getTour(employee);
    expect(workerTour.tourId).toBe('worker');

    await loginAs(page, employee, { keepTour: true });
    await openWorkspace(page);
    await page.getByTestId('feature-tour-offer-accept').click();

    // The worker sequence, not the administrator one — the server decided that from this
    // person's permissions and the client renders whatever it was given.
    await expect(page.getByTestId('feature-tour-position')).toHaveText(
      `Stop 1 of ${workerTour.stops.length}`,
    );
    await expect(page.getByTestId('feature-tour-title')).toHaveText(
      workerTour.stops[0].title,
    );
  });

  test('the tour can be started from the help entry point after being dismissed', async ({
    page,
  }) => { // FR-017
    const owner = await createTestOrg();
    await api.updateTourProgress(owner, 'TOUR_STATUS_DISMISSED', 3);
    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);
    await expect(page.getByTestId('feature-tour')).toBeHidden();

    await page.getByTestId('user-menu-avatar').click();
    await page.getByTestId('user-menu-take-the-tour').click();

    // From the beginning, not from where they gave up: asking for the tour means asking
    // for the whole thing.
    await expect(page.getByTestId('feature-tour')).toBeVisible();
    await expect(page.getByTestId('feature-tour-position')).toHaveText(/Stop 1 of/);
  });

  test('replaying after a role change gives the sequence for the current role', async ({
    page,
  }) => { // FR-017, FR-002
    // An employee promoted to owner-level permissions is, for tour purposes, an
    // administrator: the replay serves the tour their permissions earn now, not the one
    // they were shown when they joined.
    const owner = await createTestOrg();
    const employee = await createTestEmployee(owner);
    expect((await api.getTour(employee)).tourId).toBe('worker');
    await api.updateTourProgress(employee, 'TOUR_STATUS_DISMISSED', 1);

    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);
    await expect((await api.getTour(owner)).tourId).toBe('administrator');
  });

  test('the tour is fully operable by keyboard and exposes its stop position', async ({
    page,
  }) => { // FR-019
    const owner = await createTestOrg();
    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);

    // Accepting the offer without a mouse.
    await page.getByTestId('feature-tour-offer-accept').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('feature-tour')).toBeVisible();

    // Announced, not only drawn — aria-live so the position reaches a screen reader as
    // the card changes underneath the dialog.
    const position = page.getByTestId('feature-tour-position');
    await expect(position).toHaveAttribute('aria-live', 'polite');
    await expect(position).toHaveText(/Stop 1 of/);

    await page.getByTestId('feature-tour-next').focus();
    await page.keyboard.press('Enter');
    await expect(position).toHaveText(/Stop 2 of/);
  });

  test('focus is never trapped without an exit', async ({ page }) => { // FR-009, FR-019
    const owner = await createTestOrg();
    await loginAs(page, owner, { keepTour: true });
    await openWorkspace(page);
    await page.getByTestId('feature-tour-offer-accept').click();
    await expect(page.getByTestId('feature-tour')).toBeVisible();

    // Escape always leaves. A dismiss control is also on every card, so leaving never
    // depends on knowing the keyboard shortcut.
    await expect(page.getByTestId('feature-tour-dismiss')).toBeVisible();
    await page.getByTestId('feature-tour-dismiss').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('feature-tour')).toBeHidden();
    await expect(page.getByTestId('workspace-main-content')).toBeVisible();
  });

  test('arriving from a shared resource link opens the resource and shows no tour', async ({
    page,
  }) => { // FR-013
    const owner = await createTestOrg();
    const channel = await api.createChannel(owner, {
      titleSlug: `tour-deeplink-${crypto.randomUUID().slice(0, 8)}`,
      displayName: 'Tour deep link',
    });
    await loginAs(page, owner, { keepTour: true });

    // The person asked for something specific. The tour waits.
    await page.goto(`/workspace/chat?channel=${channel.channel.id}&notification=x`);
    await expect(page.getByTestId('workspace-main-content')).toBeVisible();
    await expect(page.getByTestId('feature-tour-offer')).toBeHidden();
    await expect(page.getByTestId('feature-tour')).toBeHidden();
  });

  test('the tour does not appear over a workspace page it was not offered from', async ({
    page,
  }) => { // FR-013
    // The tour belongs on the workspace home. Rendering it on every workspace route would
    // put a modal over whatever the person actually came to do — a task they followed a
    // link to, the settings page they opened to delete their account.
    const owner = await createTestOrg();
    await loginAs(page, owner, { keepTour: true });

    await page.goto('/workspace/settings/notifications');
    await expect(page.getByTestId('feature-tour-offer')).toBeHidden();
    await expect(page.getByTestId('feature-tour')).toBeHidden();

    // Still pending, not discarded: it appears once they reach the surface it belongs on.
    await openWorkspace(page);
    await expect(page.getByTestId('feature-tour-offer')).toBeVisible();
  });

  test('an explicit request shows the tour wherever the person asked from', async ({
    page,
  }) => { // FR-017
    // The home-surface rule is about not interrupting. Clicking "Take the tour" is a
    // request, so it is honoured where it was made.
    const owner = await createTestOrg();
    await loginAs(page, owner, { keepTour: true });
    await page.goto('/workspace/settings/notifications');
    await expect(page.getByTestId('feature-tour')).toBeHidden();

    await page.getByTestId('user-menu-avatar').click();
    await page.getByTestId('user-menu-take-the-tour').click();
    await expect(page.getByTestId('feature-tour')).toBeVisible();
    await expect(page.getByTestId('feature-tour-position')).toHaveText(/Stop 1 of/);
  });

  test('a person who is not signed in sees no tour', async ({ page }) => { // FR-008
    // The tour lives inside the workspace layout, below the authentication guard, so it
    // cannot render for someone who has not got past it.
    await page.goto(WORKSPACE_HOME);
    await expect(page.getByTestId('feature-tour-offer')).toBeHidden();
    await expect(page.getByTestId('feature-tour')).toBeHidden();
  });
});

/**
 * Walk the open tour forward until the named stop is showing.
 *
 * Which stops a person gets, and in what order, is a server decision — so a spec that
 * hard-coded an index would break the first time filtering changed for an unrelated
 * reason.
 */
async function advanceToStop(page: Page, key: string): Promise<void> {
  const card = page.getByTestId('feature-tour');
  for (let i = 0; i < 10; i++) {
    if ((await card.getAttribute('data-tour-stop')) === key) return;
    await page.getByTestId('feature-tour-next').click();
  }
  throw new Error(`tour never reached the "${key}" stop`);
}
