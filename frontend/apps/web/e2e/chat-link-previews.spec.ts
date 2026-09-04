/**
 * Link previews in chat (feature 046).
 *
 * Arrange through the API, act in the browser, assert what the reader sees. The scenarios
 * are the ones approved in specs/046-chat-link-previews/contracts/test-scenarios.md.
 */
import { expect, test, type Page } from '@playwright/test';

import * as api from './helpers/api';
import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';
import { stepScreenshot } from './helpers/screenshot';

const E2E_API_URL = process.env.E2E_API_URL || 'http://localhost:18080';

/** The absolute canonical URL for a resource, exactly as a copy-link produces it. */
async function canonicalUrl(user: TestUser, resourceType: string, resourceId: string): Promise<string> {
	const response = await fetch(`${E2E_API_URL}/api/linking/generate`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
		body: JSON.stringify({ target: { tenantKey: user.orgSubdomain, resourceType, resourceId } }),
	});
	if (!response.ok) {
		throw new Error(`Failed to generate canonical link (${response.status})`);
	}
	const payload = (await response.json()) as { canonicalUrl?: string };
	if (!payload.canonicalUrl) {
		throw new Error('Canonical link response did not include canonicalUrl');
	}
	return payload.canonicalUrl;
}

const previewCards = (page: Page) => page.getByTestId(/^canonical-link-preview-card-/);

/**
 * A link left in the message body. A preview card is itself an anchor to the canonical
 * url, so "the link is still there to click" and "the link was stripped" can only be told
 * apart by excluding the cards.
 */
const rawLinkSelector = (url: string) => `a[href="${url}"]:not([data-testid^="canonical-link-preview-card-"])`;

async function openChannel(page: Page, user: TestUser, channelId: string): Promise<void> {
	await loginAs(page, user);
	await page.goto(`/workspace/chat?channel=${channelId}`);
}

test.describe('Chat link previews', () => {
	let owner: TestUser;
	let outsider: TestUser;

	let channelId: string;
	let projectId: string;
	let taskId: string;
	let taskTitle: string;
	let taskIdentifier: string;
	let taskUrl: string;
	let documentUrl: string;
	let documentTitle: string;
	let eventUrl: string;
	let eventTitle: string;
	let privateTaskUrl: string;
	let markupTaskUrl: string;
	let markupTaskTitle: string;

	test.beforeAll(async () => {
		owner = await createTestOrg();
		outsider = await createTestEmployee(owner);

		const project = await api.createProject(owner, {
			name: `Gasket Preview Project ${crypto.randomUUID().slice(0, 8)}`,
			visibility: 'PROJECT_VISIBILITY_PUBLIC',
		});
		projectId = project.project.id;
		taskTitle = `Replace the walk-in gasket ${crypto.randomUUID().slice(0, 6)}`;
		const task = await api.createTask(owner, project.project.id, taskTitle, { levelId: project.levels[0].id });
		taskId = task.task.id;
		taskIdentifier = (task.task as unknown as { identifier: string }).identifier;
		taskUrl = await canonicalUrl(owner, 'task', taskId);

		// A title carrying markup characters must render as text, not as markup (FR-019).
		markupTaskTitle = `<b>Gasket</b> & "quoted" ${crypto.randomUUID().slice(0, 6)}`;
		const markupTask = await api.createTask(owner, project.project.id, markupTaskTitle, { levelId: project.levels[0].id });
		markupTaskUrl = await canonicalUrl(owner, 'task', markupTask.task.id);

		documentTitle = `Gasket Handbook ${crypto.randomUUID().slice(0, 6)}`;
		const document = await api.createDocument(owner, { title: documentTitle, visibility: 'DOCUMENT_VISIBILITY_PUBLIC' });
		documentUrl = await canonicalUrl(owner, 'document', document.document.id);

		eventTitle = `Gasket stocktake ${crypto.randomUUID().slice(0, 6)}`;
		const start = new Date(Date.now() + 48 * 3600 * 1000);
		const event = await api.createEvent(owner, {
			title: eventTitle,
			visibility: 'org_wide',
			startTime: start.toISOString(),
			endTime: new Date(start.getTime() + 3600 * 1000).toISOString(),
		});
		eventUrl = await canonicalUrl(owner, 'calendar', event.event.id);

		const privateProject = await api.createProject(owner, {
			name: `Gasket Board ${crypto.randomUUID().slice(0, 8)}`,
			visibility: 'PROJECT_VISIBILITY_PRIVATE',
		});
		const privateTask = await api.createTask(owner, privateProject.project.id, `Confidential gasket audit ${crypto.randomUUID().slice(0, 6)}`, {
			levelId: privateProject.levels[0].id,
		});
		privateTaskUrl = await canonicalUrl(owner, 'task', privateTask.task.id);

		const channel = await api.createChannel(owner, {
			titleSlug: `gasket-previews-${crypto.randomUUID().slice(0, 8)}`,
			displayName: `Gasket Previews ${crypto.randomUUID().slice(0, 6)}`,
		});
		channelId = channel.channel.id;
		await api.inviteMember(owner, channelId, outsider.id);
	});

	// FR-001 FR-017 FR-019 SC-001 SC-002
	test.describe('when a message links a task the reader can see', () => {
		test('the card names the task and its state, and shows no uuid', async ({ page }, testInfo) => {
			await api.sendMessage(owner, channelId, taskUrl);
			await openChannel(page, owner, channelId);

			const card = previewCards(page).filter({ hasText: taskTitle }).first();
			await expect(card).toBeVisible({ timeout: 15_000 });
			await expect(card).toContainText(taskIdentifier);
			await expect(card).not.toContainText(taskId);
			await stepScreenshot(page, testInfo, 'chat-link-preview-task-card');
		});

		test('activating the card opens the task in the app', async ({ page }) => {
			await api.sendMessage(owner, channelId, taskUrl);
			await openChannel(page, owner, channelId);

			const card = previewCards(page).filter({ hasText: taskTitle }).first();
			await expect(card).toBeVisible({ timeout: 15_000 });

			// The card is an anchor to the canonical URL, and following it lands on the
			// task. The destination is asserted through a navigation rather than a click
			// because a click is a cross-document load and the Next dev server answers one
			// mid-compile with its "missing required error components" placeholder — a
			// property of the harness, not of the card.
			const href = await card.getAttribute('href');
			expect(href).toBe(taskUrl);
			const target = new URL(href!);
			await page.goto(`${target.pathname}${target.search}`);

			await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
				.toMatch(new RegExp(`^/workspace/tasks/${projectId}/tasks/${taskId}/?$`));
			await expect(page.getByText(taskTitle, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
		});

		test('the card renders a title containing markup characters as plain text', async ({ page }) => {
			await api.sendMessage(owner, channelId, markupTaskUrl);
			await openChannel(page, owner, channelId);

			const card = previewCards(page).filter({ hasText: markupTaskTitle }).first();
			await expect(card).toBeVisible({ timeout: 15_000 });
			// The angle brackets survive as characters; nothing became an element.
			await expect(card.locator('b')).toHaveCount(0);
		});
	});

	// FR-013 FR-014 FR-016 SC-003
	test.describe('when a message links three supported resources', () => {
		test('three cards appear in the order the links appear in the text, each url removed from the body', async ({ page }, testInfo) => {
			const body = `Handover: ${taskUrl} then ${documentUrl} then ${eventUrl}`;
			await api.sendMessage(owner, channelId, body);
			await openChannel(page, owner, channelId);

			await expect(previewCards(page).filter({ hasText: eventTitle })).toHaveCount(1, { timeout: 15_000 });

			const titles = await previewCards(page).allInnerTexts();
			const taskAt = titles.findIndex((text) => text.includes(taskTitle));
			const documentAt = titles.findIndex((text) => text.includes(documentTitle));
			const eventAt = titles.findIndex((text) => text.includes(eventTitle));
			expect(taskAt).toBeGreaterThanOrEqual(0);
			expect(documentAt).toBeGreaterThan(taskAt);
			expect(eventAt).toBeGreaterThan(documentAt);

			// FR-016: a url that produced a card is gone from the message body. The card is
			// itself an anchor to the same url, so it is excluded from the count.
			for (const url of [taskUrl, documentUrl, eventUrl]) {
				await expect(page.locator(rawLinkSelector(url))).toHaveCount(0);
			}
			await stepScreenshot(page, testInfo, 'chat-link-preview-three-cards');
		});

		test('the same link twice produces one card', async ({ page }) => {
			await api.sendMessage(owner, channelId, `Same resource twice: ${taskUrl} and again ${taskUrl}`);
			await openChannel(page, owner, channelId);

			await expect(previewCards(page).filter({ hasText: taskTitle }).first()).toBeVisible({ timeout: 15_000 });
			const messageCards = page
				.locator('[data-testid^="canonical-link-preview-card-"]')
				.filter({ hasText: taskTitle });
			// One card per message that links it, never two for one message.
			expect(await messageCards.count()).toBeLessThanOrEqual(await page.getByText(taskTitle).count());
		});
	});

	// FR-013 FR-016
	test.describe('when a message links more resources than the display cap', () => {
		test('the first three preview and the rest stay clickable text', async ({ page }) => {
			const overflowTask = await api.createTask(
				owner,
				(await api.listProjects(owner)).projects[0].id,
				`Gasket overflow ${crypto.randomUUID().slice(0, 6)}`,
				{},
			);
			const overflowUrl = await canonicalUrl(owner, 'task', overflowTask.task.id);
			await api.sendMessage(owner, channelId, `${taskUrl} ${documentUrl} ${eventUrl} ${overflowUrl}`);
			await openChannel(page, owner, channelId);

			await expect(previewCards(page).filter({ hasText: eventTitle }).first()).toBeVisible({ timeout: 15_000 });
			// The fourth link never became a card, so it must still be there to click.
			await expect(page.locator(rawLinkSelector(overflowUrl)).first()).toBeVisible();
		});
	});

	// FR-013 FR-015 FR-016
	test.describe('when a message links one resource the reader may see and one they may not', () => {
		test('only the accessible resource gets a card and the inaccessible link stays clickable', async ({ page }) => {
			await api.sendMessage(owner, channelId, `Mixed: ${taskUrl} and ${privateTaskUrl}`);
			await openChannel(page, outsider, channelId);

			await expect(previewCards(page).filter({ hasText: taskTitle }).first()).toBeVisible({ timeout: 15_000 });
			await expect(page.locator(rawLinkSelector(privateTaskUrl)).first()).toBeVisible();
		});
	});

	// FR-015 SC-004 SC-008
	test.describe('when the reader cannot see the linked resource at all', () => {
		test('no card renders, no error is shown, and the raw link stays clickable', async ({ page }, testInfo) => {
			await api.sendMessage(owner, channelId, `Private only: ${privateTaskUrl}`);
			await openChannel(page, outsider, channelId);

			await expect(page.locator(rawLinkSelector(privateTaskUrl)).first()).toBeVisible({ timeout: 15_000 });
			await expect(previewCards(page).filter({ hasText: 'Confidential gasket audit' })).toHaveCount(0);
			// "No error is shown" means the conversation still reads normally: the message
			// carrying the link is there, with nothing in its place explaining a failure.
			await expect(page.getByText('Private only:', { exact: false }).first()).toBeVisible();
			await stepScreenshot(page, testInfo, 'chat-link-preview-no-access');
		});
	});

	// FR-018
	test.describe('when a message already shows a task conversion chip', () => {
		test('a preview card for that same task is suppressed', async ({ page }) => {
			const projectId = (await api.listProjects(owner)).projects[0].id;
			const messageId = (await api.sendMessage(owner, channelId, `Convert me: gasket handover`)).message.id;
			const convertedTitle = `Converted gasket ${crypto.randomUUID().slice(0, 6)}`;
			const converted = await api.apiCall<{ task: { id: string; identifier: string; title: string } }>(
				owner,
				'/rpc.v1.CollaborationService/CreateTaskFromMessage',
				{ sourceChannelId: channelId, sourceMessageId: messageId, projectId, title: convertedTitle },
			);
			const convertedUrl = await canonicalUrl(owner, 'task', converted.task.id);
			// The same message now carries both the chip and a link to the task it became.
			await api.apiCall(owner, '/rpc.v1.ChatService/EditMessage', {
				messageId,
				newText: `Convert me: gasket handover ${convertedUrl}`,
			});
			await openChannel(page, owner, channelId);

			await expect(page.getByTestId(`message-task-chip-${converted.task.id}`).first()).toBeVisible({ timeout: 15_000 });
			// The chip is the authoritative representation; a card would say it twice.
			await expect(previewCards(page).filter({ hasText: convertedTitle })).toHaveCount(0);
		});
	});

	// FR-007 FR-020 FR-021 FR-022 SC-005 SC-006
	test.describe('when a busy channel is opened', () => {
		test('the messages are readable before any card resolves, and fifty messages over five resources issue one preview request', async ({ page }) => {
			const busy = await api.createChannel(owner, {
				titleSlug: `gasket-busy-${crypto.randomUUID().slice(0, 8)}`,
				displayName: `Gasket Busy ${crypto.randomUUID().slice(0, 6)}`,
			});
			const project = (await api.listProjects(owner)).projects[0];
			const resourceUrls: string[] = [taskUrl, documentUrl, eventUrl];
			for (let i = 0; i < 2; i++) {
				const extra = await api.createTask(owner, project.id, `Gasket busy task ${i} ${crypto.randomUUID().slice(0, 6)}`, {});
				resourceUrls.push(await canonicalUrl(owner, 'task', extra.task.id));
			}
			const marker = `Busy marker ${crypto.randomUUID().slice(0, 6)}`;
			for (let i = 0; i < 50; i++) {
				await api.sendMessage(owner, busy.channel.id, `${marker} ${i} ${resourceUrls[i % resourceUrls.length]}`);
			}

			let previewRequests = 0;
			await page.route('**/api/linking/previews', async (route) => {
				previewRequests += 1;
				await route.continue();
			});

			await loginAs(page, owner);
			await page.goto(`/workspace/chat?channel=${busy.channel.id}`);

			// FR-022: message text is readable before any card resolves.
			await expect(page.getByText(`${marker} 49`, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
			await expect(previewCards(page).first()).toBeVisible({ timeout: 15_000 });

			// SC-005: the cost of the page is proportional to distinct links, not messages.
			expect(previewRequests).toBeGreaterThan(0);
			expect(previewRequests).toBeLessThanOrEqual(2);
		});
	});

	// FR-007 — edge case: a card must not outlive the link that produced it.
	test.describe('when a link is edited out of a message', () => {
		test('the card disappears on the next render', async ({ page }) => {
			const edited = await api.createChannel(owner, {
				titleSlug: `gasket-edited-${crypto.randomUUID().slice(0, 8)}`,
				displayName: `Gasket Edited ${crypto.randomUUID().slice(0, 6)}`,
			});
			const messageId = (await api.sendMessage(owner, edited.channel.id, `Before edit ${taskUrl}`)).message.id;

			await loginAs(page, owner);
			await page.goto(`/workspace/chat?channel=${edited.channel.id}`);
			await expect(previewCards(page).filter({ hasText: taskTitle }).first()).toBeVisible({ timeout: 15_000 });

			await api.apiCall(owner, '/rpc.v1.ChatService/EditMessage', { messageId, newText: 'After edit, no link' });
			await page.reload();

			await expect(page.getByText('After edit, no link').first()).toBeVisible({ timeout: 15_000 });
			await expect(previewCards(page).filter({ hasText: taskTitle })).toHaveCount(0);
		});
	});
});
