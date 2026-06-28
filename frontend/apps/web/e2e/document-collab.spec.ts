/**
 * Document Collaboration E2E Tests
 *
 * Behavioral scenarios derived from backend integration tests:
 *   - backend/integration/workflow_document_collab_test.go
 *   - backend/integration/docs_crud_test.go
 *   - backend/integration/docs_version_test.go
 *
 * Pattern: Arrange via API, Act via UI, Assert via UI.
 */
import { test, expect } from '@playwright/test';
import { createTestOrg, createTestEmployee, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';
import { stepScreenshot } from './helpers/screenshot';

test.describe('Document Collaboration', () => {
  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;

  test.beforeAll(async () => {
    owner = await createTestOrg();
    editor = await createTestEmployee(owner);
    viewer = await createTestEmployee(owner);
  });

  // ---------------------------------------------------------------------------
  // Scenario: when an author creates a document and shares it
  // ---------------------------------------------------------------------------

  test.describe('when an author creates a document and shares it', () => {
    let docId: string;
    const docTitle = `Design Doc ${crypto.randomUUID().slice(0, 8)}`;

    test.beforeAll(async () => {
      const resp = await api.createDocument(owner, { title: docTitle });
      docId = resp.document.id;

      // Share with editor (write access) and viewer (read-only)
      await api.setDocumentAccess(owner, docId, editor.id, 'ACCESS_LEVEL_WRITE_UPDATE');
      await api.setDocumentAccess(owner, docId, viewer.id, 'ACCESS_LEVEL_READ_COMMENT');
    });

    test('the document appears in the docs page for the author', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/docs');
      await expect(page.getByTestId('workspace-docs-page')).toBeVisible();
      await stepScreenshot(page, testInfo, 'author-sees-doc');
      await expect(page.getByText(docTitle)).toBeVisible();
    });

    test('the editor can see the document in the list', async ({ page }, testInfo) => {
      await loginAs(page, editor);
      await page.goto('/workspace/docs');
      await expect(page.getByTestId('workspace-docs-page')).toBeVisible();
      await stepScreenshot(page, testInfo, 'editor-sees-shared-doc');
      await expect(page.getByText(docTitle)).toBeVisible();
    });

    test('the viewer can see the document in the list', async ({ page }, testInfo) => {
      await loginAs(page, viewer);
      await page.goto('/workspace/docs');
      await expect(page.getByTestId('workspace-docs-page')).toBeVisible();
      await stepScreenshot(page, testInfo, 'viewer-sees-shared-doc');
      await expect(page.getByText(docTitle)).toBeVisible();
    });

    test('clicking a document opens the document editor/view', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/docs');
      await expect(page.getByTestId('workspace-docs-page')).toBeVisible();
      // Wait for doc tree to render
      await expect(page.getByTestId(`doc-tree-item-${docId}`)).toBeVisible({ timeout: 10_000 });
      await page.getByTestId(`doc-tree-item-${docId}`).click();
      await stepScreenshot(page, testInfo, 'doc-opened');

      // The document view should show the title
      await expect(page.getByText(docTitle)).toBeVisible();
    });

    test('the editor sees the edit toggle button', async ({ page }, testInfo) => {
      await loginAs(page, editor);
      await page.goto('/workspace/docs');
      await expect(page.getByTestId('workspace-docs-page')).toBeVisible();
      await expect(page.getByTestId(`doc-tree-item-${docId}`)).toBeVisible({ timeout: 10_000 });
      await page.getByTestId(`doc-tree-item-${docId}`).click();
      await stepScreenshot(page, testInfo, 'editor-has-edit-toggle');
      await expect(page.getByTestId('doc-edit-toggle-btn')).toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when the editor updates the document content
  // ---------------------------------------------------------------------------

  test.describe('when the editor updates the document content', () => {
    let updateDocId: string;
    const updateDocTitle = `Editable Doc ${crypto.randomUUID().slice(0, 8)}`;
    const updatedContent = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Updated by editor via API' }],
        },
      ],
    });

    test.beforeAll(async () => {
      const resp = await api.createDocument(owner, { title: updateDocTitle });
      updateDocId = resp.document.id;
      await api.setDocumentAccess(owner, updateDocId, editor.id, 'ACCESS_LEVEL_WRITE_UPDATE');

      // Editor updates content via API
      await api.updateDocument(editor, updateDocId, updatedContent);
    });

    test('the updated content is visible to the author', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/docs');
      await expect(page.getByTestId('workspace-docs-page')).toBeVisible();
      await expect(page.getByTestId(`doc-tree-item-${updateDocId}`)).toBeVisible({ timeout: 10_000 });
      await page.getByTestId(`doc-tree-item-${updateDocId}`).click();
      await stepScreenshot(page, testInfo, 'author-sees-updated-content');
      await expect(page.getByText('Updated by editor via API')).toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when the user follows and unfollows a document
  // ---------------------------------------------------------------------------

  test.describe('when a user follows a document', () => {
    let followDocId: string;
    const followDocTitle = `Follow Doc ${crypto.randomUUID().slice(0, 8)}`;

    test.beforeAll(async () => {
      const resp = await api.createDocument(owner, { title: followDocTitle });
      followDocId = resp.document.id;
      await api.setDocumentAccess(owner, followDocId, editor.id, 'ACCESS_LEVEL_WRITE_UPDATE');
    });

    test('the follow button is visible on the document page', async ({ page }, testInfo) => {
      await loginAs(page, editor);
      await page.goto('/workspace/docs');
      await expect(page.getByTestId('workspace-docs-page')).toBeVisible();
      await expect(page.getByTestId(`doc-tree-item-${followDocId}`)).toBeVisible({ timeout: 10_000 });
      await page.getByTestId(`doc-tree-item-${followDocId}`).click();
      await stepScreenshot(page, testInfo, 'doc-follow-btn-visible');
      await expect(page.getByTestId('doc-follow-btn')).toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when access is revoked
  // ---------------------------------------------------------------------------

  test.describe('when access is revoked', () => {
    let revokeDocId: string;
    const revokeDocTitle = `Revoke Doc ${crypto.randomUUID().slice(0, 8)}`;

    test.beforeAll(async () => {
      const resp = await api.createDocument(owner, { title: revokeDocTitle });
      revokeDocId = resp.document.id;
      await api.setDocumentAccess(owner, revokeDocId, viewer.id, 'ACCESS_LEVEL_READ_COMMENT');
    });

    test('the viewer can initially see the document', async ({ page }, testInfo) => {
      await loginAs(page, viewer);
      await page.goto('/workspace/docs');
      await stepScreenshot(page, testInfo, 'viewer-sees-doc-before-revoke');
      await expect(page.getByText(revokeDocTitle)).toBeVisible();
    });

    test('after revocation the viewer can no longer see the document', async ({ page }, testInfo) => {
      // Arrange: revoke access via API
      await api.setDocumentAccess(owner, revokeDocId, viewer.id, 'ACCESS_LEVEL_NONE');

      await loginAs(page, viewer);
      await page.goto('/workspace/docs');
      await stepScreenshot(page, testInfo, 'viewer-no-doc-after-revoke');
      await expect(page.getByText(revokeDocTitle)).not.toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario: when viewing version history
  // ---------------------------------------------------------------------------

  test.describe('when viewing version history', () => {
    let versionDocId: string;
    const versionDocTitle = `Version Doc ${crypto.randomUUID().slice(0, 8)}`;

    test.beforeAll(async () => {
      const resp = await api.createDocument(owner, { title: versionDocTitle });
      versionDocId = resp.document.id;

      // Create multiple versions via API
      await api.updateDocument(
        owner,
        versionDocId,
        JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Version 2 content' }] }],
        }),
      );
      await api.updateDocument(
        owner,
        versionDocId,
        JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Version 3 content' }] }],
        }),
      );
    });

    test('the history panel shows version entries', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/docs');
      await expect(page.getByTestId('workspace-docs-page')).toBeVisible();
      await expect(page.getByTestId(`doc-tree-item-${versionDocId}`)).toBeVisible({ timeout: 10_000 });
      await page.getByTestId(`doc-tree-item-${versionDocId}`).click();

      // Open history panel
      await page.getByTestId('doc-history-btn').click();
      await page.getByTestId('panel-history-tab').click();
      await stepScreenshot(page, testInfo, 'version-history-panel');

      // Version entries should be visible
      await expect(page.getByTestId('version-item-1')).toBeVisible();
    });
  });
});
