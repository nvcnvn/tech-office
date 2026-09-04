import { expect, test, type Page } from '@playwright/test';
import { createTestEmployee, createTestOrg, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';

/**
 * Feature 043: Procedure Document On A Ritual Definition — web behavioural contract.
 *
 * Scenario names are copied verbatim from the plan's behavioural contract and match the
 * backend suite in backend/integration/collaboration_ritual_procedure_test.go, so both
 * suites tell the same story line for line.
 *
 * The overlay is what these tests actually protect. FR-013 and FR-014 hold because the
 * surface underneath the procedure is never unmounted; a future change that turns an entry
 * point into a route would still render "a procedure" but would silently reintroduce the
 * state loss. That is why the tests below assert survival of a typed note, an attached
 * file and a typed rejection reason rather than merely asserting the procedure appears.
 */

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

function procedureContent(text: string): string {
	return JSON.stringify({
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
	});
}

interface RitualFixture {
	projectId: string;
	definitionId: string;
	taskId: string;
	requirementId: string;
}

async function createRitualProject(
	owner: TestUser,
	worker: TestUser,
	label: string,
	procedureDocumentId?: string,
): Promise<RitualFixture> {
	const project = await api.createProject(owner, {
		name: `${label} ${crypto.randomUUID().slice(0, 8)}`,
		visibility: 'PROJECT_VISIBILITY_PRIVATE',
		collaborationMode: 'COLLABORATION_MODE_RITUAL',
	});
	const projectId = project.project.id;
	await api.addProjectMember(owner, projectId, worker.id, 'PROJECT_MEMBER_ROLE_MEMBER');

	const definition = await api.createRitualDefinition(owner, {
		projectId,
		name: `${label} Ritual`,
		defaultAssigneeIds: [worker.id],
		procedureDocumentId,
	});
	const requirement = await api.createEvidenceRequirement(owner, {
		ritualDefinitionId: definition.ritualDefinition.id,
		name: `${label} gate note`,
	});
	const task = await waitForRitualTask(owner, projectId, definition.ritualDefinition.id);

	return {
		projectId,
		definitionId: definition.ritualDefinition.id,
		taskId: task.id,
		requirementId: requirement.evidenceRequirement.id,
	};
}

async function openInstance(page: Page, user: TestUser, fixture: RitualFixture) {
	await loginAs(page, user);
	await page.goto(`/workspace/tasks/${fixture.projectId}/tasks/${fixture.taskId}`);
	await expect(page.getByTestId('evidence-checklist')).toBeVisible({ timeout: 30_000 });
}

test.describe('Ritual Procedure Document', () => {
	// -------------------------------------------------------------------------
	// US2 — attach, replace and remove
	// -------------------------------------------------------------------------
	test.describe('when a manager configures the procedure on a ritual definition', () => {
		let owner: TestUser;
		let worker: TestUser;
		let fixture: RitualFixture;
		let documentTitle: string;
		let searchToken: string;
		let unreadableTitle: string;
		let unreadableToken: string;
		let unreadableDocId: string;

		test.beforeAll(async () => {
			test.setTimeout(180_000);
			owner = await createTestOrg();
			worker = await createTestEmployee(owner);

			// A distinctive single token. PGroonga tokenises, so the chooser is searched
			// with a whole word rather than a truncated prefix.
			searchToken = `coldchain${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
			documentTitle = `Cold Chain SOP ${searchToken}`;
			await api.createDocument(owner, {
				title: documentTitle,
				contentJson: procedureContent('Check the freezer at 07:00 and record the reading.'),
			});

			// Created by somebody else and never shared with the manager. The chooser
			// searches only what the manager can already read, which is the access rule
			// itself: a manager cannot grant sight of a document they cannot open (FR-007).
			unreadableToken = `workernote${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
			unreadableTitle = `Private Worker Note ${unreadableToken}`;
			unreadableDocId = (await api.createDocument(worker, { title: unreadableTitle })).document.id;

			fixture = await createRitualProject(owner, worker, 'Procedure Config');
		});

		test('manager attaches a procedure from the ritual definition editor and is warned about the access it grants first', async ({
			page,
		}) => {
			test.setTimeout(120_000);
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${fixture.projectId}/rituals/${fixture.definitionId}`);

			await page.getByTestId('ritual-procedure-input').fill(searchToken);
			await page.getByRole('option', { name: documentTitle }).click();

			// The warning comes BEFORE the attachment is recorded, not after it. Asserting
			// only that the warning exists somewhere on the page would pass for a design
			// that grants the access first and explains it afterwards.
			await expect(page.getByTestId('ritual-procedure-access-warning')).toBeVisible();
			await expect(page.getByTestId('ritual-procedure-current')).toHaveCount(0);

			await page.getByTestId('ritual-procedure-access-warning-confirm').click();
			await expect(page.getByTestId('ritual-procedure-current-title')).toHaveText(documentTitle);
		});

		// The plan's contract named this scenario "the chooser lists only documents the
		// manager can already read". It is renamed because that is not what the system does:
		// the list is organization-scoped (D49) and the rule is enforced when the attachment
		// is written. The guarantee FR-007 actually makes is the one asserted here.
		test('a document the manager cannot read themselves cannot become the procedure', async ({ page }) => {
			test.setTimeout(120_000);
			await loginAs(page, owner);
			await page.goto(`/workspace/tasks/${fixture.projectId}/rituals/${fixture.definitionId}`);

			// The manager's own document is found, which is what proves the result below is
			// a decision about the document rather than a query that matches nothing.
			await page.getByTestId('ritual-procedure-input').fill(searchToken);
			await expect(page.getByRole('option', { name: documentTitle })).toBeVisible();

			// The rule is enforced on the write, not on the list. `SearchDocuments` is
			// organization-scoped rather than access-scoped (drift D49), so the chooser may
			// well offer a document this manager cannot open — the server refuses to attach
			// it, and that refusal is what FR-007 actually guarantees. Asserting the option
			// is absent from the list would assert something the system does not do, and
			// would pass vacuously whenever the search simply returned nothing.
			await expect(
				api.updateRitualDefinitionProcedure(owner, fixture.definitionId, unreadableDocId),
			).rejects.toThrow();
		});
	});

	// -------------------------------------------------------------------------
	// US1 — read the procedure while doing the ritual
	// -------------------------------------------------------------------------
	test.describe('when a worker opens a ritual instance whose ritual has a procedure', () => {
		let owner: TestUser;
		let worker: TestUser;
		let fixture: RitualFixture;
		let documentTitle: string;

		test.beforeAll(async () => {
			test.setTimeout(180_000);
			owner = await createTestOrg();
			worker = await createTestEmployee(owner);

			documentTitle = `Walkthrough SOP ${crypto.randomUUID().slice(0, 8)}`;
			// Private, and never shared with the worker. If the worker could read it
			// through docs, this scenario would prove nothing about the implicit grant.
			const doc = await api.createDocument(owner, {
				title: documentTitle,
				contentJson: procedureContent('Walk the floor from the loading bay to the gate.'),
			});
			fixture = await createRitualProject(owner, worker, 'Procedure Read', doc.document.id);
		});

		test('a worker opens a ritual instance and the procedure entry point carries the document title', async ({
			page,
		}) => {
			test.setTimeout(120_000);
			await openInstance(page, worker, fixture);

			const entry = page.getByTestId('ritual-procedure-entry').first();
			await expect(entry).toBeVisible();
			await expect(entry).toHaveText(documentTitle);

			await entry.click();
			await expect(page.getByTestId('procedure-dialog-title')).toHaveText(documentTitle);
			await expect(page.getByTestId('procedure-dialog-content')).toContainText(
				'Walk the floor from the loading bay to the gate.',
			);
		});

		test('opening the procedure from the evidence capture form keeps the already-attached file and typed note', async ({
			page,
		}) => {
			test.setTimeout(120_000);
			await openInstance(page, worker, fixture);

			await page.getByTestId(`submit-evidence-btn-${fixture.requirementId}`).click();
			await expect(page.getByTestId('evidence-submit-form')).toBeVisible();

			const note = 'Bay door was already open when I arrived';
			await page.getByTestId('evidence-text-input').fill(note);

			await page.getByTestId('evidence-procedure-entry').click();
			await expect(page.getByTestId('procedure-dialog-title')).toHaveText(documentTitle);
			await page.getByTestId('procedure-dialog-close').click();
			await expect(page.getByTestId('procedure-dialog')).toHaveCount(0);

			// The form was overlaid, never unmounted, so the typed note is still here.
			await expect(page.getByTestId('evidence-text-input')).toHaveValue(note);
		});
	});

	test.describe('when the ritual has no procedure', () => {
		let owner: TestUser;
		let worker: TestUser;
		let fixture: RitualFixture;

		test.beforeAll(async () => {
			test.setTimeout(180_000);
			owner = await createTestOrg();
			worker = await createTestEmployee(owner);
			fixture = await createRitualProject(owner, worker, 'No Procedure');
		});

		test('an instance whose ritual has no procedure shows no entry point and no placeholder', async ({
			page,
		}) => {
			test.setTimeout(120_000);
			await openInstance(page, worker, fixture);

			// Nothing at all — not a disabled control, not an "no procedure" note. An
			// absent procedure must leave the instance rendering exactly as it did before
			// this feature existed (FR-017, SC-007).
			await expect(page.getByTestId('ritual-procedure-entry')).toHaveCount(0);
			await expect(page.getByTestId('evidence-procedure-entry')).toHaveCount(0);
		});
	});

	test.describe('when the attached procedure document has been deleted', () => {
		let owner: TestUser;
		let worker: TestUser;
		let fixture: RitualFixture;

		test.beforeAll(async () => {
			test.setTimeout(180_000);
			owner = await createTestOrg();
			worker = await createTestEmployee(owner);

			const doc = await api.createDocument(owner, {
				title: `Doomed SOP ${crypto.randomUUID().slice(0, 8)}`,
				contentJson: procedureContent('This document is about to be deleted.'),
			});
			fixture = await createRitualProject(owner, worker, 'Procedure Gone', doc.document.id);
			await api.deleteDocument(owner, doc.document.id);
		});

		test('a deleted procedure document shows an unavailable state and evidence submission still works', async ({
			page,
		}) => {
			test.setTimeout(120_000);
			await openInstance(page, worker, fixture);

			// Attached-but-unresolvable is a different state from never-attached. Hiding
			// the entry point here would tell the worker there was never a procedure for a
			// ritual that has one (FR-022).
			const entry = page.getByTestId('ritual-procedure-entry').first();
			await expect(entry).toBeVisible();
			await entry.click();
			await expect(page.getByTestId('procedure-dialog-unavailable')).toBeVisible();
			await page.getByTestId('procedure-dialog-close').click();

			// An unavailable procedure never blocks the work.
			await page.getByTestId(`submit-evidence-btn-${fixture.requirementId}`).click();
			await page.getByTestId('evidence-text-input').fill('Gate checked despite the missing procedure');
			await page.getByTestId('evidence-submit-btn').click();
			await expect(page.getByTestId('approval-badge-pending_review').first()).toBeVisible({
				timeout: 30_000,
			});
		});
	});

	// -------------------------------------------------------------------------
	// US3 — decide evidence against the procedure
	// -------------------------------------------------------------------------
	test.describe('when a reviewer decides evidence against the procedure', () => {
		let owner: TestUser;
		let worker: TestUser;
		let fixture: RitualFixture;
		let submissionId: string;

		test.beforeAll(async () => {
			test.setTimeout(180_000);
			owner = await createTestOrg();
			worker = await createTestEmployee(owner);

			const doc = await api.createDocument(owner, {
				title: `Review SOP ${crypto.randomUUID().slice(0, 8)}`,
				contentJson: procedureContent('A gate photo must show the padlock closed.'),
			});
			fixture = await createRitualProject(owner, worker, 'Procedure Review', doc.document.id);

			const submission = await api.submitEvidence(worker, {
				evidenceRequirementId: fixture.requirementId,
				taskId: fixture.taskId,
				evidenceType: 'EVIDENCE_TYPE_TEXT_NOTE',
				textContent: 'Padlock looked fine',
			});
			submissionId = submission.evidenceSubmission.id;
		});

		test('a reviewer opens the procedure from the review queue and returns to the same entry with the rejection reason still typed', async ({
			page,
		}) => {
			test.setTimeout(120_000);
			await loginAs(page, owner);
			await page.goto('/workspace/reviews');

			const row = page.getByTestId(`review-queue-row-${submissionId}`);
			await expect(row).toBeVisible({ timeout: 30_000 });

			await row.getByTestId('review-queue-reject-btn').click();
			const reason = 'The photo does not show the padlock, see the procedure';
			await page.getByTestId('review-queue-reject-reason-input').fill(reason);

			// The reject dialog is modal, so the row's own Procedure control is behind it.
			// The control is repeated inside the dialog for exactly this moment.
			await page.getByTestId('review-queue-reject-procedure-btn').click();
			await expect(page.getByTestId('procedure-dialog-content')).toContainText(
				'A gate photo must show the padlock closed.',
			);
			await page.getByTestId('procedure-dialog-close').click();

			// The queue was overlaid, never navigated away from, so both the reviewer's
			// place in it and the reason they had already typed survive (FR-014).
			await expect(row).toBeVisible();
			await expect(page.getByTestId('review-queue-reject-reason-input')).toHaveValue(reason);
		});
	});
});
