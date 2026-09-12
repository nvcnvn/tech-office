/**
 * E2E API helpers — thin wrappers around ConnectRPC endpoints
 * used in the "arrange" step of tests. Mirrors backend testWorld act helpers.
 *
 * All calls go directly to the backend (no browser needed).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { TestUser } from './auth';

const API_BASE = process.env.E2E_API_URL || 'http://localhost:18080';
const REPO_ROOT = resolve(process.cwd(), '../../..');
const BACKEND_COMPOSE_FILE = resolve(REPO_ROOT, 'backend/docker-compose.yml');

/**
 * The calendar date the BACKEND is currently living in, as `YYYY-MM-DD`.
 *
 * Not every "today" in this suite belongs to the same clock, and conflating them is what
 * D45 was. Two different readers decide what "today" means:
 *
 *   - the web app, for anything it computes in the browser (`TodayView`), and
 *   - the Go server, for anything bucketed server-side — `GetAssignedWorkSummary` takes
 *     its `as_of_date` from `time.Now()` in the backend process
 *     (`internal/collaboration/context_rail_logic.go`).
 *
 * A fixture has to agree with whichever of the two will read it. This helper is for the
 * second kind. It deliberately ignores a `TZ` override on the test process — the suite is
 * run under a shifted `TZ` on purpose, to prove the browser-side fixtures are
 * timezone-independent, and that override must not drag the server-side ones with it. The
 * backend is an ordinary process on this machine with no such override, so asking the OS
 * with `TZ` removed from the environment is exactly its calendar day.
 */
export function backendToday(): string {
  const env = { ...process.env };
  delete env.TZ;
  return execFileSync('date', ['+%Y-%m-%d'], { encoding: 'utf8', env }).trim();
}

/** `backendToday()` shifted by whole days, still on the backend's calendar. */
export function backendDateOffset(days: number): string {
  const [year, month, day] = backendToday().split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}


// ---------------------------------------------------------------------------
// Generic RPC call
// ---------------------------------------------------------------------------

export async function apiCall<T>(
  user: TestUser,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'close',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${path} failed (${res.status}): ${text}`);
      }
      return res.json() as Promise<T>;
    } catch (err) {
      // Retry on transient fetch/socket errors, not on HTTP errors (which throw plain Error)
      const isHttpError = err instanceof Error && err.message.startsWith('API ');
      if (!isHttpError && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`API ${path} failed after ${maxRetries} retries`);
}

// ---------------------------------------------------------------------------
// Calendar — Events
// ---------------------------------------------------------------------------

export async function createEvent(
  user: TestUser,
  opts: {
    title: string;
    eventType?: string;
    visibility?: string;
    startTime?: string;   // ISO 8601
    endTime?: string;     // ISO 8601
    allDay?: boolean;
    locationText?: string;
    virtualLink?: string;
    description?: string;
    requiredAttendeeIds?: string[];
    optionalAttendeeIds?: string[];
    resourceIds?: string[];
  },
) {
  return apiCall<{ event: { id: string } }>(
    user,
    '/rpc.v1.CalendarService/CreateEvent',
    {
      title: opts.title,
      eventType: opts.eventType ?? 'meeting',
      visibility: opts.visibility ?? 'team',
      startTime: opts.startTime,
      endTime: opts.endTime,
      allDay: opts.allDay ?? false,
      locationText: opts.locationText,
      virtualLink: opts.virtualLink,
      description: opts.description,
      requiredAttendeeIds: opts.requiredAttendeeIds ?? [],
      optionalAttendeeIds: opts.optionalAttendeeIds ?? [],
      resourceIds: opts.resourceIds ?? [],
    },
  );
}

export async function listEvents(
  user: TestUser,
  opts: { rangeStart: string; rangeEnd: string },
) {
  return apiCall<{ events: Array<{ id: string; title: string }> }>(
    user,
    '/rpc.v1.CalendarService/ListEvents',
    { rangeStart: opts.rangeStart, rangeEnd: opts.rangeEnd },
  );
}

const RSVP_STATUS_MAP = {
  accepted: 'RSVP_RESPONSE_ACCEPTED',
  declined: 'RSVP_RESPONSE_DECLINED',
  tentative: 'RSVP_RESPONSE_TENTATIVE',
} as const;

export async function respondToInvite(
  user: TestUser,
  eventId: string,
  status: 'accepted' | 'declined' | 'tentative',
  note?: string,
) {
  return apiCall(user, '/rpc.v1.CalendarService/RespondToInvite', {
    eventId,
    rsvpStatus: RSVP_STATUS_MAP[status],
    responseNote: note,
  });
}

export async function cancelEvent(user: TestUser, eventId: string) {
  return apiCall(user, '/rpc.v1.CalendarService/CancelEvent', { eventId });
}

// ---------------------------------------------------------------------------
// Calendar — Resources
// ---------------------------------------------------------------------------

export async function createResource(
  user: TestUser,
  opts: { name: string; resourceType?: string; capacity?: number },
) {
  return apiCall<{ resource: { id: string } }>(
    user,
    '/rpc.v1.CalendarService/CreateResource',
    {
      name: opts.name,
      resourceType: opts.resourceType ?? 'meeting_room',
      capacity: opts.capacity ?? 10,
    },
  );
}

export async function listResources(user: TestUser) {
  return apiCall<{ resources: Array<{ id: string; name: string }> }>(
    user,
    '/rpc.v1.CalendarService/ListResources',
    {},
  );
}

// ---------------------------------------------------------------------------
// Collaboration — Projects
// ---------------------------------------------------------------------------

export async function createProject(
  user: TestUser,
  opts: {
    name: string;
    key?: string;
    visibility?: 'PROJECT_VISIBILITY_PUBLIC' | 'PROJECT_VISIBILITY_PRIVATE';
    collaborationMode?: string;
  },
) {
  return apiCall<{
    project: {
      id: string;
      name: string;
      key: string;
      isArchived: boolean;
      visibility: string;
    };
    states: Array<{ id: string; name: string; category: string }>;
    levels: Array<{ id: string; name: string }>;
  }>(user, '/rpc.v1.CollaborationService/CreateProject', {
    name: opts.name,
    key: opts.key ?? `PRJ${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
    visibility: opts.visibility ?? 'PROJECT_VISIBILITY_PRIVATE',
    collaborationMode: opts.collaborationMode,
  });
}

export async function listProjects(
  user: TestUser,
  opts?: { includeArchived?: boolean },
) {
  return apiCall<{
    projects: Array<{
      id: string;
      name: string;
      isArchived: boolean;
      visibility: string;
    }>;
  }>(user, '/rpc.v1.CollaborationService/ListProjects', {
    includeArchived: opts?.includeArchived,
  });
}

export async function archiveProject(
  user: TestUser,
  projectId: string,
  archive: boolean,
) {
  return apiCall<{ project: { isArchived: boolean } }>(
    user,
    '/rpc.v1.CollaborationService/ArchiveProject',
    { projectId, archive },
  );
}

export async function addProjectMember(
  user: TestUser,
  projectId: string,
  employeeId: string,
  role: 'PROJECT_MEMBER_ROLE_ADMIN' | 'PROJECT_MEMBER_ROLE_MEMBER' | 'PROJECT_MEMBER_ROLE_VIEWER',
) {
  return apiCall(user, '/rpc.v1.CollaborationService/AddProjectMember', {
    projectId,
    employeeId,
    role,
  });
}

export async function removeProjectMember(
  user: TestUser,
  projectId: string,
  employeeId: string,
) {
  return apiCall(user, '/rpc.v1.CollaborationService/RemoveProjectMember', {
    projectId,
    employeeId,
  });
}

export async function listProjectMembers(user: TestUser, projectId: string) {
  return apiCall<{
    members: Array<{ employeeId: string; role: string; displayName?: string }>;
  }>(user, '/rpc.v1.CollaborationService/ListProjectMembers', { projectId });
}

export async function updateProjectMemberRole(
  user: TestUser,
  projectId: string,
  employeeId: string,
  role: string,
) {
  return apiCall(user, '/rpc.v1.CollaborationService/UpdateProjectMemberRole', {
    projectId,
    employeeId,
    role,
  });
}

// ---------------------------------------------------------------------------
// Collaboration — Tasks
// ---------------------------------------------------------------------------

export async function createTask(
  user: TestUser,
  projectId: string,
  title: string,
  opts?: { levelId?: string; parentTaskId?: string },
) {
  return apiCall<{
    task: {
      id: string;
      title: string;
      stateId: string;
      channelId?: string;
      descriptionDocumentId?: string;
      assignees: Array<{ employeeId: string; role: string }>;
      fileIds: string[];
    };
  }>(user, '/rpc.v1.CollaborationService/CreateTask', {
    projectId,
    title,
    levelId: opts?.levelId,
    parentTaskId: opts?.parentTaskId,
  });
}

export async function updateTask(
  user: TestUser,
  taskId: string,
  opts: { dueDate?: string; stateId?: string; title?: string },
) {
  return apiCall<{ task: { id: string; title: string; dueDate?: string; stateId: string } }>(
    user,
    '/rpc.v1.CollaborationService/UpdateTask',
    {
      taskId,
      dueDate: opts.dueDate,
      stateId: opts.stateId,
      title: opts.title,
    },
  );
}

export async function listTasks(
  user: TestUser,
  projectId: string,
  opts?: { stateId?: string; assigneeId?: string; taskKind?: string },
) {
  return apiCall<{
    tasks: Array<{
      id: string;
      identifier: string;
      title: string;
      stateId: string;
      taskKind?: string;
      ritualDefinitionId?: string;
      scheduledDate?: string;
      evidenceProgress?: {
        pendingReviewCount?: number;
      };
      assignees: Array<{ employeeId: string; role: string }>;
    }>;
  }>(user, '/rpc.v1.CollaborationService/ListTasks', {
    projectId,
    stateId: opts?.stateId,
    assigneeId: opts?.assigneeId,
    taskKind: opts?.taskKind,
    // Rituals generate a horizon of instances; the default page of 50 can drop today's run.
    limit: 100,
  });
}

export async function getTask(user: TestUser, taskId: string) {
  return apiCall<{
    task: {
      id: string;
      title: string;
      stateId: string;
      channelId?: string;
      descriptionDocumentId?: string;
      assignees: Array<{ employeeId: string; role: string }>;
      fileIds: string[];
    };
  }>(user, '/rpc.v1.CollaborationService/GetTask', { taskId });
}

export async function moveTask(
  user: TestUser,
  taskId: string,
  newStateId: string,
) {
  return apiCall(user, '/rpc.v1.CollaborationService/MoveTask', {
    taskId,
    newStateId,
  });
}

export async function assignTask(
  user: TestUser,
  taskId: string,
  employeeId: string,
  role?: string,
) {
  return apiCall(user, '/rpc.v1.CollaborationService/AssignTask', {
    taskId,
    employeeId,
    role: role ?? 'TASK_ASSIGNEE_ROLE_ASSIGNEE',
  });
}

export async function watchTask(user: TestUser, taskId: string) {
  return apiCall(user, '/rpc.v1.CollaborationService/WatchTask', { taskId });
}

export async function deleteTask(user: TestUser, taskId: string, deleteChildren = false) {
  return apiCall(user, '/rpc.v1.CollaborationService/DeleteTask', {
    taskId,
    deleteChildren,
  });
}

/**
 * Puts a ritual instance into the stored lateness state the reconciliation sweep would
 * have written, and backdates its deadline to match.
 *
 * Both halves matter. Every surface now reads the instance's state category rather than
 * comparing a deadline against the browser's clock, so backdating alone would leave the
 * instance looking perfectly on time.
 *
 * The two categories land on different days because one instance per definition per day is
 * a unique constraint, and seeding an overdue and a missed run of the same ritual would
 * otherwise collide. Missed being the older of the two also matches how they arise.
 */
export function forceRitualTaskLateness(taskId: string, category: 'overdue' | 'missed') {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) {
    throw new Error(`Invalid ritual task id: ${taskId}`);
  }

  const daysLate = category === 'missed' ? 2 : 1;

  const sql = `
UPDATE collaboration.task t
SET scheduled_date = CURRENT_DATE - ${daysLate},
    completion_deadline = now() - interval '${daysLate} day',
    state_id = (
      SELECT ps.id FROM collaboration.project_state ps
      WHERE ps.organization_id = t.organization_id
        AND ps.project_id = t.project_id
        AND ps.category = '${category}'
      LIMIT 1
    ),
    updated_at = now()
WHERE t.id = '${taskId}'::uuid
  AND t.task_kind = 'ritual_instance';

SELECT scheduled_date::text, completion_deadline::text
FROM collaboration.task
WHERE id = '${taskId}'::uuid;
`;

  const output = execFileSync(
    'docker',
    [
      'compose',
      '-f',
      BACKEND_COMPOSE_FILE,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'tech_office_db',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  );

  if (!output.includes('UPDATE 1')) {
    throw new Error(`Failed to force ritual task into ${category}: ${output}`);
  }
}

/**
 * Marks a standard task due "today" — where today means the same day the BROWSER will
 * call today, not the day the database container calls today.
 *
 * This used to write `CURRENT_DATE + interval '6 hour'`. `CURRENT_DATE` is evaluated by
 * Postgres, whose server timezone is `Etc/UTC`, while `TodayView` derives "today" from the
 * browser's local midnight. Whenever the machine's local calendar date runs ahead of UTC's
 * — on a UTC+7 machine, between 00:00 and 07:00 local — the two disagreed by a day and the
 * task this helper had just marked due today was filtered out of the view as yesterday's.
 * The spec then failed for part of every day, on a machine in the right timezone, with
 * nothing wrong with the product. See D45.
 *
 * The writer and the reader now share one clock: the date is computed from the test
 * process's own local time (Playwright's browser inherits the same TZ), formatted as a
 * local calendar date, and sent as a literal rather than derived in SQL. `toISOString()`
 * is deliberately NOT used to format it — that converts to UTC and would reintroduce
 * exactly the bug being removed.
 */
export function setStandardTaskDueToday(taskId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) {
    throw new Error(`Invalid standard task id: ${taskId}`);
  }

  const now = new Date();
  const localToday = [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  const sql = `
UPDATE collaboration.task
SET due_date = TIMESTAMP '${localToday} 06:00:00',
    updated_at = now()
WHERE id = '${taskId}'::uuid
  AND task_kind = 'standard';

SELECT due_date::text
FROM collaboration.task
WHERE id = '${taskId}'::uuid;
`;

  const output = execFileSync(
    'docker',
    [
      'compose',
      '-f',
      BACKEND_COMPOSE_FILE,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'tech_office_db',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  );

  if (!output.includes('UPDATE 1')) {
    throw new Error(`Failed to set standard task due date: ${output}`);
  }
}

/**
 * Runs one statement against the dev database through the compose postgres container.
 *
 * Some fixtures cannot be arranged through the API: server_timestamp is set to NOW() at
 * submission, and permissions are seeded per organization with no RPC to remove one.
 * Both are inputs the behaviour under test reads, so a test that asserts on them has to
 * be able to choose them.
 */
function execSql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'compose',
      '-f',
      BACKEND_COMPOSE_FILE,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'tech_office_db',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
}

/**
 * Removes one permission from every role in an organization, which is how a test makes
 * a person lack it. Permissions are resolved per request with no cache, so the next call
 * sees the change.
 */
export function revokeOrganizationPermission(organizationId: string, permissionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) {
    throw new Error(`Invalid organization id: ${organizationId}`);
  }
  execSql(
    `DELETE FROM iam.role_permission WHERE organization_id = '${organizationId}'::uuid AND permission_id = '${permissionId.replace(/'/g, "''")}';`,
  );
}

/**
 * Rewrites the server's record of when a submission arrived — the queue's ordering key.
 * `minutesAgo` counts backwards from now, so a smaller number is a newer submission.
 */
export function backdateEvidenceSubmission(submissionId: string, minutesAgo: number) {
  if (!/^[0-9a-f-]{36}$/i.test(submissionId)) {
    throw new Error(`Invalid evidence submission id: ${submissionId}`);
  }
  const output = execSql(
    `UPDATE collaboration.evidence_submission SET server_timestamp = now() - interval '${Math.round(minutesAgo)} minutes' WHERE id = '${submissionId}'::uuid;`,
  );
  if (!output.includes('UPDATE 1')) {
    throw new Error(`Failed to backdate evidence submission ${submissionId}: ${output}`);
  }
}

// ---------------------------------------------------------------------------
// Collaboration — Rituals and Evidence
// ---------------------------------------------------------------------------

export async function createRitualDefinition(
  user: TestUser,
  opts: {
    projectId: string;
    name: string;
    defaultAssigneeIds?: string[];
    description?: string;
    completionWindowHours?: number;
    /** Feature 043: a workspace document to attach as the ritual's written procedure. */
    procedureDocumentId?: string;
  },
) {
  return apiCall<{
    ritualDefinition: {
      id: string;
      name: string;
      evidenceRequirements: Array<{ id: string; name: string }>;
      procedure?: { documentId: string; title: string; isAvailable: boolean };
    };
  }>(user, '/rpc.v1.CollaborationService/CreateRitualDefinition', {
    projectId: opts.projectId,
    name: opts.name,
    description: opts.description ?? '',
    recurrenceRule: {
      type: 'RECURRENCE_TYPE_DAILY',
      interval: 1,
      daysOfWeek: [],
      dayOfMonth: 0,
    },
    completionWindowHours: opts.completionWindowHours ?? 24,
    timezone: 'UTC',
    defaultAssigneeIds: opts.defaultAssigneeIds ?? [],
    defaultDepartmentPools: [],
    procedureDocumentId: opts.procedureDocumentId,
  });
}

/**
 * Feature 043. `procedureDocumentId` is three-valued and the three values differ: omitted
 * leaves the attachment alone, `''` detaches, an id attaches or replaces.
 */
export async function updateRitualDefinitionProcedure(
  user: TestUser,
  ritualDefinitionId: string,
  procedureDocumentId: string,
) {
  return apiCall<{
    ritualDefinition: {
      id: string;
      procedure?: { documentId: string; title: string; isAvailable: boolean };
    };
  }>(user, '/rpc.v1.CollaborationService/UpdateRitualDefinition', {
    ritualDefinitionId,
    procedureDocumentId,
  });
}

export async function deleteDocument(user: TestUser, documentId: string) {
  return apiCall<{ success: boolean }>(user, '/rpc.v1.DocumentService/DeleteDocument', {
    id: documentId,
  });
}

export async function createEvidenceRequirement(
  user: TestUser,
  opts: {
    ritualDefinitionId: string;
    name: string;
    description?: string;
    evidenceTypes?: string[];
    approvalMode?: string;
    autoApproveConfig?: {
      gpsTarget?: {
        latitude: number;
        longitude: number;
      };
      gpsRadiusMeters?: number;
      deadlineTime?: string;
    };
  },
) {
  return apiCall<{
    evidenceRequirement: {
      id: string;
      name: string;
    };
  }>(user, '/rpc.v1.CollaborationService/CreateEvidenceRequirement', {
    ritualDefinitionId: opts.ritualDefinitionId,
    name: opts.name,
    description: opts.description ?? '',
    evidenceTypes: opts.evidenceTypes ?? ['EVIDENCE_TYPE_TEXT_NOTE'],
    isRequired: true,
    approvalMode: opts.approvalMode ?? 'APPROVAL_MODE_MANUAL',
    autoApproveConfig: opts.autoApproveConfig,
    deadlineOffsetHours: 0,
  });
}

export async function submitEvidence(
  user: TestUser,
  opts: {
    taskId: string;
    evidenceRequirementId: string;
    textContent?: string;
    evidenceType?: string;
    gpsCoordinates?: {
      latitude: number;
      longitude: number;
      accuracyMeters: number;
    };
  },
) {
  return apiCall<{
    evidenceSubmission: {
      id: string;
      approvalStatus: string;
    };
  }>(user, '/rpc.v1.CollaborationService/SubmitEvidence', {
    taskId: opts.taskId,
    evidenceRequirementId: opts.evidenceRequirementId,
    evidenceType: opts.evidenceType ?? 'EVIDENCE_TYPE_TEXT_NOTE',
    textContent: opts.textContent ?? '',
    gpsCoordinates: opts.gpsCoordinates,
  });
}

export async function approveEvidence(
  user: TestUser,
  opts: {
    evidenceSubmissionId: string;
    comment?: string;
  },
) {
  return apiCall<{
    evidenceSubmission: {
      id: string;
      approvalStatus: string;
    };
  }>(user, '/rpc.v1.CollaborationService/ApproveEvidence', {
    evidenceSubmissionId: opts.evidenceSubmissionId,
    comment: opts.comment ?? '',
  });
}

export async function rejectEvidence(
  user: TestUser,
  opts: {
    evidenceSubmissionId: string;
    comment: string;
  },
) {
  return apiCall<{
    evidenceSubmission: {
      id: string;
      approvalStatus: string;
      reviewerComment?: string;
    };
  }>(user, '/rpc.v1.CollaborationService/RejectEvidence', {
    evidenceSubmissionId: opts.evidenceSubmissionId,
    comment: opts.comment,
  });
}

export async function skipRitualInstance(
  user: TestUser,
  opts: {
    taskId: string;
    reason: string;
  },
) {
  return apiCall<{
    task: {
      id: string;
      skipReason?: string;
    };
  }>(user, '/rpc.v1.CollaborationService/SkipRitualInstance', {
    taskId: opts.taskId,
    reason: opts.reason,
  });
}

// ---------------------------------------------------------------------------
// Chat — Channels & Messages
// ---------------------------------------------------------------------------

export async function createChannel(
  user: TestUser,
  opts: {
    titleSlug: string;
    displayName: string;
    isPrivate?: boolean;
    channelType?: string;
  },
) {
  return apiCall<{
    channel: { id: string; displayName: string; isPrivate: boolean };
  }>(user, '/rpc.v1.ChatService/CreateChannel', {
    titleSlug: opts.titleSlug,
    displayName: opts.displayName,
    channelType: opts.channelType ?? 'CHANNEL_TYPE_CHAT',
    isPrivate: opts.isPrivate ?? false,
  });
}

export async function sendMessage(
  user: TestUser,
  channelId: string,
  messageText: string,
) {
  return apiCall<{
    message: { id: string; messageText: string; channelId: string };
  }>(user, '/rpc.v1.ChatService/SendMessage', { channelId, messageText });
}

export async function replyToMessage(
  user: TestUser,
  parentMessageId: string,
  messageText: string,
) {
  return apiCall<{ message: { id: string } }>(
    user,
    '/rpc.v1.ChatService/ReplyToMessage',
    { parentMessageId, messageText },
  );
}

export async function listMessages(
  user: TestUser,
  channelId: string,
  pageSize?: number,
) {
  return apiCall<{
    messages: Array<{ id: string; messageText: string; channelId: string; fileIds?: string[] }>;
  }>(user, '/rpc.v1.ChatService/ListMessages', {
    channelId,
    pageSize: pageSize ?? 50,
  });
}

/**
 * Gives someone a device that can be woken for a call.
 *
 * Direct calls are refused outright when the callee has neither a registered device nor
 * an open browser, so a scenario that needs the call to actually ring has to arrange one.
 */
export async function registerCallWakeDevice(
  user: TestUser,
  deviceIdentifier: string,
) {
  return apiCall<{ tokenId: string; isValid: boolean }>(
    user,
    '/rpc.v1.NotificationService/RegisterPushToken',
    {
      fcmToken: `e2e_fcm_${crypto.randomUUID()}`,
      deviceIdentifier,
      permissionState: 'PERMISSION_STATE_GRANTED',
      endpoint: 'https://fcm.googleapis.com/fcm/send/e2e',
      keysJson: '{"p256dh":"e2e_key","auth":"e2e_auth"}',
      userAgent: 'TechOffice-E2E/android',
      tokenMetadata: { platform: 'android', deliveryProvider: 'fcm' },
      tokenType: 'PUSH_TOKEN_TYPE_FCM',
      nativeCallCapable: true,
    },
  );
}

export async function createOrGetDirectMessage(
  user: TestUser,
  otherEmployeeId: string,
) {
  return apiCall<{ channel: { id: string } }>(
    user,
    '/rpc.v1.ChatService/CreateOrGetDirectMessage',
    { otherEmployeeId },
  );
}

export async function inviteMember(
  user: TestUser,
  channelId: string,
  employeeId: string,
) {
  return apiCall(user, '/rpc.v1.ChatService/InviteMember', {
    channelId,
    employeeId,
  });
}

// ---------------------------------------------------------------------------
// Voice — Live Calls
// ---------------------------------------------------------------------------

type VoiceJoinCredentialsShape = {
  livekitUrl: string;
  livekitToken: string;
  roomName: string;
};

export async function startVoiceCall(user: TestUser, channelId: string) {
  return apiCall<{
    call: { id: string; channelId: string; state: string };
    joinCredentials: VoiceJoinCredentialsShape;
  }>(user, '/rpc.v1.VoiceService/StartVoiceCall', { channelId });
}

export async function getActiveVoiceCall(user: TestUser, channelId: string) {
  return apiCall<{
    call?: { id: string; channelId: string; state: string };
    hasActiveCall: boolean;
  }>(user, '/rpc.v1.VoiceService/GetActiveVoiceCall', { channelId });
}

export async function joinVoiceCall(user: TestUser, callId: string) {
  return apiCall<{
    call: { id: string; channelId: string; state: string };
    joinCredentials: VoiceJoinCredentialsShape;
  }>(user, '/rpc.v1.VoiceService/JoinVoiceCall', { callId });
}

export async function inviteToVoiceCall(user: TestUser, callId: string, employeeIds: string[]) {
  return apiCall<{
    call: { id: string; channelId: string; state: string };
    invitations: Array<{ id: string; callId: string; inviteeEmployeeId: string; status: string }>;
  }>(user, '/rpc.v1.VoiceService/InviteToVoiceCall', { callId, employeeIds });
}

export async function respondToVoiceCallInvite(user: TestUser, invitationId: string, response: 'VOICE_INVITE_RESPONSE_ACCEPT' | 'VOICE_INVITE_RESPONSE_DECLINE') {
  return apiCall<{
    invitation: { id: string; callId: string; inviteeEmployeeId: string; status: string };
    joinCredentials?: VoiceJoinCredentialsShape;
  }>(user, '/rpc.v1.VoiceService/RespondToVoiceCallInvite', { invitationId, response });
}

export async function leaveVoiceCall(user: TestUser, callId: string) {
  return apiCall<{ call: { id: string; state: string } }>(
    user,
    '/rpc.v1.VoiceService/LeaveVoiceCall',
    { callId },
  );
}

export async function listCallRecords(user: TestUser, channelId: string) {
  return apiCall<{
    records: Array<{
      call?: { id: string; channelId: string; outcome: string; endedAt?: unknown };
      artifacts?: Array<{ type: string; status: string; fileId?: string }>;
    }>;
    nextCursor?: string;
  }>(user, '/rpc.v1.VoiceService/ListCallRecords', { channelId, limit: 10 });
}

export async function getCallRecord(user: TestUser, callId: string) {
  return apiCall<{
    record?: {
      call?: { id: string; channelId: string; outcome: string; endedAt?: unknown };
      artifacts?: Array<{ type: string; status: string; fileId?: string }>;
    };
  }>(user, '/rpc.v1.VoiceService/GetCallRecord', { callId });
}

// ---------------------------------------------------------------------------
// Voice — Messages
// ---------------------------------------------------------------------------

export async function requestVoiceMessageUpload(
  user: TestUser,
  opts: {
    channelId: string;
    clientDeduplicationKey: string;
    filename?: string;
    mimeType?: string;
    sizeBytes: number;
    expectedDurationMs: number;
  },
) {
  return apiCall<{
    voiceMessageId: string;
    fileId: string;
    uploadUrl: string;
    expiresAt?: string;
  }>(user, '/rpc.v1.VoiceService/RequestVoiceMessageUpload', {
    channelId: opts.channelId,
    clientDeduplicationKey: opts.clientDeduplicationKey,
    filename: opts.filename ?? 'voice-message.webm',
    mimeType: opts.mimeType ?? 'audio/webm',
    sizeBytes: opts.sizeBytes,
    expectedDurationMs: opts.expectedDurationMs,
  });
}

export async function confirmVoiceMessageUpload(
  user: TestUser,
  opts: {
    voiceMessageId: string;
    fileId: string;
    clientDeduplicationKey: string;
    durationMs: number;
    waveformPeaks?: number[];
  },
) {
  return apiCall<{
    voiceMessage: { id: string; messageId?: string; fileId: string; status: string };
  }>(user, '/rpc.v1.VoiceService/ConfirmVoiceMessageUpload', {
    voiceMessageId: opts.voiceMessageId,
    fileId: opts.fileId,
    clientDeduplicationKey: opts.clientDeduplicationKey,
    durationMs: opts.durationMs,
    waveformPeaks: opts.waveformPeaks ?? [0.2, 0.5, 0.7, 0.4],
  });
}

export async function cancelVoiceMessage(user: TestUser, voiceMessageId: string) {
  return apiCall<{
    voiceMessage: { id: string; fileId?: string; status: string };
  }>(user, '/rpc.v1.VoiceService/CancelVoiceMessage', { voiceMessageId });
}

export async function createVoiceMessage(
  user: TestUser,
  channelId: string,
  opts?: {
    deduplicationKey?: string;
    durationMs?: number;
    body?: string;
  },
) {
  const body = opts?.body ?? 'voice-message-audio';
  const blob = new Blob([body], { type: 'audio/webm' });
  const deduplicationKey = opts?.deduplicationKey ?? `voice-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const upload = await requestVoiceMessageUpload(user, {
    channelId,
    clientDeduplicationKey: deduplicationKey,
    sizeBytes: blob.size,
    expectedDurationMs: opts?.durationMs ?? 10_000,
  });
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/webm' },
    body: blob,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Voice upload failed (${uploadResponse.status})`);
  }
  const confirmed = await confirmVoiceMessageUpload(user, {
    voiceMessageId: upload.voiceMessageId,
    fileId: upload.fileId,
    clientDeduplicationKey: deduplicationKey,
    durationMs: opts?.durationMs ?? 10_000,
  });
  return { ...upload, ...confirmed, deduplicationKey };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function createDocument(
  user: TestUser,
  opts: {
    title: string;
    contentJson?: string;
    visibility?: string;
  },
) {
  return apiCall<{
    document: { id: string; title: string; slug: string; contentJson: string };
  }>(user, '/rpc.v1.DocumentService/CreateDocument', {
    title: opts.title,
    contentJson:
      opts.contentJson ??
      JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial content' }] }] }),
    visibility: opts.visibility ?? 'DOCUMENT_VISIBILITY_PRIVATE',
  });
}

export async function getDocument(user: TestUser, documentId: string) {
  return apiCall<{
    document: { id: string; title: string; contentJson: string; versionCount: number };
  }>(user, '/rpc.v1.DocumentService/GetDocument', {
    id: documentId,
    includeContent: true,
  });
}

/**
 * baseVersion is required (feature 049): a save whose base version is not the
 * document's current version_count is refused as a conflict. Read it from
 * getDocument first, or from the newVersionNumber a previous save returned.
 */
export async function updateDocument(
  user: TestUser,
  documentId: string,
  contentJson: string,
  baseVersion: number,
) {
  return apiCall<{ newVersionNumber: number }>(
    user,
    '/rpc.v1.DocumentService/UpdateDocument',
    {
      id: documentId,
      contentJson,
      baseVersion,
    },
  );
}

export async function listDocuments(
  user: TestUser,
  opts?: { limit?: number; cursor?: string },
) {
  return apiCall<{
    documents: Array<{ id: string; title: string }>;
  }>(user, '/rpc.v1.DocumentService/ListDocuments', {
    limit: opts?.limit ?? 50,
    cursor: opts?.cursor,
  });
}

export async function addDocumentComment(
  user: TestUser,
  documentId: string,
  commentText: string,
) {
  return apiCall<{ comment: { id: string; commentText: string } }>(
    user,
    '/rpc.v1.CommentService/AddComment',
    {
      documentId,
      textSelectionStart: 0,
      textSelectionEnd: 0,
      commentText,
    },
  );
}

export async function setDocumentAccess(
  user: TestUser,
  documentId: string,
  granteeId: string,
  accessLevel: 'ACCESS_LEVEL_WRITE_UPDATE' | 'ACCESS_LEVEL_READ_COMMENT' | 'ACCESS_LEVEL_NONE',
) {
  return apiCall(user, '/rpc.v1.DocumentAccessService/SetAccess', {
    documentId,
    granteeType: 'GRANTEE_TYPE_EMPLOYEE',
    granteeId,
    accessLevel,
  });
}

export async function checkDocumentAccess(user: TestUser, documentId: string) {
  return apiCall<{
    accessLevel: string;
    isOwner: boolean;
  }>(user, '/rpc.v1.DocumentAccessService/CheckAccess', { documentId });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function listNotifications(
  user: TestUser,
  opts?: { unreadOnly?: boolean; pageSize?: number },
) {
  return apiCall<{
    notifications: Array<{
      notificationRecipientId: string;
      notificationId: string;
      title: string;
      sourceDomain: string;
      readStatus: boolean;
      navigationTarget?: { domain: string; resourceType: string; resourceId: string };
      policyKey: string;
      sourceCategory: string;
      acknowledgementStatus: string;
      acknowledgementAction: string;
    }>;
  }>(user, '/rpc.v1.NotificationService/ListNotifications', {
    unreadOnly: opts?.unreadOnly ?? false,
    pageSize: opts?.pageSize ?? 50,
  });
}

export async function getUnreadCount(user: TestUser) {
  return apiCall<{ unreadCount: number }>(
    user,
    '/rpc.v1.NotificationService/GetUnreadCount',
    {},
  );
}

export async function markAsRead(
  user: TestUser,
  notificationRecipientIds: string[],
) {
  return apiCall<{ updatedCount: number }>(
    user,
    '/rpc.v1.NotificationService/MarkAsRead',
    { notificationRecipientIds },
  );
}

export async function markAllBeforeTimestampAsRead(
  user: TestUser,
  beforeTimestamp: string,
) {
  return apiCall<{ updatedCount: number }>(
    user,
    '/rpc.v1.NotificationService/MarkAllBeforeTimestampAsRead',
    { beforeTimestamp },
  );
}

export async function acknowledgeNotifications(
  user: TestUser,
  notificationRecipientIds: string[],
  acknowledgementAction?: string,
) {
  return apiCall<{ acknowledgedCount: number }>(
    user,
    '/rpc.v1.NotificationService/AcknowledgeNotifications',
    {
      notificationRecipientIds,
      acknowledgementAction: acknowledgementAction ?? 'explicit_ack',
    },
  );
}

export async function deleteNotification(
  user: TestUser,
  notificationRecipientId: string,
) {
  return apiCall(user, '/rpc.v1.NotificationService/DeleteNotification', {
    notificationRecipientId,
  });
}

// ---------------------------------------------------------------------------
// Compliance — reporting and blocking (Feature 036)
// ---------------------------------------------------------------------------

export async function inviteToChannel(user: TestUser, channelId: string, employeeId: string) {
  return apiCall<Record<string, unknown>>(user, '/rpc.v1.ChatService/InviteMember', {
    channelId,
    employeeId,
  });
}

export async function reportContent(
  user: TestUser,
  opts: {
    targetKind: string;
    targetId: string;
    reason: string;
    note?: string;
  },
) {
  return apiCall<{ reportId: string }>(user, '/rpc.v1.ComplianceService/ReportContent', {
    targetKind: opts.targetKind,
    targetId: opts.targetId,
    reason: opts.reason,
    note: opts.note ?? '',
  });
}

export async function blockPerson(user: TestUser, employeeId: string) {
  return apiCall<{ blockId: string }>(user, '/rpc.v1.ComplianceService/BlockPerson', {
    employeeId,
  });
}

export async function unblockPerson(user: TestUser, employeeId: string) {
  return apiCall<Record<string, unknown>>(user, '/rpc.v1.ComplianceService/UnblockPerson', {
    employeeId,
  });
}

// ---------------------------------------------------------------------------
// Feature 038 — tasks created from chat messages
// ---------------------------------------------------------------------------

export async function createTaskFromMessage(
  user: TestUser,
  opts: {
    sourceChannelId: string;
    sourceMessageId: string;
    projectId: string;
    title: string;
    assigneeEmployeeId?: string;
    dueDate?: string;
  },
) {
  return apiCall<{
    task: { id: string; identifier: string; title: string; projectId: string };
    announcementMessageId: string;
  }>(user, '/rpc.v1.CollaborationService/CreateTaskFromMessage', opts);
}

export async function getChannelTaskDestination(user: TestUser, channelId: string) {
  return apiCall<{
    isSet: boolean;
    projectId: string;
    projectName: string;
    projectKey: string;
    unsetReason?: string;
  }>(user, '/rpc.v1.CollaborationService/GetChannelTaskDestination', { channelId });
}

// ---------------------------------------------------------------------------
// Feature tour (Feature 039)
// ---------------------------------------------------------------------------

/**
 * Read the caller's tour. Used by the specs to arrange a starting state — how many stops
 * this person actually gets is a server decision, so the specs ask rather than assume.
 */
export async function getTour(
  user: TestUser,
  platform: 'TOUR_PLATFORM_WEB' | 'TOUR_PLATFORM_MOBILE' = 'TOUR_PLATFORM_WEB',
) {
  return apiCall<{
    audience: string;
    tourId: string;
    contentVersion: string;
    stops: { key: string; title: string; body: string; actionLabel: string; target: string }[];
    status: string;
    currentStop: number;
    shouldOffer: boolean;
  }>(user, '/rpc.v1.TourService/GetTour', { platform });
}

/** Put a person's tour into a known state before a spec opens the browser. */
export async function updateTourProgress(
  user: TestUser,
  status: 'TOUR_STATUS_IN_PROGRESS' | 'TOUR_STATUS_COMPLETED' | 'TOUR_STATUS_DISMISSED',
  currentStop = 0,
) {
  return apiCall<{ status: string; currentStop: number }>(
    user,
    '/rpc.v1.TourService/UpdateTourProgress',
    { status, currentStop },
  );
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/**
 * Uploads a file into a chat channel through the real three-step flow — request an
 * upload URL, PUT the bytes, confirm — because that is what registers the access rule
 * search filters on.
 */
export async function uploadChannelFile(
  user: TestUser,
  channelId: string,
  filename: string,
  content: string,
  mimeType = 'text/plain',
) {
  const requested = await apiCall<{ fileId: string; uploadUrl: string }>(
    user,
    '/rpc.v1.ChatFileService/RequestChannelFileUpload',
    { channelId, filename, mimeType, sizeBytes: String(Buffer.byteLength(content)) },
  );

  const put = await fetch(requested.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: content,
  });
  if (!put.ok) {
    throw new Error(`Uploading ${filename} failed (${put.status})`);
  }

  await apiCall(user, '/rpc.v1.ChatFileService/ConfirmChannelFileUpload', {
    channelId,
    fileId: requested.fileId,
  });
  return requested.fileId;
}

// ---------------------------------------------------------------------------
// Federated search
// ---------------------------------------------------------------------------

export interface SearchHitJSON {
  kind: string;
  title: string;
  contextLine: string;
  snippet?: string;
  rank?: number;
  target: Record<string, string>;
}

export async function search(
  user: TestUser,
  query: string,
  opts?: { kindFilter?: string; limit?: number },
) {
  return apiCall<{
    hits: SearchHitJSON[];
    outcomes: Array<{ kind: string; status: string; hitCount?: number; detail?: string }>;
  }>(user, '/rpc.v1.SearchService/Search', {
    query,
    kindFilter: opts?.kindFilter,
    limit: opts?.limit,
  });
}

/**
 * Renames an employee. Every test employee is created through the invite flow with the
 * same display name, so a fixture that needs a person findable by a distinctive word has
 * to set one.
 */
export function renameEmployee(organizationId: string, employeeId: string, given: string, family: string) {
  for (const id of [organizationId, employeeId]) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new Error(`Invalid id: ${id}`);
    }
  }
  const safe = (value: string) => value.replace(/'/g, "''");
  execSql(
    `UPDATE organization.employee SET given_name = '${safe(given)}', family_name = '${safe(family)}' ` +
      `WHERE organization_id = '${organizationId}'::uuid AND id = '${employeeId}'::uuid;`,
  );
}
