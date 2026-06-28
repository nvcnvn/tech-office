import { expect, test } from '@playwright/test';
import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';

async function waitForRitualTasks(owner: TestUser, projectId: string, minCount = 1) {
	for (let attempt = 0; attempt < 12; attempt += 1) {
		const response = await api.listTasks(owner, projectId, {
			taskKind: 'TASK_KIND_RITUAL_INSTANCE',
		});
		const tasks = Array.isArray(response?.tasks) ? response.tasks : [];
		if (tasks.length >= minCount) {
			return tasks;
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	throw new Error(`Timed out waiting for ${minCount} ritual task(s) in ${projectId}`);
}

/**
 * Polls until a ritual instance task for the given definition ID is found.
 * This avoids the race condition where waitForRitualTasks returns early with
 * only one definition's tasks (before the second definition's scheduler run).
 */
async function waitForRitualTaskByDefinition(owner: TestUser, projectId: string, definitionId: string) {
	for (let attempt = 0; attempt < 12; attempt += 1) {
		const response = await api.listTasks(owner, projectId, {
			taskKind: 'TASK_KIND_RITUAL_INSTANCE',
		});
		const tasks = Array.isArray(response?.tasks) ? response.tasks : [];
		const task = tasks.find((t) => t.ritualDefinitionId === definitionId);
		if (task) return task;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error(`Timed out waiting for ritual task for definition ${definitionId} in ${projectId}`);
}

async function waitForNotificationRecipientId(user: TestUser, title: string) {
	for (let attempt = 0; attempt < 12; attempt += 1) {
		const response = await api.listNotifications(user, { unreadOnly: false });
		const notificationRecipientId = response.notifications.find(
			(notification) => notification.title === title,
		)?.notificationRecipientId;

		if (notificationRecipientId) {
			return notificationRecipientId;
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	throw new Error(`Timed out waiting for notification titled ${title}`);
}

test.describe('Ritual Submission Flow', () => {
	test.describe('when an assigned employee opens an active ritual instance', () => {
		let owner: TestUser;
		let worker: TestUser;
		let projectId: string;
		let taskId: string;
		let requirementId: string;

		test.beforeAll(async () => {
			owner = await createTestOrg();
			worker = await createTestEmployee(owner);

			const project = await api.createProject(owner, {
				name: `Ritual Worker ${crypto.randomUUID().slice(0, 8)}`,
				visibility: 'PROJECT_VISIBILITY_PRIVATE',
				collaborationMode: 'COLLABORATION_MODE_RITUAL',
			});
			projectId = project.project.id;

			await api.addProjectMember(owner, projectId, worker.id, 'PROJECT_MEMBER_ROLE_MEMBER');
			const definition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Daily Walk ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});
			const requirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: definition.ritualDefinition.id,
				name: 'Front gate note',
			});
			requirementId = requirement.evidenceRequirement.id;

			const tasks = await waitForRitualTasks(owner, projectId, 1);
			taskId = tasks[0].id;
		});

		test('the task detail shows the proof checklist and current statuses', async ({ page }) => {
			await loginAs(page, worker);
			await page.goto(`/workspace/tasks/${projectId}/tasks/${taskId}`);

			await expect(page.getByTestId('evidence-checklist')).toBeVisible();
			await expect(page.getByTestId(`evidence-req-row-${requirementId}`)).toContainText('Front gate note');
			await expect(page.getByTestId(`evidence-req-row-${requirementId}`)).toContainText('Missing Proof');
			await expect(page.getByTestId('evidence-review-panel')).toHaveCount(0);
		});

		test('submitting proof keeps the worker in the same ritual task context', async ({ page }) => {
			await loginAs(page, worker);
			await page.goto(`/workspace/tasks/${projectId}/tasks/${taskId}`);

			await page.getByTestId(`submit-evidence-btn-${requirementId}`).click();
			await page.getByTestId('evidence-text-input').fill('Gate checked at 08:00');
			await page.getByTestId('evidence-submit-btn').click();

			await expect(page).toHaveURL(new RegExp(`/workspace/tasks/${projectId}/tasks/${taskId}/?(?:\\?.*)?$`));
			await expect(page.getByTestId('approval-badge-pending_review')).toBeVisible();
		});

		test('submitting GPS proof from web auto-approves when the browser location is inside the configured geofence', async ({ page }) => {
			const targetLatitude = 10.7769;
			const targetLongitude = 106.7009;

			const gpsDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `GPS Walk ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});
			const gpsRequirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: gpsDefinition.ritualDefinition.id,
				name: 'GPS gate check-in',
				evidenceTypes: ['EVIDENCE_TYPE_GPS_CHECKIN'],
				approvalMode: 'APPROVAL_MODE_AUTO_APPROVE',
				autoApproveConfig: {
					gpsTarget: {
						latitude: targetLatitude,
						longitude: targetLongitude,
					},
					gpsRadiusMeters: 200,
				},
			});
			const gpsTask = await waitForRitualTaskByDefinition(owner, projectId, gpsDefinition.ritualDefinition.id);

			await page.context().grantPermissions(['geolocation']);
			await page.context().setGeolocation({ latitude: targetLatitude, longitude: targetLongitude });

			await loginAs(page, worker);
			await page.goto(`/workspace/tasks/${projectId}/tasks/${gpsTask.id}`);

			await page.getByTestId(`submit-evidence-btn-${gpsRequirement.evidenceRequirement.id}`).click();
			await page.getByTestId('evidence-gps-capture-btn').click();
			await expect(page.getByText('Location ready')).toBeVisible();
			await page.getByTestId('evidence-submit-btn').click();

			await expect(page).toHaveURL(new RegExp(`/workspace/tasks/${projectId}/tasks/${gpsTask.id}/?(?:\\?.*)?$`));
			await expect(page.getByTestId('approval-badge-approved')).toBeVisible();
		});

		test('legacy projects task URLs redirect to the canonical tasks route without losing focus query state', async ({ page }) => {
			await loginAs(page, worker);
			await page.goto(
				`/workspace/projects/${projectId}/tasks/${taskId}?focusIntent=submit_requirement&requirementId=${requirementId}`
			);

			await expect(page).toHaveURL(
				new RegExp(
					`/workspace/tasks/${projectId}/tasks/${taskId}/?\\?focusIntent=submit_requirement&requirementId=${requirementId}`
				)
			);
			await expect(page.getByTestId('evidence-checklist')).toBeVisible();
		});

		test('a non-assignee member sees the checklist but no submit buttons on the ritual instance', async ({ page }) => {
			// US1.3: definition-level access must not expose live submission actions
			// Validate by signing in as the owner who is NOT assigned to this instance
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}/tasks/${taskId}`);

			await expect(page.getByTestId('evidence-checklist')).toBeVisible();
			await expect(page.getByTestId(`submit-evidence-btn-${requirementId}`)).toHaveCount(0);
		});
	});

	test.describe('when a reviewer opens the ritual review surface', () => {
		let owner: TestUser;
		let worker: TestUser;
		let projectId: string;
		let firstTaskId: string;
		let secondTaskId: string;
		let firstRequirementId: string;
		let secondRequirementId: string;
		let secondSubmissionId: string;

		test.beforeAll(async () => {
			owner = await createTestOrg();
			worker = await createTestEmployee(owner);

			const project = await api.createProject(owner, {
				name: `Ritual Review ${crypto.randomUUID().slice(0, 8)}`,
				visibility: 'PROJECT_VISIBILITY_PRIVATE',
				collaborationMode: 'COLLABORATION_MODE_RITUAL',
			});
			projectId = project.project.id;

			await api.addProjectMember(owner, projectId, worker.id, 'PROJECT_MEMBER_ROLE_MEMBER');

			const firstDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Shift Handover ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});
			const secondDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Safety Sweep ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});

			const firstRequirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: firstDefinition.ritualDefinition.id,
				name: 'Operator note',
			});
			const secondRequirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: secondDefinition.ritualDefinition.id,
				name: 'Safety note',
			});
			firstRequirementId = firstRequirement.evidenceRequirement.id;
			secondRequirementId = secondRequirement.evidenceRequirement.id;

			const firstTask = await waitForRitualTaskByDefinition(owner, projectId, firstDefinition.ritualDefinition.id);
			const secondTask = await waitForRitualTaskByDefinition(owner, projectId, secondDefinition.ritualDefinition.id);
			firstTaskId = firstTask.id;
			secondTaskId = secondTask.id;

			await api.submitEvidence(worker, {
				taskId: firstTaskId,
				evidenceRequirementId: firstRequirementId,
				textContent: 'Night shift completed',
			});
			const secondSubmission = await api.submitEvidence(worker, {
				taskId: secondTaskId,
				evidenceRequirementId: secondRequirementId,
				textContent: 'Safety sweep completed',
			});
			secondSubmissionId = secondSubmission.evidenceSubmission.id;
		});

		test('the reviewer can identify pending submissions without opening every task', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}?view=review`);

			await expect(page.getByTestId('tab-review')).toBeVisible();
			await expect(page.getByTestId('ritual-review-backlog')).toBeVisible();
			await expect(page.getByTestId(`ritual-review-backlog-row-${firstTaskId}`)).toBeVisible();
			await expect(page.getByTestId(`ritual-review-backlog-row-${secondTaskId}`)).toBeVisible();
		});

		test('rejecting proof from the review surface returns actionable feedback to the worker', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}?view=review`);
			await page.getByTestId(`open-review-backlog-item-${secondTaskId}`).click();

			await expect(page.getByTestId(`evidence-req-row-${secondRequirementId}`)).toBeVisible();
			await page.getByTestId(`review-note-input-${secondSubmissionId}`).fill('Add more detail about the safety check');
			await page.getByTestId(`reject-evidence-btn-${secondSubmissionId}`).click();

			await expect(page.getByTestId(`evidence-req-row-${secondRequirementId}`)).toContainText('Add more detail about the safety check');

			await loginAs(page, worker);
			await page.goto(`/workspace/tasks/${projectId}/tasks/${secondTaskId}`);
			await expect(page.getByTestId(`evidence-req-row-${secondRequirementId}`)).toContainText('Add more detail about the safety check');
			await expect(page.getByText('Resubmit Proof')).toBeVisible();
		});
	});

	test.describe('when template guidance stays separate from live ritual work', () => {
		let owner: TestUser;
		let worker: TestUser;
		let projectId: string;
		let dualRoleTaskId: string;
		let ownerRequirementId: string;
		let workerRequirementId: string;
		let workerSubmissionId: string;
		let skippedTaskId: string;

		test.beforeAll(async () => {
			owner = await createTestOrg();
			worker = await createTestEmployee(owner);

			const project = await api.createProject(owner, {
				name: `Ritual Dual Role ${crypto.randomUUID().slice(0, 8)}`,
				visibility: 'PROJECT_VISIBILITY_PRIVATE',
				collaborationMode: 'COLLABORATION_MODE_RITUAL',
			});
			projectId = project.project.id;

			await api.addProjectMember(owner, projectId, worker.id, 'PROJECT_MEMBER_ROLE_MEMBER');

			const dualRoleDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Dual Role Close ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [owner.id, worker.id],
			});
			const skippedDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Skipped Route ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [owner.id],
			});

			const ownerRequirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: dualRoleDefinition.ritualDefinition.id,
				name: 'Owner closing note',
			});
			const workerRequirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: dualRoleDefinition.ritualDefinition.id,
				name: 'Alarm status note',
			});
			ownerRequirementId = ownerRequirement.evidenceRequirement.id;
			workerRequirementId = workerRequirement.evidenceRequirement.id;

			await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: skippedDefinition.ritualDefinition.id,
				name: 'Skip context note',
			});

			const dualRoleTask = await waitForRitualTaskByDefinition(owner, projectId, dualRoleDefinition.ritualDefinition.id);
			const skippedTask = await waitForRitualTaskByDefinition(owner, projectId, skippedDefinition.ritualDefinition.id);
			dualRoleTaskId = dualRoleTask.id;
			skippedTaskId = skippedTask.id;

			const workerSubmission = await api.submitEvidence(worker, {
				taskId: dualRoleTaskId,
				evidenceRequirementId: workerRequirementId,
				textContent: 'Alarm checked and secure',
			});
			workerSubmissionId = workerSubmission.evidenceSubmission.id;
			await api.skipRitualInstance(owner, {
				taskId: skippedTaskId,
				reason: 'Store remained closed for maintenance',
			});
		});

		test('a dual-role owner still sees both proof submission and review controls on the same ritual instance', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}/tasks/${dualRoleTaskId}`);

			await expect(page.getByTestId('ritual-dual-role-alert')).toBeVisible();
			await expect(page.getByTestId('evidence-checklist-dual-role-note')).toBeVisible();
			await expect(page.getByTestId(`submit-evidence-btn-${ownerRequirementId}`)).toBeVisible();
			await expect(page.getByTestId(`approve-evidence-btn-${workerSubmissionId}`)).toBeVisible();
			await expect(page.getByTestId('ritual-definition-guidance')).toContainText('reusable ritual template');
		});

		test('a skipped ritual instance keeps instance-specific context on the task page', async ({ page }) => {
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${projectId}/tasks/${skippedTaskId}`);

			await expect(page.getByTestId('ritual-skip-context-alert')).toContainText('Store remained closed for maintenance');
			await expect(page.getByTestId('ritual-definition-guidance')).toContainText('live instance');
		});
	});

	test.describe('when ritual work is opened from summaries and notifications', () => {
		let owner: TestUser;
		let worker: TestUser;
		let projectId: string;
			let reviewTaskId: string;
			let reviewRequirementId: string;
			let reviewSubmissionId: string;
			let rejectedTaskId: string;
			let rejectedRequirementId: string;
			let rejectedSubmissionId: string;
		let ownerNotificationRecipientId: string;
		let workerNotificationRecipientId: string;

		test.beforeAll(async () => {
			owner = await createTestOrg();
			worker = await createTestEmployee(owner);

			const project = await api.createProject(owner, {
				name: `Ritual Routing ${crypto.randomUUID().slice(0, 8)}`,
				visibility: 'PROJECT_VISIBILITY_PRIVATE',
				collaborationMode: 'COLLABORATION_MODE_RITUAL',
			});
			projectId = project.project.id;

			await api.addProjectMember(owner, projectId, worker.id, 'PROJECT_MEMBER_ROLE_MEMBER');
			const reviewDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Routing Review ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});
			const rejectedDefinition = await api.createRitualDefinition(owner, {
				projectId,
				name: `Routing Reject ${crypto.randomUUID().slice(0, 6)}`,
				defaultAssigneeIds: [worker.id],
			});
			const reviewRequirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: reviewDefinition.ritualDefinition.id,
				name: 'Pressure reading note',
			});
			const rejectedRequirement = await api.createEvidenceRequirement(owner, {
				ritualDefinitionId: rejectedDefinition.ritualDefinition.id,
				name: 'Pressure reading retry note',
			});
			reviewRequirementId = reviewRequirement.evidenceRequirement.id;
			rejectedRequirementId = rejectedRequirement.evidenceRequirement.id;

			const reviewTask = await waitForRitualTaskByDefinition(owner, projectId, reviewDefinition.ritualDefinition.id);
			const rejectedTask = await waitForRitualTaskByDefinition(owner, projectId, rejectedDefinition.ritualDefinition.id);
			reviewTaskId = reviewTask.id;
			rejectedTaskId = rejectedTask.id;
			await api.watchTask(owner, reviewTaskId);

			const reviewSubmission = await api.submitEvidence(worker, {
				taskId: reviewTaskId,
				evidenceRequirementId: reviewRequirementId,
				textContent: 'Pressure stable at 09:00',
			});
			reviewSubmissionId = reviewSubmission.evidenceSubmission.id;

			ownerNotificationRecipientId = await waitForNotificationRecipientId(owner, 'Evidence Submitted');

			const rejectedSubmission = await api.submitEvidence(worker, {
				taskId: rejectedTaskId,
				evidenceRequirementId: rejectedRequirementId,
				textContent: 'Pressure stable at 11:00',
			});
			rejectedSubmissionId = rejectedSubmission.evidenceSubmission.id;

			await api.rejectEvidence(owner, {
				evidenceSubmissionId: rejectedSubmissionId,
				comment: 'Add the actual pressure reading',
			});

			workerNotificationRecipientId = await waitForNotificationRecipientId(worker, 'Evidence Rejected');
		});

		test('today and list entries open the live ritual instance with view_instance focus', async ({ page }) => {
			test.setTimeout(60_000);
			await loginAs(page, worker);

			await page.goto(`/workspace/tasks/${projectId}?view=today`);
			const todayLink = page.locator('a[href*="focusIntent=view_instance"]').first();
			const todayHref = await todayLink.getAttribute('href');
			await todayLink.click();
			await expect.poll(() => page.url()).toContain(todayHref ?? 'focusIntent=view_instance');

			await page.goto(`/workspace/tasks/${projectId}?view=list`);
				await page.getByTestId(`task-row-${reviewTaskId}`).click();
				await expect.poll(() => page.url()).toContain(`/workspace/tasks/${projectId}/tasks/${reviewTaskId}/?focusIntent=view_instance`);
		});

		test('notification rows route reviewers and workers into the same ritual instance with the right focus', async ({ page }) => {
			expect(ownerNotificationRecipientId).not.toBe('');
			expect(workerNotificationRecipientId).not.toBe('');

			await loginAs(page, owner);
			await page.goto('/workspace/notifications');
			await page.getByTestId(`notification-item-${ownerNotificationRecipientId}`).click();
				await expect.poll(() => page.url()).toContain(`/workspace/tasks/${projectId}/tasks/${reviewTaskId}/?focusIntent=review_pending`);
			await expect(page.getByTestId(`review-note-input-${reviewSubmissionId}`)).toBeVisible();
				await expect(page.getByText('Open the highlighted proof below to approve or reject it inline without leaving this task.')).toBeVisible();

			await loginAs(page, worker);
			await page.goto('/workspace/notifications');
			await page.getByTestId(`notification-item-${workerNotificationRecipientId}`).click();
				await expect.poll(() => page.url()).toContain(`/workspace/tasks/${projectId}/tasks/${rejectedTaskId}/?focusIntent=submit_requirement`);
			await expect(page.getByTestId(`submit-evidence-btn-${rejectedRequirementId}`)).toContainText('Resubmit Proof');
				await expect(page.getByTestId(`evidence-req-row-${rejectedRequirementId}`)).toBeVisible();
		});
	});
});