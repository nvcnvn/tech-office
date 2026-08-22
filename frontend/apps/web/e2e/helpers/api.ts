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

export function forceRitualTaskOverdue(taskId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) {
    throw new Error(`Invalid ritual task id: ${taskId}`);
  }

  const sql = `
UPDATE collaboration.task
SET scheduled_date = CURRENT_DATE - 1,
    completion_deadline = now() - interval '1 hour',
    updated_at = now()
WHERE id = '${taskId}'::uuid
  AND task_kind = 'ritual_instance';

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
    throw new Error(`Failed to force ritual task overdue: ${output}`);
  }
}

export function setStandardTaskDueToday(taskId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) {
    throw new Error(`Invalid standard task id: ${taskId}`);
  }

  const sql = `
UPDATE collaboration.task
SET due_date = CURRENT_DATE + interval '6 hour',
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
  },
) {
  return apiCall<{
    ritualDefinition: {
      id: string;
      name: string;
      evidenceRequirements: Array<{ id: string; name: string }>;
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
    document: { id: string; title: string; contentJson: string };
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
    document: { id: string; title: string; contentJson: string };
  }>(user, '/rpc.v1.DocumentService/GetDocument', {
    id: documentId,
    includeContent: true,
  });
}

export async function updateDocument(
  user: TestUser,
  documentId: string,
  contentJson: string,
) {
  return apiCall(user, '/rpc.v1.DocumentService/UpdateDocument', {
    id: documentId,
    contentJson,
  });
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
