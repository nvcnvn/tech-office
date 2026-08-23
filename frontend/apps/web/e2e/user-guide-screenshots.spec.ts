/**
 * Seeds the "Bright Bean Coffee" demo workspace and captures the screenshots
 * used by the end-user guides in content/guides/, which are also what the
 * public /docs site renders.
 *
 * Run against a live local backend + postgres:
 *   cd frontend && pnpm --filter web exec playwright test \
 *     --config=apps/web/e2e/playwright.config.ts user-guide-screenshots
 *
 * The subdomain is fixed so the sign-in screenshots match the written guides,
 * and any previous run of it is dropped first so this is re-runnable.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';
import { execFileSync } from 'node:child_process';
import path from 'path';
import fs from 'fs';

const API_BASE = process.env.E2E_API_URL || 'http://localhost:18080';
const SUBDOMAIN = process.env.SEED_SUBDOMAIN || 'brightbean';
// The guides reference these as `images/foo.png`; the site serves the same
// files from /docs/foo.png. public/docs is the one place they live.
const IMAGES_DIR = path.resolve(process.cwd(), 'public/docs');
const OWNER_EMAIL = `dana.whitfield@${SUBDOMAIN}.example`;

// ---------------------------------------------------------------------------
// Seeding primitives (named people, unlike helpers/auth's anonymous fixtures)
// ---------------------------------------------------------------------------

async function rpc<T>(path: string, body: unknown, token?: string): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Connection: 'close',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`RPC ${path} failed (${res.status}): ${await res.text()}`);
	return res.json() as Promise<T>;
}

// Tables whose organization_id FK is NOT ON DELETE CASCADE, children first.
// Without these the org row cannot be deleted and the seed is not re-runnable.
const NON_CASCADING_TABLES = [
	'calendar.audit_entry',
	'calendar.check_in',
	'calendar.event_reminder',
	'calendar.recurrence_exception',
	'calendar.resource_booking',
	'calendar.attendee',
	'calendar.delegation',
	'calendar.booking_link',
	'calendar.working_hours',
	'calendar.resource_acl',
	'calendar.event',
	'calendar.resource',
	'collaboration.evidence_submission',
	'collaboration.evidence_requirement',
	// task RESTRICTs ritual_definition, so it has to go first even though its own
	// organization_id FK does cascade.
	'collaboration.task',
	'collaboration.ritual_definition_assignee',
	'collaboration.ritual_definition_department_pool',
	'collaboration.ritual_definition',
	'notification.ephemeral_signal',
	'notification.presence_visibility',
	'notification.push_token',
];

/** Drops a previous seed so the fixed subdomain can be reused. */
function purgePreviousSeed() {
	const org = `(SELECT id FROM public.organization WHERE subdomain = '${SUBDOMAIN}')`;
	const sql = [
		...NON_CASCADING_TABLES.map((t) => `DELETE FROM ${t} WHERE organization_id IN ${org};`),
		`DELETE FROM public.organization WHERE subdomain = '${SUBDOMAIN}';`,
		// iam.user is global, so it survives the org cascade and would collide on email.
		`DELETE FROM iam."user" WHERE email = '${OWNER_EMAIL}';`,
	].join('\n');

	execFileSync(
		'docker',
		[
			'compose', '-f', path.resolve(process.cwd(), '../../../backend/docker-compose.yml'),
			'exec', '-T', 'postgres',
			'psql', '-U', 'postgres', '-d', 'tech_office_db', '-v', 'ON_ERROR_STOP=1', '-c', sql,
		],
		{ encoding: 'utf8' },
	);
}

async function registerOwner(): Promise<TestUser> {
	const email = OWNER_EMAIL;
	const password = 'BrightBean2026!';
	const org = await rpc<{ organization: { id: string } }>(
		'/rpc.v1.OrganizationService/RegisterOrganizationWithAdminPassword',
		{
			companyName: 'Bright Bean Coffee',
			subdomain: SUBDOMAIN,
			adminEmail: email,
			adminPassword: password,
			adminGivenName: 'Dana',
			adminFamilyName: 'Whitfield',
		},
	);
	const login = await rpc<{ accessToken: string; expiresAt: string; user: { id: string } }>(
		'/rpc.v1.IAMService/Login',
		{ email, password },
	);
	return {
		id: login.user.id,
		email,
		token: login.accessToken,
		expiresAt: Number(login.expiresAt),
		orgId: org.organization.id,
		orgSubdomain: SUBDOMAIN,
	};
}

/** Creates a PIN ("account ID") worker — the deskless-staff path. */
async function createWorker(
	owner: TestUser,
	loginIdentifier: string,
	givenName: string,
	familyName: string,
): Promise<TestUser> {
	const acct = await rpc<{ id: string; loginIdentifier: string; temporaryPin: string }>(
		'/rpc.v1.IAMService/CreateOrgAccount',
		{
			loginIdentifier,
			displayName: `${givenName} ${familyName}`,
			givenName,
			familyName,
		},
		owner.token,
	);
	const first = await rpc<{
		accessToken: string;
		expiresAt: string;
		pinChangeRequired: boolean;
		pinChangeToken: string;
	}>('/rpc.v1.IAMService/LoginWithPIN', {
		organizationSubdomain: owner.orgSubdomain,
		loginIdentifier: acct.loginIdentifier,
		pin: acct.temporaryPin,
	});

	let token = first.accessToken;
	let expiresAt = Number(first.expiresAt);
	if (first.pinChangeRequired) {
		const set = await rpc<{ accessToken: string; expiresAt: string }>('/rpc.v1.IAMService/SetPIN', {
			newPin: '284915',
			pinChangeToken: first.pinChangeToken,
		});
		token = set.accessToken;
		expiresAt = Number(set.expiresAt);
	}
	return {
		id: acct.id,
		email: loginIdentifier,
		token,
		expiresAt,
		orgId: owner.orgId,
		orgSubdomain: owner.orgSubdomain,
	};
}

async function createDepartment(owner: TestUser, name: string, description: string) {
	const resp = await rpc<{ department: { id: string } }>(
		'/rpc.v1.DepartmentService/CreateDepartment',
		{ name, description },
		owner.token,
	);
	return resp.department.id;
}

async function assignToDepartment(
	owner: TestUser,
	departmentId: string,
	employeeId: string,
	role: 'member' | 'manager',
) {
	// Assigning with role 'manager' is the whole operation — SetDepartmentManager
	// is a promotion RPC and errors when the member is already a manager.
	await rpc('/rpc.v1.DepartmentService/AssignEmployeeToDepartment', { departmentId, employeeId, role }, owner.token);
}

/** helpers/api.createRitualDefinition is daily-only; stores need weekly too. */
async function createRitual(
	owner: TestUser,
	opts: {
		projectId: string;
		name: string;
		description: string;
		assigneeIds: string[];
		weekly?: number[];
		completionWindowHours?: number;
		requirements: Array<{
			name: string;
			description: string;
			evidenceTypes: string[];
			approvalMode?: string;
		}>;
	},
) {
	const resp = await rpc<{
		ritualDefinition: { id: string; evidenceRequirements: Array<{ id: string; name: string }> };
	}>(
		'/rpc.v1.CollaborationService/CreateRitualDefinition',
		{
			projectId: opts.projectId,
			name: opts.name,
			description: opts.description,
			recurrenceRule: opts.weekly
				? { type: 'RECURRENCE_TYPE_WEEKLY', interval: 1, daysOfWeek: opts.weekly, dayOfMonth: 0 }
				: { type: 'RECURRENCE_TYPE_DAILY', interval: 1, daysOfWeek: [], dayOfMonth: 0 },
			completionWindowHours: opts.completionWindowHours ?? 24,
			timezone: 'UTC',
			defaultAssigneeIds: opts.assigneeIds,
			defaultDepartmentPools: [],
			evidenceRequirements: opts.requirements.map((r) => ({
				name: r.name,
				description: r.description,
				evidenceTypes: r.evidenceTypes,
				isRequired: true,
				approvalMode: r.approvalMode ?? 'APPROVAL_MODE_MANUAL',
				deadlineOffsetHours: 0,
			})),
		},
		owner.token,
	);
	return resp.ritualDefinition;
}

async function todaysInstance(owner: TestUser, projectId: string, definitionId: string) {
	const today = new Date().toISOString().slice(0, 10);
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const { tasks } = await api.listTasks(owner, projectId, { taskKind: 'TASK_KIND_RITUAL_INSTANCE' });
		const hit = (tasks ?? []).find(
			(t) => t.ritualDefinitionId === definitionId && (t.scheduledDate ?? '').slice(0, 10) === today,
		);
		if (hit) return hit;
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error(`No instance for definition ${definitionId} scheduled today`);
}

function isoAt(dayOffset: number, hour: number, minute = 0) {
	const d = new Date();
	d.setDate(d.getDate() + dayOffset);
	d.setHours(hour, minute, 0, 0);
	return d.toISOString();
}

function paragraphDoc(lines: string[]) {
	return JSON.stringify({
		type: 'doc',
		content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
	});
}

/**
 * Suppresses the two things that make a dev-server screenshot look broken:
 * the Next.js dev overlay and the browser-notification permission banner.
 */
async function prepare(page: Page) {
	await page.addInitScript(() => {
		const forever = String(Date.now() + 365 * 24 * 3600 * 1000);
		localStorage.setItem('notification-banner-dismissed', forever);
		localStorage.setItem('notification-sound-banner-dismissed', forever);
		document.addEventListener('DOMContentLoaded', () => {
			const style = document.createElement('style');
			style.textContent =
				'nextjs-portal, [data-nextjs-toast], .MuiSnackbar-root { display: none !important; }';
			document.head.appendChild(style);
		});
	});
}

async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
	await page.waitForTimeout(2500);
	await page.screenshot({ path: path.join(IMAGES_DIR, `${name}.png`), fullPage: opts.fullPage ?? false });
}

// ---------------------------------------------------------------------------
// The Bright Bean Coffee workspace
// ---------------------------------------------------------------------------

const seed = {
	owner: null as unknown as TestUser, // Dana Whitfield — founder
	mai: null as unknown as TestUser, // Mai Tran — Riverside store manager
	leo: null as unknown as TestUser, // Leo Alvarez — Riverside barista
	priya: null as unknown as TestUser, // Priya Nair — Old Town store manager
	sam: null as unknown as TestUser, // Sam Okafor — Old Town barista
	projectId: '',
	openingDefId: '',
	openingTaskId: '',
	openingReqIds: [] as string[],
	closingDefId: '',
	riversideChannelId: '',
	announceChannelId: '',
	pendingSubmissionId: '',
};

test.describe('Bright Bean Coffee — user guide screenshots', () => {
	test.beforeAll(async () => {
		test.setTimeout(300_000);
		fs.mkdirSync(IMAGES_DIR, { recursive: true });
		purgePreviousSeed();

		// --- People -----------------------------------------------------------
		seed.owner = await registerOwner();
		seed.mai = await createWorker(seed.owner, 'mai.tran', 'Mai', 'Tran');
		seed.leo = await createWorker(seed.owner, 'leo.alvarez', 'Leo', 'Alvarez');
		seed.priya = await createWorker(seed.owner, 'priya.nair', 'Priya', 'Nair');
		seed.sam = await createWorker(seed.owner, 'sam.okafor', 'Sam', 'Okafor');

		const riverside = await createDepartment(seed.owner, 'Riverside Store', '42 Riverside Ave — open 07:00–19:00');
		const oldTown = await createDepartment(seed.owner, 'Old Town Store', '8 Market Square — open 07:30–18:00');
		const headOffice = await createDepartment(seed.owner, 'Head Office', 'Roasting, purchasing and payroll');
		await assignToDepartment(seed.owner, riverside, seed.mai.id, 'manager');
		await assignToDepartment(seed.owner, riverside, seed.leo.id, 'member');
		await assignToDepartment(seed.owner, oldTown, seed.priya.id, 'manager');
		await assignToDepartment(seed.owner, oldTown, seed.sam.id, 'member');
		await assignToDepartment(seed.owner, headOffice, seed.owner.id, 'manager');

		// --- Store Operations project ----------------------------------------
		const project = await api.createProject(seed.owner, {
			name: 'Store Operations',
			key: 'STORE',
			visibility: 'PROJECT_VISIBILITY_PUBLIC',
			collaborationMode: 'COLLABORATION_MODE_MIXED',
		});
		seed.projectId = project.project.id;
		for (const person of [seed.mai, seed.priya]) {
			await api.addProjectMember(seed.owner, seed.projectId, person.id, 'PROJECT_MEMBER_ROLE_ADMIN');
		}
		for (const person of [seed.leo, seed.sam]) {
			await api.addProjectMember(seed.owner, seed.projectId, person.id, 'PROJECT_MEMBER_ROLE_MEMBER');
		}

		// --- Rituals ----------------------------------------------------------
		const opening = await createRitual(seed.owner, {
			projectId: seed.projectId,
			name: 'Riverside opening checklist',
			description:
				'Run before the doors open. Grinder calibrated, pastry case stocked, fridge temperature inside range.',
			assigneeIds: [seed.leo.id],
			completionWindowHours: 6,
			requirements: [
				{
					name: 'Fridge temperature reading',
					description: 'Write down the number on the fridge display. Must be between 1°C and 4°C.',
					evidenceTypes: ['EVIDENCE_TYPE_TEXT_NOTE'],
				},
				{
					name: 'Pastry case photo',
					description: 'One photo of the filled pastry case, taken from the customer side.',
					evidenceTypes: ['EVIDENCE_TYPE_PHOTO'],
				},
				{
					name: 'Espresso shot dialled in',
					description: 'Note the dose, yield and shot time you settled on this morning.',
					evidenceTypes: ['EVIDENCE_TYPE_TEXT_NOTE'],
				},
			],
		});
		seed.openingDefId = opening.id;
		seed.openingReqIds = opening.evidenceRequirements.map((r) => r.id);

		const closing = await createRitual(seed.owner, {
			projectId: seed.projectId,
			name: 'Riverside closing checklist',
			description: 'Run at close. Cash counted, machine backflushed, alarm set.',
			assigneeIds: [seed.leo.id],
			requirements: [
				{
					name: 'Till count',
					description: 'Cash total after the drop, to the cent.',
					evidenceTypes: ['EVIDENCE_TYPE_TEXT_NOTE'],
				},
				{
					name: 'Alarm set confirmation',
					description: 'Confirm the alarm was armed and the back door locked.',
					evidenceTypes: ['EVIDENCE_TYPE_TEXT_NOTE'],
				},
			],
		});
		seed.closingDefId = closing.id;

		await createRitual(seed.owner, {
			projectId: seed.projectId,
			name: 'Old Town opening checklist',
			description: 'Same checks as Riverside, run by the Old Town team.',
			assigneeIds: [seed.sam.id],
			completionWindowHours: 6,
			requirements: [
				{
					name: 'Fridge temperature reading',
					description: 'Write down the number on the fridge display.',
					evidenceTypes: ['EVIDENCE_TYPE_TEXT_NOTE'],
				},
				{
					name: 'Pastry case photo',
					description: 'One photo of the filled pastry case.',
					evidenceTypes: ['EVIDENCE_TYPE_PHOTO'],
				},
			],
		});

		await createRitual(seed.owner, {
			projectId: seed.projectId,
			name: 'Weekly deep clean',
			description: 'Group heads stripped, hoppers washed, drains flushed. Both stores, Monday mornings.',
			assigneeIds: [seed.mai.id, seed.priya.id],
			weekly: [1],
			requirements: [
				{
					name: 'Deep clean sign-off',
					description: 'Confirm every station on the wall card was cleaned, and note anything you could not finish.',
					evidenceTypes: ['EVIDENCE_TYPE_TEXT_NOTE'],
				},
			],
		});

		// --- One-off tasks ----------------------------------------------------
		const levelId = project.levels[0]?.id;
		const grinder = await api.createTask(seed.owner, seed.projectId, 'Grinder #2 keeps jamming — book a service visit', {
			levelId,
		});
		await api.assignTask(seed.owner, grinder.task.id, seed.mai.id);
		api.setStandardTaskDueToday(grinder.task.id);

		const oatMilk = await api.createTask(seed.owner, seed.projectId, 'Increase oat milk standing order to 40 cases', {
			levelId,
		});
		await api.assignTask(seed.owner, oatMilk.task.id, seed.owner.id);

		const onboarding = await api.createTask(seed.owner, seed.projectId, 'Onboard new weekend barista at Old Town', {
			levelId,
		});
		await api.assignTask(seed.owner, onboarding.task.id, seed.priya.id);

		const summerMenu = await api.createTask(seed.owner, seed.projectId, 'Price the summer cold brew menu', { levelId });
		await api.assignTask(seed.owner, summerMenu.task.id, seed.owner.id);

		// --- Chat -------------------------------------------------------------
		const announce = await api.createChannel(seed.owner, {
			titleSlug: 'announcements',
			displayName: 'Announcements',
		});
		seed.announceChannelId = announce.channel.id;
		const riversideChannel = await api.createChannel(seed.owner, {
			titleSlug: 'riverside-store',
			displayName: 'Riverside Store',
		});
		seed.riversideChannelId = riversideChannel.channel.id;
		const oldTownChannel = await api.createChannel(seed.owner, {
			titleSlug: 'old-town-store',
			displayName: 'Old Town Store',
		});

		for (const person of [seed.mai, seed.leo, seed.priya, seed.sam]) {
			await api.inviteMember(seed.owner, seed.announceChannelId, person.id);
		}
		for (const person of [seed.mai, seed.leo]) {
			await api.inviteMember(seed.owner, seed.riversideChannelId, person.id);
		}
		for (const person of [seed.priya, seed.sam]) {
			await api.inviteMember(seed.owner, oldTownChannel.channel.id, person.id);
		}

		await api.sendMessage(
			seed.owner,
			seed.announceChannelId,
			'New oat milk supplier starts Monday. Same brand, new cartons — the barcode changed, so scan carefully on delivery.',
		);
		await api.sendMessage(
			seed.owner,
			seed.announceChannelId,
			'Summer menu tasting is Thursday 15:00 at Riverside. Both stores send one person.',
		);

		await api.sendMessage(seed.mai, seed.riversideChannelId, 'Morning all — delivery is running about an hour late today.');
		const leoMsg = await api.sendMessage(
			seed.leo,
			seed.riversideChannelId,
			'Opening checklist done. Fridge is at 3°C, pastry case photo is on the run.',
		);
		await api.replyToMessage(seed.mai, leoMsg.message.id, 'Thanks Leo — approved. Grinder service is booked for Thursday.');
		await api.sendMessage(
			seed.leo,
			seed.riversideChannelId,
			'We are down to two bags of the house blend. Enough for tomorrow, not for the weekend.',
		);

		const dm = await api.createOrGetDirectMessage(seed.mai, seed.leo.id);
		await api.sendMessage(seed.mai, dm.channel.id, 'Can you cover the Saturday open? Priya is short at Old Town.');
		await api.sendMessage(seed.leo, dm.channel.id, 'Yes, I can do it. I will swap my Sunday.');

		// --- Calendar ---------------------------------------------------------
		const roastery = await api.createResource(seed.owner, {
			name: 'Roastery Room',
			resourceType: 'room',
			capacity: 8,
		});
		await api.createResource(seed.owner, { name: 'Delivery Van', resourceType: 'vehicle', capacity: 2 });

		await api.createEvent(seed.owner, {
			title: 'Riverside opening shift',
			eventType: 'shift',
			visibility: 'team',
			startTime: isoAt(0, 6, 30),
			endTime: isoAt(0, 14, 0),
			locationText: '42 Riverside Ave',
			requiredAttendeeIds: [seed.leo.id],
		});
		await api.createEvent(seed.owner, {
			title: 'Riverside closing shift',
			eventType: 'shift',
			visibility: 'team',
			startTime: isoAt(0, 13, 30),
			endTime: isoAt(0, 19, 30),
			locationText: '42 Riverside Ave',
			requiredAttendeeIds: [seed.mai.id],
		});
		await api.createEvent(seed.owner, {
			title: 'Store managers weekly sync',
			eventType: 'meeting',
			visibility: 'team',
			startTime: isoAt(1, 9, 0),
			endTime: isoAt(1, 9, 45),
			locationText: 'Roastery Room',
			requiredAttendeeIds: [seed.mai.id, seed.priya.id],
			resourceIds: [roastery.resource.id],
		});
		await api.createEvent(seed.owner, {
			title: 'Summer menu tasting',
			eventType: 'company_event',
			visibility: 'org_wide',
			startTime: isoAt(2, 15, 0),
			endTime: isoAt(2, 16, 30),
			locationText: 'Riverside — back room',
			requiredAttendeeIds: [seed.mai.id, seed.priya.id],
			optionalAttendeeIds: [seed.leo.id, seed.sam.id],
		});
		await api.createEvent(seed.owner, {
			title: 'Coffee delivery — Riverside',
			eventType: 'deadline',
			visibility: 'team',
			startTime: isoAt(1, 7, 0),
			endTime: isoAt(1, 8, 0),
			locationText: '42 Riverside Ave',
			requiredAttendeeIds: [seed.leo.id],
		});

		// --- Docs -------------------------------------------------------------
		const standards = await api.createDocument(seed.owner, {
			title: 'Espresso bar standards',
			visibility: 'DOCUMENT_VISIBILITY_PUBLIC',
			contentJson: paragraphDoc([
				'Every drink that leaves the bar follows these numbers. If a shot falls outside them, re-dial before serving.',
				'Dose: 18 g in the double basket, levelled and tamped flat.',
				'Yield: 36 g in the cup, measured on the scale, not by eye.',
				'Time: 26 to 30 seconds from the moment the pump starts.',
				'Milk: steamed to 60–65°C. Never re-steam milk that has already been heated.',
				'If the grinder has been sitting overnight, purge two doses before the first shot of the day.',
			]),
		});
		await api.createDocument(seed.owner, {
			title: 'Opening and closing procedure',
			visibility: 'DOCUMENT_VISIBILITY_PUBLIC',
			contentJson: paragraphDoc([
				'This is the written version of the opening and closing checklists. The checklist in Store Operations is what you actually tick off; this page explains why each step exists.',
				'Fridge temperature: dairy above 4°C for more than two hours must be thrown out. Reading it at open is what makes that call possible.',
				'Pastry case photo: settles supplier disputes about short deliveries, and shows head office what the case looked like before the morning rush.',
				'Till count at close: counted twice, by one person, with the door locked.',
				'Alarm: armed last, after the back door is checked.',
			]),
		});
		await api.createDocument(seed.owner, {
			title: 'New barista first week',
			visibility: 'DOCUMENT_VISIBILITY_PUBLIC',
			contentJson: paragraphDoc([
				'Day one: shadow an open. Do not work the bar alone.',
				'Day two: espresso bar standards, then dial in under supervision.',
				'Day three: run the opening checklist yourself with your manager watching.',
				'Day five: first solo open, with your manager reachable by phone.',
			]),
		});
		await api.setDocumentAccess(seed.owner, standards.document.id, seed.leo.id, 'ACCESS_LEVEL_READ_COMMENT');

		// --- Today's evidence, mid-flight -------------------------------------
		const openingTask = await todaysInstance(seed.owner, seed.projectId, seed.openingDefId);
		seed.openingTaskId = openingTask.id;

		const fridge = await api.submitEvidence(seed.leo, {
			taskId: seed.openingTaskId,
			evidenceRequirementId: seed.openingReqIds[0],
			textContent: '3°C on the display at 06:40. Door seal checked, no ice build-up.',
		});
		await api.approveEvidence(seed.mai, {
			evidenceSubmissionId: fridge.evidenceSubmission.id,
			comment: 'Good — thanks for noting the seal.',
		});

		// The pastry-case requirement takes a photo, which this seed cannot upload,
		// so the pending-review example is the espresso note. That also leaves the
		// photo requirement outstanding, which is a truer mid-shift state.
		const shot = await api.submitEvidence(seed.leo, {
			taskId: seed.openingTaskId,
			evidenceRequirementId: seed.openingReqIds[2],
			textContent: '18.0 g in, 36.2 g out, 28 seconds. Dialled one notch finer than yesterday.',
		});
		seed.pendingSubmissionId = shot.evidenceSubmission.id;

		// Old Town has a run waiting on proof, so the health view is not all green.
		const closingTask = await todaysInstance(seed.owner, seed.projectId, seed.closingDefId);
		void closingTask;
	});

	test.use({ viewport: { width: 1440, height: 900 } });

	test('sign-in screens', async ({ page }) => {
		await prepare(page);
		// Reached over "localhost" rather than the config's 127.0.0.1, because the
		// page derives the subdomain from the hostname first and reads the dotted IP
		// as the subdomain "127"; only a hostname with no subdomain lets ?org= win.
		const signinUrl = `${(test.info().project.use.baseURL ?? '').replace('127.0.0.1', 'localhost')}/signin?org=${SUBDOMAIN}`;
		await page.goto(signinUrl);
		await page.waitForTimeout(2000);
		await shot(page, 'signin-organization');

		await page.getByTestId('identifier-input').fill('leo.alvarez');
		await page.waitForTimeout(500);
		await shot(page, 'signin-account-id');

		await page.getByTestId('identifier-input').fill(seed.owner.email);
		await page.waitForTimeout(500);
		await shot(page, 'signin-email');
	});

	test('owner setup screens', async ({ page }) => {
		await prepare(page);
		await loginAs(page, seed.owner);

		await page.goto('/workspace/organization?tab=employees');
		await shot(page, 'admin-employees');

		await page.goto('/workspace/organization?tab=departments');
		await shot(page, 'admin-departments');

		await page.goto(`/workspace/tasks/${seed.projectId}?view=overview`);
		await shot(page, 'admin-project-overview');

		await page.goto(`/workspace/tasks/${seed.projectId}/rituals/${seed.openingDefId}`);
		await shot(page, 'admin-ritual-definition', { fullPage: true });

	});

	test('manager review screens', async ({ page }) => {
		await prepare(page);
		await loginAs(page, seed.mai);

		await page.goto(`/workspace/tasks/${seed.projectId}?view=review`);
		await shot(page, 'manager-review-backlog');

		await page.goto(`/workspace/tasks/${seed.projectId}/tasks/${seed.openingTaskId}?focusIntent=review_pending`);
		await shot(page, 'manager-review-evidence', { fullPage: true });
	});

	test('frontline daily screens', async ({ page }) => {
		await prepare(page);
		await loginAs(page, seed.leo);

		await page.goto(`/workspace/tasks/${seed.projectId}?view=today`);
		await shot(page, 'employee-my-work');

		await page.goto(`/workspace/tasks/${seed.projectId}/tasks/${seed.openingTaskId}`);
		await shot(page, 'employee-ritual-instance', { fullPage: true });

		await page.goto(`/workspace/chat?channel=${seed.riversideChannelId}`);
		await shot(page, 'employee-chat');

		await page.goto('/workspace/calendar');
		await shot(page, 'employee-calendar');

		await page.goto('/workspace/notifications');
		await shot(page, 'employee-notifications');

		await page.goto('/workspace/docs');
		await page.getByText('Espresso bar stand', { exact: false }).first().click();
		await shot(page, 'employee-docs');

		await page.goto('/workspace/search?q=opening');
		await shot(page, 'employee-search');
	});

	test('the seeded workspace is coherent', async () => {
		// Cheap guard: the screenshots above are only worth anything if the seed
		// actually produced the state the guides describe.
		const { tasks } = await api.listTasks(seed.owner, seed.projectId, {
			taskKind: 'TASK_KIND_RITUAL_INSTANCE',
		});
		expect(tasks.length).toBeGreaterThan(0);

		const submissions = await api.apiCall<{ evidenceSubmissions: Array<{ id: string; approvalStatus: string }> }>(
			seed.mai,
			'/rpc.v1.CollaborationService/ListEvidenceSubmissions',
			{ taskId: seed.openingTaskId },
		);
		const statuses = submissions.evidenceSubmissions.map((s) => s.approvalStatus);
		expect(statuses).toContain('APPROVAL_STATUS_APPROVED');
		expect(statuses).toContain('APPROVAL_STATUS_PENDING_REVIEW');
	});
});
