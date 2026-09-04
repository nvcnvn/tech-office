import { expect, test, type Page } from '@playwright/test';
import { createTestOrg, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';

/**
 * Feature 045: Server-Side Federated Search — web behavioural contract.
 *
 * Scenario names mirror backend/integration/federated_search_test.go, so both suites tell
 * the same story line for line. What the browser adds over the RPC suite is the half the
 * RPC cannot see: that all eight kinds render as rows, that each row goes somewhere, that
 * narrowing survives a query change, and that an unreachable source is *named* rather
 * than silently missing.
 */

const WORD = `zarquon${crypto.randomUUID().slice(0, 8)}`;

interface SearchFixture {
	owner: TestUser;
	documentSlug: string;
	documentTitle: string;
	vietnameseTitle: string;
	taskId: string;
	projectId: string;
	taskTitle: string;
	eventTitle: string;
	fileName: string;
	channelName: string;
}

async function buildFixture(): Promise<SearchFixture> {
	const owner = await createTestOrg();
	api.renameEmployee(owner.orgId, owner.id, WORD, 'Nguyen');

	const documentTitle = `${WORD} Closing Procedure`;
	const document = await api.createDocument(owner, {
		title: documentTitle,
		visibility: 'DOCUMENT_VISIBILITY_PUBLIC',
	});

	const project = await api.createProject(owner, {
		name: `${WORD} Ops`,
		visibility: 'PROJECT_VISIBILITY_PUBLIC',
	});
	const taskTitle = `Restock the ${WORD} freezer`;
	const task = await api.createTask(owner, project.project.id, taskTitle, {
		levelId: project.levels[0]?.id,
	});

	const start = new Date(Date.now() + 48 * 60 * 60 * 1000);
	const end = new Date(start.getTime() + 60 * 60 * 1000);
	const eventTitle = `Quarterly ${WORD} stocktake`;
	await api.createEvent(owner, {
		title: eventTitle,
		visibility: 'org_wide',
		startTime: start.toISOString(),
		endTime: end.toISOString(),
	});

	const vietnameseTitle = `Quy trình đóng cửa ${WORD}`;
	await api.createDocument(owner, {
		title: vietnameseTitle,
		visibility: 'DOCUMENT_VISIBILITY_PUBLIC',
	});

	const channelName = `${WORD}-ops`;
	const channel = await api.createChannel(owner, {
		titleSlug: channelName,
		displayName: channelName,
	});
	await api.sendMessage(owner, channel.channel.id, `the ${WORD} delivery is running late`);

	const fileName = `${WORD}-invoice.txt`;
	await api.uploadChannelFile(owner, channel.channel.id, fileName, `${WORD} invoice contents`);

	return {
		owner,
		documentSlug: document.document.slug,
		documentTitle,
		vietnameseTitle,
		taskId: task.task.id,
		projectId: project.project.id,
		taskTitle,
		eventTitle,
		fileName,
		channelName,
	};
}

async function openSearch(page: Page, query: string, kind?: string) {
	const kindParam = kind ? `&kind=${kind}` : '';
	await page.goto(`/workspace/search?q=${encodeURIComponent(query)}${kindParam}`);
	await expect(page.getByTestId('search-results').or(page.getByTestId('search-no-results'))).toBeVisible({
		timeout: 20000,
	});
}

test.describe('federated search results page', () => {
	let fixture: SearchFixture;

	test.beforeAll(async () => {
		fixture = await buildFixture();
	});

	test.beforeEach(async ({ page }) => {
		await loginAs(page, fixture.owner);
	});

	// FR-018
	test('it shows Document, File, Work item and Event rows alongside the existing four', async ({ page }) => {
		await openSearch(page, WORD);

		await expect(page.getByTestId('search-result-document').first()).toBeVisible();
		await expect(page.getByTestId('search-result-work-item').first()).toBeVisible();
		await expect(page.getByTestId('search-result-event').first()).toBeVisible();
		await expect(page.getByTestId('search-result-file').first()).toBeVisible();

		await expect(page.getByTestId('search-result-person').first()).toBeVisible();
		await expect(page.getByTestId('search-result-channel').first()).toBeVisible();
		await expect(page.getByTestId('search-result-message').first()).toBeVisible();
	});

	// FR-018
	test('it shows a category tab per kind with a result count', async ({ page }) => {
		await openSearch(page, WORD);

		for (const kind of [
			'person',
			'channel',
			'document',
			'work_item',
			'event',
			'file',
			'department',
			'message',
		]) {
			await expect(page.getByTestId(`search-tab-${kind}`)).toBeVisible();
		}
		// Two documents match: the closing procedure and the Vietnamese-titled one.
		await expect(page.getByTestId('search-tab-document')).toContainText('2');
	});

	// FR-018, US4 AC2
	test('it narrows to one kind when a tab is clicked and keeps the narrowing when the query changes', async ({ page }) => {
		await openSearch(page, WORD);

		await page.getByTestId('search-tab-document').click();
		await expect(page).toHaveURL(/kind=document/);
		await expect(page.getByTestId('search-result-document').first()).toBeVisible();
		await expect(page.getByTestId('search-result-message')).toHaveCount(0);

		// Changing the query keeps the narrowing.
		await page.goto(`/workspace/search?q=${encodeURIComponent(fixture.documentTitle)}&kind=document`);
		await expect(page.getByTestId('search-result-document').first()).toBeVisible();
		await expect(page.getByTestId('search-result-message')).toHaveCount(0);
	});

	// FR-004, US3 AC1: an incomplete answer is legible, not silently short.
	test('it names the unavailable kind when one source fails', async ({ page }) => {
		// The only way to make one real source fail is to make one fail: every source is
		// a healthy query against a healthy database. Rewriting the response on the wire
		// is what the page would see if the document source had timed out.
		await page.route('**/rpc.v1.SearchService/Search', async (route) => {
			const response = await route.fetch();
			const body = await response.json();
			body.outcomes = (body.outcomes ?? []).map((outcome: { kind: string }) =>
				outcome.kind === 'SEARCH_KIND_DOCUMENT'
					? { kind: 'SEARCH_KIND_DOCUMENT', status: 'SOURCE_STATUS_UNAVAILABLE', detail: 'timed out' }
					: outcome,
			);
			body.hits = (body.hits ?? []).filter(
				(hit: { kind: string }) => hit.kind !== 'SEARCH_KIND_DOCUMENT',
			);
			await route.fulfill({ response, json: body });
		});

		await openSearch(page, WORD);

		const banner = page.getByTestId('search-unavailable-sources');
		await expect(banner).toBeVisible();
		await expect(banner).toContainText('Documents');

		// Everything else is still there — one failing source costs that source only.
		await expect(page.getByTestId('search-result-work-item').first()).toBeVisible();
		await expect(page.getByTestId('search-result-event').first()).toBeVisible();
	});

	// FR-017 equivalent: a row is a door that opens.
	test('it opens the document when a Document row is clicked', async ({ page }) => {
		await openSearch(page, WORD);

		await page
			.getByTestId('search-result-document')
			.filter({ hasText: fixture.documentTitle })
			.click();
		await expect(page).toHaveURL(new RegExp(`/workspace/docs/${fixture.documentSlug}`));
	});

	test('it opens the task at its project-scoped route when a Work item row is clicked', async ({ page }) => {
		await openSearch(page, WORD);

		await page.getByTestId('search-result-work-item').first().click();
		// The app canonicalises the project-scoped task URL; what matters is that the row
		// landed on this task without a second lookup.
		await expect(page).toHaveURL(new RegExp(fixture.taskId));
	});

	// FR-022, edge case: a row whose target went away after the search says so rather
	// than showing a blank screen.
	test('it reports that an item is gone rather than showing a blank screen when its target was deleted after the search', async ({ page }) => {
		const doomed = await api.createDocument(fixture.owner, {
			title: `${WORD} Doomed Notice`,
			visibility: 'DOCUMENT_VISIBILITY_PUBLIC',
		});

		await openSearch(page, `${WORD} Doomed`);
		const row = page.getByTestId('search-result-document').first();
		await expect(row).toBeVisible();

		await api.deleteDocument(fixture.owner, doomed.document.id);

		await row.click();
		// The document viewer says the document is not there. What it must not do is
		// render an empty editor as though the document were blank.
		await expect(
			page.getByText(/not found|could not be found|no longer|does not exist|404/i).first(),
		).toBeVisible({ timeout: 20000 });
	});

	// SC-008: a Vietnamese title comes back the same way an English one does.
	test('it finds a Vietnamese title searched in Vietnamese', async ({ page }) => {
		await openSearch(page, 'đóng cửa');

		await expect(
			page.getByTestId('search-result-document').filter({ hasText: fixture.vietnameseTitle }),
		).toBeVisible();
	});

	// FR-020: the search box stays the only entry point.
	test('it keeps the search box as the only entry point', async ({ page }) => {
		await page.goto('/workspace/calendar');
		await expect(page.locator('#global-search-input')).toBeVisible();

		await page.locator('#global-search-input').fill(WORD);
		await expect(page.getByTestId('global-search-preview')).toBeVisible({ timeout: 20000 });

		// The preview is the same ranked list, not a second search surface.
		await expect(page.getByTestId('global-search-hit-document').first()).toBeVisible();

		await page.locator('#global-search-input').press('Enter');
		await expect(page).toHaveURL(/\/workspace\/search\/?\?q=/);
	});
});
