/**
 * Document Edit Conflict E2E Tests — Feature 049.
 *
 * The conflict as a person experiences it: their save is refused, their text is still
 * in front of them, and they can get it saved without leaving the document.
 *
 * Behavioural contract: specs/049-doc-edit-conflict-protection/contracts/test-scenarios.md
 * Backend counterpart: backend/integration/docs_conflict_test.go
 *
 * Pattern: Arrange via API, Act via UI, Assert via UI.
 */
import { test, expect, type Page } from '@playwright/test';
import { createTestOrg, createTestEmployee, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';
import { stepScreenshot } from './helpers/screenshot';

const body = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

/** Open a document in edit mode, ready to type into. */
async function openForEditing(page: Page, user: TestUser, docId: string) {
  await loginAs(page, user);
  await page.goto('/workspace/docs');
  await expect(page.getByTestId('workspace-docs-page')).toBeVisible();
  await expect(page.getByTestId(`doc-tree-item-${docId}`)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(`doc-tree-item-${docId}`).click();
  await page.getByTestId('doc-edit-toggle-btn').click();
  await expect(page.getByTestId('doc-content-editor')).toBeVisible();
}

/** Replace the editor's text with `text`, which is what typing over a draft does. */
async function typeInto(page: Page, text: string) {
  const editor = page.getByTestId('doc-content-editor').locator('[contenteditable="true"]');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
  await expect(page.getByTestId('doc-save-btn')).toBeEnabled();
}

/**
 * Click Save and wait for the round trip to settle, whichever way it goes. Waiting on
 * the RPC rather than on a spinner is what makes an accepted save and a refused one
 * equally observable.
 */
async function save(page: Page) {
  const responded = page.waitForResponse(
    (r) => r.url().includes('/rpc.v1.DocumentService/UpdateDocument'),
    { timeout: 15_000 },
  );
  await page.getByTestId('doc-save-btn').click();
  await responded;
  await expect(
    page.getByTestId('doc-save-btn').locator('.MuiCircularProgress-root'),
  ).toHaveCount(0, { timeout: 15_000 });
}

test.describe('Document edit conflict', () => {
  let owner: TestUser;
  let colleague: TestUser;

  test.beforeAll(async () => {
    owner = await createTestOrg();
    colleague = await createTestEmployee(owner);
  });

  /** A document both people may edit. */
  async function sharedDoc(title: string) {
    const created = await api.createDocument(owner, { title, contentJson: body('Original text') });
    const docId = created.document.id;
    await api.setDocumentAccess(owner, docId, colleague.id, 'ACCESS_LEVEL_WRITE_UPDATE');
    return docId;
  }

  // ---------------------------------------------------------------------------
  test.describe('when a colleague saves while someone is still typing', () => {
    let docId: string;
    const docTitle = `Conflict Doc ${crypto.randomUUID().slice(0, 8)}`;
    const myText = 'The paragraph I have been writing for ten minutes';

    test.beforeEach(async ({ page }) => {
      docId = await sharedDoc(docTitle);
      await openForEditing(page, owner, docId);
      await typeInto(page, myText);

      // The colleague saves from the version everybody loaded, while the owner types.
      const loaded = await api.getDocument(colleague, docId);
      await api.updateDocument(
        colleague,
        docId,
        body('Rewritten by the colleague'),
        loaded.document.versionCount,
      );

      await save(page);
      await expect(page.getByTestId('doc-conflict-banner')).toBeVisible({ timeout: 15_000 });
    });

    test('the save is refused with a notice that says someone else changed the document', async ({ page }, testInfo) => {
      // FR-004
      await stepScreenshot(page, testInfo, 'conflict-notice');
      await expect(page.getByTestId('doc-conflict-banner')).toContainText('changed this document');
      await expect(page.getByTestId('doc-conflict-banner')).toContainText('was not applied');
    });

    test('the notice names the colleague who saved and when', async ({ page }) => {
      // FR-006, SC-004
      const banner = page.getByTestId('doc-conflict-banner');
      // createTestEmployee registers everyone as "Test Employee"; the banner shows the
      // display name the version history would show for the same save.
      await expect(banner).toContainText('Test Employee');
      // A date or time is always present alongside the name.
      await expect(banner).toContainText(/\d/);
    });

    test('the notice reads differently from an ordinary save failure', async ({ page }) => {
      // FR-004 — a conflict is its own banner with its own recovery actions, not the
      // generic save-error alert.
      await expect(page.getByTestId('doc-save-error')).toHaveCount(0);
      await expect(page.getByTestId('doc-conflict-reload')).toBeVisible();
      await expect(page.getByTestId('doc-conflict-copy')).toBeVisible();
    });

    test('the text the person typed is still in the editor', async ({ page }) => {
      // FR-010, SC-002
      await expect(page.getByTestId('doc-content-editor')).toContainText(myText);
    });

    test('the document is not silently replaced with the colleague’s version', async ({ page }) => {
      // FR-010
      await expect(page.getByTestId('doc-content-editor')).not.toContainText('Rewritten by the colleague');
    });
  });

  // ---------------------------------------------------------------------------
  test.describe('when the person chooses not to reload yet', () => {
    let docId: string;
    const docTitle = `Decline Reload Doc ${crypto.randomUUID().slice(0, 8)}`;
    const myText = 'My draft that I am not giving up';

    test.beforeEach(async ({ page }) => {
      docId = await sharedDoc(docTitle);
      await openForEditing(page, owner, docId);
      await typeInto(page, myText);
      const loaded = await api.getDocument(colleague, docId);
      await api.updateDocument(colleague, docId, body('Colleague version'), loaded.document.versionCount);
      await save(page);
      await expect(page.getByTestId('doc-conflict-banner')).toBeVisible({ timeout: 15_000 });
    });

    test('they can keep editing and their text is not discarded', async ({ page }, testInfo) => {
      // US2-3
      await typeInto(page, `${myText} and one more sentence`);
      await stepScreenshot(page, testInfo, 'kept-editing-after-conflict');
      await expect(page.getByTestId('doc-content-editor')).toContainText('and one more sentence');
      await expect(page.getByTestId('doc-content-editor')).not.toContainText('Colleague version');
    });

    test('they can copy their changes out of the editor', async ({ page, context }) => {
      // SC-003
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.getByTestId('doc-conflict-copy').click();
      await expect(page.getByTestId('doc-conflict-copy')).toContainText('Copied');

      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboard).toContain(myText);
    });
  });

  // ---------------------------------------------------------------------------
  test.describe('when the person chooses to load the current version', () => {
    let docId: string;
    const docTitle = `Reload Doc ${crypto.randomUUID().slice(0, 8)}`;
    const myText = 'My unsaved sentence';
    const theirText = 'The colleague’s current sentence';

    test.beforeEach(async ({ page }) => {
      docId = await sharedDoc(docTitle);
      await openForEditing(page, owner, docId);
      await typeInto(page, myText);
      const loaded = await api.getDocument(colleague, docId);
      await api.updateDocument(colleague, docId, body(theirText), loaded.document.versionCount);
      await save(page);
      await expect(page.getByTestId('doc-conflict-banner')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('doc-conflict-reload').click();
      await expect(page.getByTestId('doc-conflict-banner')).toHaveCount(0, { timeout: 15_000 });
    });

    test('the editor shows the colleague’s current content', async ({ page }, testInfo) => {
      // US2-2
      await stepScreenshot(page, testInfo, 'loaded-current-version');
      await expect(page.getByTestId('doc-content-editor')).toContainText(theirText);
    });

    test('re-applying their change and saving succeeds', async ({ page }) => {
      // FR-012, SC-003
      await typeInto(page, `${theirText} plus ${myText}`);
      await save(page);
      await expect(page.getByTestId('doc-conflict-banner')).toHaveCount(0);
      await expect(page.getByTestId('doc-save-error')).toHaveCount(0);

      const stored = await api.getDocument(owner, docId);
      expect(stored.document.contentJson).toContain(myText);
    });

    test('the conflict notice is gone after the successful save', async ({ page }) => {
      await typeInto(page, `${theirText} — reviewed`);
      await save(page);
      await expect(page.getByTestId('doc-conflict-banner')).toHaveCount(0);
    });
  });

  // ---------------------------------------------------------------------------
  test.describe('when the same person has the document open in two tabs', () => {
    test('the second tab’s save is refused just like a colleague’s', async ({ page, context }, testInfo) => {
      // Edge case: the rule is per-document, not per-person.
      const docTitle = `Two Tabs Doc ${crypto.randomUUID().slice(0, 8)}`;
      const created = await api.createDocument(owner, { title: docTitle, contentJson: body('Original text') });
      const docId = created.document.id;

      await openForEditing(page, owner, docId);
      await typeInto(page, 'Written in the first tab');

      const secondTab = await context.newPage();
      await secondTab.goto('/workspace/docs');
      await expect(secondTab.getByTestId('workspace-docs-page')).toBeVisible();
      await secondTab.getByTestId(`doc-tree-item-${docId}`).click();
      await secondTab.getByTestId('doc-edit-toggle-btn').click();
      await typeInto(secondTab, 'Written in the second tab');

      await save(page);
      await expect(page.getByTestId('doc-conflict-banner')).toHaveCount(0, { timeout: 15_000 });

      await save(secondTab);
      await stepScreenshot(secondTab, testInfo, 'second-tab-conflict');
      await expect(secondTab.getByTestId('doc-conflict-banner')).toBeVisible({ timeout: 15_000 });
      await expect(secondTab.getByTestId('doc-content-editor')).toContainText('Written in the second tab');

      await secondTab.close();
    });
  });

  // ---------------------------------------------------------------------------
  test.describe('when a person edits, switches away from the tab and comes back', () => {
    // Guards the pre-existing refetch-on-focus hole this feature closes (research D7).
    test.setTimeout(120_000);

    test('their unsaved text is still in the editor', async ({ page }, testInfo) => {
      // FR-010
      const docTitle = `Refocus Doc ${crypto.randomUUID().slice(0, 8)}`;
      const created = await api.createDocument(owner, { title: docTitle, contentJson: body('Original text') });
      const docId = created.document.id;

      await openForEditing(page, owner, docId);
      await typeInto(page, 'Half a thought I have not saved');

      // Somebody else changes the document while this tab is in the background, so the
      // refetch on focus returns different content from what the editor holds.
      await api.setDocumentAccess(owner, docId, colleague.id, 'ACCESS_LEVEL_WRITE_UPDATE');
      const loaded = await api.getDocument(colleague, docId);
      await api.updateDocument(colleague, docId, body('Server moved on'), loaded.document.versionCount);

      // Stay away long enough for the document query to go stale: DocumentView fetches
      // with staleTime 30s, and refetchOnWindowFocus only refetches stale data, so a
      // shorter wait would never trigger the refetch this test exists to guard against.
      await page.waitForTimeout(32_000);

      // Headless Chromium does not raise a real visibilitychange for bringToFront, so
      // the tab switch is driven through the same document event TanStack Query's focus
      // manager listens to in production.
      const setVisibility = (state: string) => {
        Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
        // TanStack Query v5's focus manager listens on window, not document.
        window.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
      };
      await page.evaluate(setVisibility, 'hidden');
      const refetched = page.waitForResponse(
        (r) => r.url().includes('/rpc.v1.DocumentService/GetDocument'),
        { timeout: 20_000 },
      );
      await page.evaluate(setVisibility, 'visible');
      await refetched;
      await page.waitForTimeout(1_000);

      await stepScreenshot(page, testInfo, 'draft-survives-refocus');
      await expect(page.getByTestId('doc-content-editor')).toContainText('Half a thought I have not saved');
      await expect(page.getByTestId('doc-content-editor')).not.toContainText('Server moved on');
    });
  });

  // ---------------------------------------------------------------------------
  test.describe('when one person edits a document alone', () => {
    test('saving works exactly as before, with no extra step', async ({ page }, testInfo) => {
      // SC-005
      const docTitle = `Solo Doc ${crypto.randomUUID().slice(0, 8)}`;
      const created = await api.createDocument(owner, { title: docTitle, contentJson: body('Original text') });
      const docId = created.document.id;

      await openForEditing(page, owner, docId);
      await typeInto(page, 'A quiet edit nobody is racing me for');
      await save(page);

      await expect(page.getByTestId('doc-conflict-banner')).toHaveCount(0);
      await expect(page.getByTestId('doc-save-error')).toHaveCount(0);
      await stepScreenshot(page, testInfo, 'solo-save');

      const stored = await api.getDocument(owner, docId);
      expect(stored.document.contentJson).toContain('A quiet edit nobody is racing me for');
    });

    test('a second consecutive save from the same session is also accepted', async ({ page }) => {
      // FR-001 — the session advances its base version from every successful save.
      const docTitle = `Repeat Save Doc ${crypto.randomUUID().slice(0, 8)}`;
      const created = await api.createDocument(owner, { title: docTitle, contentJson: body('Original text') });
      const docId = created.document.id;

      await openForEditing(page, owner, docId);
      await typeInto(page, 'First save from this session');
      await save(page);
      await expect(page.getByTestId('doc-conflict-banner')).toHaveCount(0);

      await typeInto(page, 'Second save from the same session');
      await save(page);
      await expect(page.getByTestId('doc-conflict-banner')).toHaveCount(0);
      await expect(page.getByTestId('doc-save-error')).toHaveCount(0);

      const stored = await api.getDocument(owner, docId);
      expect(stored.document.contentJson).toContain('Second save from the same session');
    });
  });
});
