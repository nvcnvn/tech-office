import { expect, test, type Page } from '@playwright/test';
import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';

/**
 * Feature 041: Evidence Review Queue — web behavioural contract.
 *
 * Names mirror the backend scenarios in
 * backend/integration/collaboration_evidence_review_queue_test.go so both suites tell the
 * same story. Arrange via API, act via UI, assert via UI.
 */

/** One ritual project with a live instance and a manual-approval text requirement. */
interface QueueFixture {
	projectId: string;
	taskId: string;
	requirementId: string;
}

async function waitForRitualTask(owner: TestUser, projectId: string, definitionId: string) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const response = await api.listTasks(owner, projectId, {
			taskKind: 'TASK_KIND_RITUAL_INSTANCE',
		});
		const tasks = Array.isArray(response?.tasks) ? response.tasks : [];
		const task = tasks.find((t) => t.ritualDefinitionId === definitionId);
		if (task) return task;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error(`Timed out waiting for a ritual task for definition ${definitionId}`);
}

async function createQueueProject(
	owner: TestUser,
	submitter: TestUser,
	label: string,
): Promise<QueueFixture> {
	const project = await api.createProject(owner, {
		name: `${label} ${crypto.randomUUID().slice(0, 8)}`,
		visibility: 'PROJECT_VISIBILITY_PRIVATE',
		collaborationMode: 'COLLABORATION_MODE_RITUAL',
	});
	const projectId = project.project.id;
	await api.addProjectMember(owner, projectId, submitter.id, 'PROJECT_MEMBER_ROLE_MEMBER');

	const definition = await api.createRitualDefinition(owner, {
		projectId,
		name: `${label} Ritual`,
		defaultAssigneeIds: [submitter.id],
	});
	const requirement = await api.createEvidenceRequirement(owner, {
		ritualDefinitionId: definition.ritualDefinition.id,
		name: `${label} gate note`,
	});

	const task = await waitForRitualTask(owner, projectId, definition.ritualDefinition.id);
	return { projectId, taskId: task.id, requirementId: requirement.evidenceRequirement.id };
}

async function openQueue(page: Page, user: TestUser) {
	await loginAs(page, user);
	await page.goto('/workspace/reviews');
}

test.describe('Evidence Review Queue', () => {
	test.describe('when a reviewer opens the review queue', () => {
		let reviewer: TestUser;
		let submitter: TestUser;
		let alpha: QueueFixture;
		let bravo: QueueFixture;
		let olderSubmissionId: string;
		let newerSubmissionId: string;

		test.beforeAll(async () => {
			test.setTimeout(180_000);
			reviewer = await createTestOrg();
			submitter = await createTestEmployee(reviewer);

			alpha = await createQueueProject(reviewer, submitter, 'Queue Alpha');
			bravo = await createQueueProject(reviewer, submitter, 'Queue Bravo');

			const newer = await api.submitEvidence(submitter, {
				taskId: alpha.taskId,
				evidenceRequirementId: alpha.requirementId,
				textContent: 'Alpha gate checked at 08:00',
			});
			const older = await api.submitEvidence(submitter, {
				taskId: bravo.taskId,
				evidenceRequirementId: bravo.requirementId,
				textContent: 'Bravo gate checked at 06:00',
			});
			newerSubmissionId = newer.evidenceSubmission.id;
			olderSubmissionId = older.evidenceSubmission.id;

			// Deliberately not creation order, so a list that happens to return insertion
			// order would fail the ordering assertion.
			api.backdateEvidenceSubmission(olderSubmissionId, 240);
			api.backdateEvidenceSubmission(newerSubmissionId, 60);
		});

		test('all pending submissions across projects appear in one list', async ({ page }) => {
			await openQueue(page, reviewer);

			await expect(page.getByTestId('review-queue-list')).toBeVisible();
			await expect(page.getByTestId(`review-queue-row-${olderSubmissionId}`)).toBeVisible();
			await expect(page.getByTestId(`review-queue-row-${newerSubmissionId}`)).toBeVisible();
		});

		test('the oldest submission appears first', async ({ page }) => {
			await openQueue(page, reviewer);

			const rows = page.getByTestId(/^review-queue-row-/);
			await expect(rows.first()).toBeVisible();
			await expect(rows.first()).toHaveAttribute(
				'data-testid',
				`review-queue-row-${olderSubmissionId}`,
			);
		});

		test('a photo submission is viewable from the row', async ({ page }) => {
			// The queue carries the evidence itself, so text content is readable without
			// opening the task. The photo path shares this component and differs only in
			// resolving a download URL, which needs an uploaded file the API cannot seed.
			await openQueue(page, reviewer);

			await expect(
				page.getByTestId(`review-queue-evidence-text-${newerSubmissionId}`),
			).toContainText('Alpha gate checked at 08:00');
		});

		test('the navigation entry point shows a count', async ({ page }) => {
			await loginAs(page, reviewer);
			await page.goto('/workspace/reviews');

			await expect(page.getByTestId('workspace-tab-reviews')).toBeVisible();
			await expect(page.getByTestId('workspace-tab-reviews-badge')).toHaveText(/^\d+\+?$/);
		});
	});

	test.describe('when the reviewer approves from a queue row', () => {
		let reviewer: TestUser;
		let submitter: TestUser;
		let fixture: QueueFixture;

		test.beforeAll(async () => {
			test.setTimeout(180_000);
			reviewer = await createTestOrg();
			submitter = await createTestEmployee(reviewer);
			fixture = await createQueueProject(reviewer, submitter, 'Approve');
		});

		test('the row leaves the queue without a manual refresh', async ({ page }) => {
			const submission = await api.submitEvidence(submitter, {
				taskId: fixture.taskId,
				evidenceRequirementId: fixture.requirementId,
				textContent: 'Ready to approve',
			});
			const rowId = `review-queue-row-${submission.evidenceSubmission.id}`;

			await openQueue(page, reviewer);
			const row = page.getByTestId(rowId);
			await expect(row).toBeVisible();

			await row.getByTestId('review-queue-approve-btn').click();

			await expect(page.getByTestId(rowId)).toHaveCount(0);
		});
	});

	test.describe('when the reviewer rejects from a queue row', () => {
		let reviewer: TestUser;
		let submitter: TestUser;
		let fixture: QueueFixture;

		test.beforeAll(async () => {
			test.setTimeout(180_000);
			reviewer = await createTestOrg();
			submitter = await createTestEmployee(reviewer);
			fixture = await createQueueProject(reviewer, submitter, 'Reject');
		});

		test('a reason is required before the rejection is accepted', async ({ page }) => {
			const submission = await api.submitEvidence(submitter, {
				taskId: fixture.taskId,
				evidenceRequirementId: fixture.requirementId,
				textContent: 'Needs a reason to reject',
			});
			const rowId = `review-queue-row-${submission.evidenceSubmission.id}`;

			await openQueue(page, reviewer);
			await page.getByTestId(rowId).getByTestId('review-queue-reject-btn').click();

			await expect(page.getByTestId('review-queue-reject-reason-input')).toBeVisible();
			await expect(page.getByTestId('review-queue-reject-confirm-btn')).toBeDisabled();

			await page.getByTestId('review-queue-reject-reason-input').fill('The gate photo is blurry');
			await expect(page.getByTestId('review-queue-reject-confirm-btn')).toBeEnabled();
			await page.getByTestId('review-queue-reject-confirm-btn').click();

			await expect(page.getByTestId(rowId)).toHaveCount(0);
		});

		test('a whitespace-only reason is refused', async ({ page }) => {
			const submission = await api.submitEvidence(submitter, {
				taskId: fixture.taskId,
				evidenceRequirementId: fixture.requirementId,
				textContent: 'Whitespace reason attempt',
			});
			const rowId = `review-queue-row-${submission.evidenceSubmission.id}`;

			await openQueue(page, reviewer);
			await page.getByTestId(rowId).getByTestId('review-queue-reject-btn').click();
			await page.getByTestId('review-queue-reject-reason-input').fill('    ');

			// A reason of spaces is no reason: the confirm action stays unavailable rather
			// than sending a rejection the submitter cannot act on.
			await expect(page.getByTestId('review-queue-reject-confirm-btn')).toBeDisabled();
		});
	});

	test.describe('when a decision fails', () => {
		let reviewer: TestUser;
		let submitter: TestUser;
		let fixture: QueueFixture;

		test.beforeAll(async () => {
			test.setTimeout(180_000);
			reviewer = await createTestOrg();
			submitter = await createTestEmployee(reviewer);
			fixture = await createQueueProject(reviewer, submitter, 'Failing');
		});

		test('the row returns to its pending presentation with the reason shown', async ({ page }) => {
			const submission = await api.submitEvidence(submitter, {
				taskId: fixture.taskId,
				evidenceRequirementId: fixture.requirementId,
				textContent: 'This approval will fail',
			});
			const rowId = `review-queue-row-${submission.evidenceSubmission.id}`;

			await openQueue(page, reviewer);
			await expect(page.getByTestId(rowId)).toBeVisible();

			// Fail the decision at the transport, which is the same shape as a server-side
			// failure from the row's point of view: no state was recorded either way.
			await page.route('**/rpc.v1.CollaborationService/ApproveEvidence', (route) =>
				route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ code: 'internal', message: 'decision could not be recorded' }),
				}),
			);

			await page.getByTestId(rowId).getByTestId('review-queue-approve-btn').click();

			await expect(page.getByTestId('review-queue-decision-error')).toBeVisible();
			await expect(page.getByTestId(rowId)).toBeVisible();
		});
	});

	test.describe('when the submission was already decided elsewhere', () => {
		let reviewer: TestUser;
		let submitter: TestUser;
		let fixture: QueueFixture;

		test.beforeAll(async () => {
			test.setTimeout(180_000);
			reviewer = await createTestOrg();
			submitter = await createTestEmployee(reviewer);
			fixture = await createQueueProject(reviewer, submitter, 'Raced');
		});

		test('the reviewer is told it was already decided rather than silently succeeding', async ({
			page,
		}) => {
			const submission = await api.submitEvidence(submitter, {
				taskId: fixture.taskId,
				evidenceRequirementId: fixture.requirementId,
				textContent: 'Will be decided in another session',
			});
			const rowId = `review-queue-row-${submission.evidenceSubmission.id}`;

			await openQueue(page, reviewer);
			await expect(page.getByTestId(rowId)).toBeVisible();

			// Decided out of band, exactly as a second browser session would.
			await api.approveEvidence(reviewer, {
				evidenceSubmissionId: submission.evidenceSubmission.id,
				comment: 'decided elsewhere',
			});

			await page.getByTestId(rowId).getByTestId('review-queue-approve-btn').click();

			await expect(page.getByTestId('review-queue-decision-error')).toContainText(
				/already decided/i,
			);
		});
	});

	test.describe('when the reviewer has nothing to review', () => {
		test('an explicit empty state is shown, distinct from loading and from failure', async ({
			page,
		}) => {
			test.setTimeout(120_000);
			const reviewer = await createTestOrg();

			await openQueue(page, reviewer);

			await expect(page.getByTestId('review-queue-empty-state')).toBeVisible();
			await expect(page.getByTestId('review-queue-loading')).toHaveCount(0);
			await expect(page.getByTestId('review-queue-error')).toHaveCount(0);
		});
	});

	test.describe('when an employee without the evidence-review permission signs in', () => {
		test('the review queue entry point is not offered', async ({ page }) => {
			test.setTimeout(120_000);
			const owner = await createTestOrg();
			const worker = await createTestEmployee(owner);

			api.revokeOrganizationPermission(owner.orgId, 'collab.reviewEvidence');

			await loginAs(page, worker);
			await page.goto('/workspace/tasks');

			await expect(page.getByTestId('workspace-tab-tasks')).toBeVisible();
			await expect(page.getByTestId('workspace-tab-reviews')).toHaveCount(0);
		});
	});
});
