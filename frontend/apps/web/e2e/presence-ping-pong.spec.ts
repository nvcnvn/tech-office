/**
 * Presence Ping-Pong E2E Tests
 *
 * Behavioral contract:
 *   specs/033-presence-ping-pong/contracts/integration-scenarios.md (Web E2E scenarios)
 *
 * Pattern: Arrange via API, Act via the real browser client, Assert via API reads and
 * network interception. The point of these tests is that the shipped client actually
 * honours the protocol: it answers challenges, reports context changes, and announces
 * departures — none of which a backend test can observe.
 */
import { test, expect, type Page } from '@playwright/test';
import { createTestOrg, createTestEmployee, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';

const API_BASE = process.env.E2E_API_URL || 'http://localhost:18080';

/** Mirrors RESPONSIVE_WINDOW_SECONDS in packages/apis/src/presence.ts. */
const RESPONSIVE_WINDOW_MS = 45_000;
/** Mirrors PING_INTERVAL_SECONDS. */
const PING_INTERVAL_MS = 20_000;

interface PresenceView {
	status: string;
	activeChannelId?: string;
}

/** Read a colleague's presence the way the product does. */
async function getPresence(viewer: TestUser, employeeId: string): Promise<PresenceView> {
	const res = await fetch(`${API_BASE}/rpc.v1.NotificationService/GetEmployeePresence`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${viewer.token}`,
		},
		body: JSON.stringify({ employeeId }),
	});
	expect(res.ok).toBeTruthy();
	const body = (await res.json()) as { presence?: { status?: string; activeChannelId?: string } };
	return {
		status: body.presence?.status ?? 'PRESENCE_STATUS_UNSPECIFIED',
		activeChannelId: body.presence?.activeChannelId,
	};
}

/** Poll a presence read until it satisfies `predicate`, or fail after `timeout`. */
async function waitForPresence(
	viewer: TestUser,
	employeeId: string,
	predicate: (p: PresenceView) => boolean,
	timeout: number,
	label: string,
): Promise<PresenceView> {
	const deadline = Date.now() + timeout;
	let last: PresenceView = { status: 'never-read' };
	while (Date.now() < deadline) {
		last = await getPresence(viewer, employeeId);
		if (predicate(last)) {
			return last;
		}
		await new Promise((r) => setTimeout(r, 1_000));
	}
	throw new Error(`${label}: gave up after ${timeout}ms, last presence was ${JSON.stringify(last)}`);
}

/** Open the workspace as a user and wait until their client has answered a challenge. */
async function openWorkspace(page: Page, user: TestUser, viewer: TestUser): Promise<void> {
	await loginAs(page, user);
	await page.goto('/workspace/');
	await waitForPresence(
		viewer,
		user.id,
		(p) => p.status === 'PRESENCE_STATUS_ONLINE',
		PING_INTERVAL_MS + 15_000,
		'client never reported itself present',
	);
}

test.describe('presence ping-pong', () => {
	let owner: TestUser;
	let subject: TestUser;
	let viewer: TestUser;

	test.beforeAll(async () => {
		owner = await createTestOrg();
		subject = await createTestEmployee(owner);
		viewer = await createTestEmployee(owner);
	});

	// US2, FR-001/002
	test('a signed-in user appears online to a colleague', async ({ page }) => {
		test.setTimeout(90_000);

		await openWorkspace(page, subject, viewer);

		const presence = await getPresence(viewer, subject.id);
		expect(presence.status).toBe('PRESENCE_STATUS_ONLINE');
	});

	// US3, FR-002
	test("switching channels updates the user's active context", async ({ page }) => {
		test.setTimeout(90_000);

		const channelSlug = `presence-ctx-${crypto.randomUUID().slice(0, 8)}`;
		const created = await api.createChannel(owner, {
			titleSlug: channelSlug,
			displayName: `Presence Ctx ${channelSlug.slice(-8)}`,
		});
		const channelId = created.channel.id;
		await api.inviteMember(owner, channelId, subject.id);

		await openWorkspace(page, subject, viewer);
		await page.goto(`/workspace/chat?channel=${channelId}`);

		const presence = await waitForPresence(
			viewer,
			subject.id,
			(p) => p.activeChannelId === channelId,
			30_000,
			'active channel never reached the server',
		);
		expect(presence.activeChannelId).toBe(channelId);
	});

	// US3, FR-004
	test('going idle is reflected to a colleague without a page reload', async ({ page }) => {
		test.setTimeout(90_000);

		await openWorkspace(page, subject, viewer);

		// The idle timer is five minutes, which no test budget can wait out. This drives
		// the same unsolicited-pong path idle uses — a state change the user causes,
		// reported between challenges — via the window blur transition.
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));

		const presence = await waitForPresence(
			viewer,
			subject.id,
			(p) => p.status !== 'PRESENCE_STATUS_ONLINE',
			30_000,
			'state change never reached the server between pings',
		);
		expect(presence.status).not.toBe('PRESENCE_STATUS_ONLINE');
		// No reload happened: the page is still the one we opened.
		expect(page.url()).toContain('/workspace');
	});

	// US3, FR-005
	test('closing the tab marks the user offline promptly', async ({ page }) => {
		test.setTimeout(120_000);

		await openWorkspace(page, subject, viewer);
		await page.close();

		// Promptly means "without waiting out the responsive window". A departing pong
		// is best-effort, so allow the window as the backstop the protocol promises.
		const presence = await waitForPresence(
			viewer,
			subject.id,
			(p) => p.status === 'PRESENCE_STATUS_OFFLINE',
			RESPONSIVE_WINDOW_MS + 20_000,
			'a closed tab still read as present',
		);
		expect(presence.status).toBe('PRESENCE_STATUS_OFFLINE');
	});

	// US1/US2, FR-007/008
	test('a colleague whose stream is severed appears offline within a minute', async ({ page }) => {
		test.setTimeout(150_000);

		// Let the client establish itself, then block the pong so it can never answer
		// again while the page stays open. This is the sleeping-laptop case: nothing
		// server-side may refresh liveness on the client's behalf.
		await openWorkspace(page, subject, viewer);
		await page.route('**/rpc.v1.NotificationService/PresencePong', (route) => route.abort());

		const startedAt = Date.now();
		const presence = await waitForPresence(
			viewer,
			subject.id,
			(p) => p.status === 'PRESENCE_STATUS_OFFLINE',
			RESPONSIVE_WINDOW_MS + 30_000,
			'a client that stopped answering still read as present',
		);

		expect(presence.status).toBe('PRESENCE_STATUS_OFFLINE');
		expect(Date.now() - startedAt).toBeLessThan(70_000);
	});

	// US4, FR-019 — assert via network interception
	test('the app never calls the removed presence update endpoint', async ({ page }) => {
		test.setTimeout(90_000);

		const removedCalls: string[] = [];
		page.on('request', (request) => {
			if (request.url().includes('UpdatePresenceStatus')) {
				removedCalls.push(request.url());
			}
		});

		await openWorkspace(page, subject, viewer);
		// Exercise the paths that used to post presence: a context change and a
		// visibility change.
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await page.waitForTimeout(3_000);

		expect(removedCalls, 'a call site for the removed endpoint survived').toEqual([]);
	});
});
