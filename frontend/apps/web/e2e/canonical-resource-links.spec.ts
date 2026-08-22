import { expect, test } from '@playwright/test';

import * as api from './helpers/api';
import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';
import { stepScreenshot } from './helpers/screenshot';

const E2E_API_URL = process.env.E2E_API_URL || 'http://localhost:18080';

async function expectCanonicalTaskDestination(page: Parameters<typeof test>[0] extends never ? never : any, projectId: string, taskId: string): Promise<void> {
	await expect
		.poll(() => {
			const currentUrl = new URL(page.url());
			return {
				pathname: currentUrl.pathname,
				focusIntent: currentUrl.searchParams.get('focusIntent'),
			};
		}, { timeout: 15_000 })
		.toEqual({
			pathname: `/workspace/tasks/${projectId}/tasks/${taskId}/`,
			focusIntent: 'review_pending',
		});
}

async function generateCanonicalTaskLink(user: TestUser, target: {
	tenantKey: string;
	resourceId: string;
	focusIntent?: string;
	requirementId?: string;
}, options?: { relative?: boolean }): Promise<string> {
	const response = await fetch(`${E2E_API_URL}/api/linking/generate`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${user.token}`,
		},
		body: JSON.stringify({
			target: {
				tenantKey: target.tenantKey,
				resourceType: 'task',
				resourceId: target.resourceId,
				focusIntent: target.focusIntent,
				requirementId: target.requirementId,
			},
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to generate canonical link (${response.status})`);
	}

	const payload = (await response.json()) as { canonicalUrl?: string };
	if (!payload.canonicalUrl) {
		throw new Error('Canonical link response did not include canonicalUrl');
	}

	if (options?.relative === false) {
		return payload.canonicalUrl;
	}

	const url = new URL(payload.canonicalUrl);
	return `${url.pathname}${url.search}`;
}

test.describe('Canonical Resource Links', () => {
	let owner: TestUser;
	let outsider: TestUser;
	let projectId: string;
	let taskId: string;
	let taskTitle: string;
	let canonicalTaskPath: string;
	let privateCanonicalTaskPath: string;
	let deletedCanonicalTaskPath: string;
	let previewChannelId: string;
	let previewCanonicalTaskUrl: string;
	let deletedPreviewCanonicalTaskUrl: string;

	test.beforeAll(async () => {
		owner = await createTestOrg();
		outsider = await createTestEmployee(owner);
		const project = await api.createProject(owner, {
			name: `Canonical Link Project ${crypto.randomUUID().slice(0, 8)}`,
			visibility: 'PROJECT_VISIBILITY_PUBLIC',
		});
		projectId = project.project.id;
		taskTitle = `Canonical Task ${crypto.randomUUID().slice(0, 6)}`;
		const task = await api.createTask(owner, projectId, taskTitle, { levelId: project.levels[0].id });
		taskId = task.task.id;
		canonicalTaskPath = await generateCanonicalTaskLink(owner, {
			tenantKey: owner.orgSubdomain,
			resourceId: taskId,
			focusIntent: 'review_pending',
		}, { relative: true });

		const privateProject = await api.createProject(owner, {
			name: `Private Canonical Project ${crypto.randomUUID().slice(0, 8)}`,
			visibility: 'PROJECT_VISIBILITY_PRIVATE',
		});
		const privateTask = await api.createTask(owner, privateProject.project.id, `Private Canonical Task ${crypto.randomUUID().slice(0, 6)}`, { levelId: privateProject.levels[0].id });
		privateCanonicalTaskPath = await generateCanonicalTaskLink(owner, {
			tenantKey: owner.orgSubdomain,
			resourceId: privateTask.task.id,
		}, { relative: true });

		deletedCanonicalTaskPath = await generateCanonicalTaskLink(owner, {
			tenantKey: owner.orgSubdomain,
			resourceId: crypto.randomUUID(),
		}, { relative: true });

		const previewChannel = await api.createChannel(owner, {
			titleSlug: `canonical-preview-${crypto.randomUUID().slice(0, 8)}`,
			displayName: `Canonical Preview ${crypto.randomUUID().slice(0, 6)}`,
		});
		previewChannelId = previewChannel.channel.id;
		previewCanonicalTaskUrl = await generateCanonicalTaskLink(owner, {
			tenantKey: owner.orgSubdomain,
			resourceId: taskId,
		}, { relative: false });

		deletedPreviewCanonicalTaskUrl = await generateCanonicalTaskLink(owner, {
			tenantKey: owner.orgSubdomain,
			resourceId: crypto.randomUUID(),
		}, { relative: false });

		await api.sendMessage(owner, previewChannelId, previewCanonicalTaskUrl);
		await api.sendMessage(owner, previewChannelId, deletedPreviewCanonicalTaskUrl);
	});

	test.describe('when a user opens a copied task link on desktop', () => {
		test('the browser lands on the correct web task destination', async ({ page }, testInfo) => {
			await loginAs(page, owner);
			await page.goto(canonicalTaskPath);

			await expectCanonicalTaskDestination(page, projectId, taskId);
			await expect(page.getByText(taskTitle, { exact: true }).first()).toBeVisible();
			await expect(page.getByRole('button', { name: 'Copy canonical task link' })).toBeVisible();
			await stepScreenshot(page, testInfo, 'canonical-task-link-desktop');
		});
	});

	test.describe('when a signed-out user opens a canonical link in the browser', () => {
		test('the app redirects to sign in and returns to the intended resource after authentication', async ({ page }, testInfo) => {
			await page.goto(canonicalTaskPath);

			await expect.poll(() => page.url()).toMatch(/\/signin\/?\?redirect=/);
			await page.evaluate(({ token, expiresAt }) => {
				localStorage.setItem('tech_office_access_token', token);
				localStorage.setItem('tech_office_token_expires_at', String(expiresAt));
			}, { token: owner.token, expiresAt: owner.expiresAt });
			await page.reload();

			await expectCanonicalTaskDestination(page, projectId, taskId);
			await expect(page.getByText(taskTitle, { exact: true }).first()).toBeVisible();
			await stepScreenshot(page, testInfo, 'canonical-task-link-signin-continuation');
		});
	});

	test.describe('when a user lacks permission for the target resource', () => {
		test('the app shows a clear access denied state', async ({ page }, testInfo) => {
			await loginAs(page, outsider);
			await page.goto(privateCanonicalTaskPath);

			await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
			await expect(page.getByText('This link points to a resource that exists, but your current account cannot open it.')).toBeVisible();
			await stepScreenshot(page, testInfo, 'canonical-task-link-access-denied');
		});
	});

	test.describe('when a canonical link points to a missing resource', () => {
		test('the app shows a clear not found state', async ({ page }, testInfo) => {
			await loginAs(page, owner);
			await page.goto(deletedCanonicalTaskPath);

			await expect(page.getByText('Resource not found')).toBeVisible();
			await expect(page.getByText('This link is valid, but the target resource is no longer available.')).toBeVisible();
			await stepScreenshot(page, testInfo, 'canonical-task-link-not-found');
		});
	});

	test.describe('when a canonical link is pasted into a supported rich input', () => {
		test('a preview card appears when metadata is available', async ({ page }, testInfo) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/chat?channel=${previewChannelId}`);

			const previewCard = page.getByTestId('canonical-link-preview-card').first();
			await expect(previewCard).toBeVisible({ timeout: 10_000 });
			await expect(previewCard).toContainText(taskId);
			await stepScreenshot(page, testInfo, 'canonical-chat-preview-card');
		});
		test('the raw link remains clickable when metadata lookup fails', async ({ page }, testInfo) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/chat?channel=${previewChannelId}`);

			await expect(page.locator(`a[href="${deletedPreviewCanonicalTaskUrl}"]`).first()).toBeVisible({ timeout: 10_000 });
			await expect(page.getByTestId('canonical-link-preview-card')).toHaveCount(1);
			await stepScreenshot(page, testInfo, 'canonical-chat-raw-link-fallback');
		});
	});
});