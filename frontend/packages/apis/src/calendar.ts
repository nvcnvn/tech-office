/**
 * Calendar API functions
 * ConnectRPC-based API calls for calendar event management, RSVP, and attendees
 * Feature: 026-calendar-system
 */

import { calendarClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { protoTimestampToDate, dateToProtoTimestamp } from "./proto-utils";
import { calendar } from "rpc";

// =============================================================================
// Type Definitions — Enums
// =============================================================================

/**
 * Event type constants.
 * MUST align with:
 * - Database CHECK constraint: calendar.event.event_type
 * - Backend Go constants: internal/calendar/constants.go
 */
export type EventType =
	| 'meeting'
	| 'shift'
	| 'deadline'
	| 'reminder'
	| 'out_of_office'
	| 'company_event'
	| 'training'
	| 'maintenance_window';

/**
 * Event visibility constants.
 * MUST align with:
 * - Database CHECK constraint: calendar.event.visibility
 * - Backend Go constants: internal/calendar/constants.go
 */
export type EventVisibility = 'private' | 'personal_shared' | 'team' | 'org_wide';

/**
 * RSVP status constants.
 */
export type RSVPStatus = 'pending' | 'accepted' | 'declined' | 'tentative';

/**
 * Attendee role constants.
 */
export type AttendeeRole = 'required' | 'optional' | 'organizer';

// =============================================================================
// Type Definitions — Interfaces
// =============================================================================

export interface CalendarEvent {
	id: string;
	title: string;
	description: string;
	eventType: EventType;
	visibility: EventVisibility;
	startTime?: Date;
	endTime?: Date;
	allDay: boolean;
	locationText: string;
	virtualLink: string;
	organizerEmployeeId: string;
	recurrenceRule: string;
	isExceptionInstance: boolean;
	originalStartTime?: Date;
	descriptionDocumentId: string;
	discussionChannelId: string;
	requiresCheckIn: boolean;
	requiresEvidence: boolean;
	cancelledAt?: Date;
	updatedAt?: Date;
	attendees: EventAttendee[];
	resourceBookings: ResourceBooking[];
	seriesId: string;
}

export interface EventAttendee {
	id: string;
	employeeId: string;
	employeeName: string;
	employeeAvatarUrl: string;
	role: AttendeeRole;
	rsvpStatus: RSVPStatus;
	responseTime?: Date;
	responseNote: string;
}

export interface ResourceBooking {
	id: string;
	resourceId: string;
	resourceName: string;
	eventId: string;
	startTime?: Date;
	endTime?: Date;
	bookedById: string;
}

export const calendarEventsQueryKey = ['calendar-events'] as const;

export function getCalendarEventsQueryKey(
	start: Date,
	end: Date,
	targetEmployeeId?: string,
) {
	return [...calendarEventsQueryKey, start.toISOString(), end.toISOString(), targetEmployeeId ?? ''];
}

// =============================================================================
// Proto → TS Converters
// =============================================================================

function mapAttendee(a: calendar.EventAttendee): EventAttendee {
	return {
		id: a.id,
		employeeId: a.employeeId,
		employeeName: a.employeeName,
		employeeAvatarUrl: a.employeeAvatarUrl,
		role: a.role as AttendeeRole,
		rsvpStatus: a.rsvpStatus as RSVPStatus,
		responseTime: protoTimestampToDate(a.responseTime),
		responseNote: a.responseNote,
	};
}

function mapResourceBooking(b: calendar.ResourceBooking): ResourceBooking {
	return {
		id: b.id,
		resourceId: b.resourceId,
		resourceName: b.resourceName,
		eventId: b.eventId,
		startTime: protoTimestampToDate(b.startTime),
		endTime: protoTimestampToDate(b.endTime),
		bookedById: b.bookedById,
	};
}

function mapEvent(e: calendar.CalendarEvent): CalendarEvent {
	return {
		id: e.id,
		title: e.title,
		description: e.description,
		eventType: e.eventType as EventType,
		visibility: e.visibility as EventVisibility,
		startTime: protoTimestampToDate(e.startTime),
		endTime: protoTimestampToDate(e.endTime),
		allDay: e.allDay,
		locationText: e.locationText,
		virtualLink: e.virtualLink,
		organizerEmployeeId: e.organizerEmployeeId,
		recurrenceRule: e.recurrenceRule,
		isExceptionInstance: e.isExceptionInstance,
		originalStartTime: protoTimestampToDate(e.originalStartTime),
		descriptionDocumentId: e.descriptionDocumentId,
		discussionChannelId: e.discussionChannelId,
		requiresCheckIn: e.requiresCheckIn,
		requiresEvidence: e.requiresEvidence,
		cancelledAt: protoTimestampToDate(e.cancelledAt),
		updatedAt: protoTimestampToDate(e.updatedAt),
		attendees: e.attendees.map(mapAttendee),
		resourceBookings: e.resourceBookings.map(mapResourceBooking),
		seriesId: e.seriesId,
	};
}

function rsvpStatusToProto(status: RSVPStatus): calendar.RSVPResponse {
	switch (status) {
		case 'accepted':
			return calendar.RSVPResponse.RSVP_RESPONSE_ACCEPTED;
		case 'declined':
			return calendar.RSVPResponse.RSVP_RESPONSE_DECLINED;
		case 'tentative':
			return calendar.RSVPResponse.RSVP_RESPONSE_TENTATIVE;
		default:
			return calendar.RSVPResponse.RSVP_RESPONSE_UNSPECIFIED;
	}
}

// =============================================================================
// Event CRUD API Functions
// =============================================================================

export interface CreateEventInput {
	title: string;
	description?: string;
	eventType: EventType;
	visibility: EventVisibility;
	startTime: Date;
	endTime: Date;
	allDay?: boolean;
	locationText?: string;
	virtualLink?: string;
	recurrenceRule?: string;
	requiredAttendeeIds?: string[];
	optionalAttendeeIds?: string[];
	resourceIds?: string[];
	requiresCheckIn?: boolean;
	requiresEvidence?: boolean;
	organizerOverrideId?: string;
}

export async function createEvent(input: CreateEventInput): Promise<CalendarEvent> {
	return rpcCall(async () => {
		const resp = await calendarClient.createEvent({
			title: input.title,
			description: input.description ?? '',
			eventType: input.eventType,
			visibility: input.visibility,
			startTime: dateToProtoTimestamp(input.startTime),
			endTime: dateToProtoTimestamp(input.endTime),
			allDay: input.allDay ?? false,
			locationText: input.locationText ?? '',
			virtualLink: input.virtualLink ?? '',
			recurrenceRule: input.recurrenceRule ?? '',
			requiredAttendeeIds: input.requiredAttendeeIds ?? [],
			optionalAttendeeIds: input.optionalAttendeeIds ?? [],
			resourceIds: input.resourceIds ?? [],
			requiresCheckIn: input.requiresCheckIn ?? false,
			requiresEvidence: input.requiresEvidence ?? false,
			organizerOverrideId: input.organizerOverrideId ?? '',
		});
		if (!resp.event) throw new Error('No event returned');
		return mapEvent(resp.event);
	});
}

export async function getEvent(eventId: string): Promise<CalendarEvent> {
	return rpcCall(async () => {
		const resp = await calendarClient.getEvent({ eventId });
		if (!resp.event) throw new Error('No event returned');
		return mapEvent(resp.event);
	});
}

export async function listEvents(
	start: Date,
	end: Date,
	targetEmployeeId?: string,
): Promise<CalendarEvent[]> {
	return rpcCall(async () => {
		const resp = await calendarClient.listEvents({
			start: dateToProtoTimestamp(start),
			end: dateToProtoTimestamp(end),
			targetEmployeeId: targetEmployeeId ?? '',
			overlayCalendarIds: [],
		});
		return resp.events.map(mapEvent);
	});
}

export interface UpdateEventInput {
	eventId: string;
	title?: string;
	description?: string;
	eventType?: string;
	visibility?: string;
	startTime?: Date;
	endTime?: Date;
	allDay?: boolean;
	locationText?: string;
	virtualLink?: string;
	requiredAttendeeIds?: string[];
	optionalAttendeeIds?: string[];
	resourceIds?: string[];
}

export async function updateEvent(input: UpdateEventInput): Promise<CalendarEvent> {
	return rpcCall(async () => {
		const resp = await calendarClient.updateEvent({
			eventId: input.eventId,
			title: input.title ?? '',
			description: input.description ?? '',
			eventType: input.eventType ?? '',
			visibility: input.visibility ?? '',
			startTime: dateToProtoTimestamp(input.startTime),
			endTime: dateToProtoTimestamp(input.endTime),
			allDay: input.allDay ?? false,
			locationText: input.locationText ?? '',
			virtualLink: input.virtualLink ?? '',
			requiredAttendeeIds: input.requiredAttendeeIds ?? [],
			optionalAttendeeIds: input.optionalAttendeeIds ?? [],
			resourceIds: input.resourceIds ?? [],
		});
		if (!resp.event) throw new Error('No event returned');
		return mapEvent(resp.event);
	});
}

export async function cancelEvent(eventId: string, cancelReason?: string): Promise<boolean> {
	return rpcCall(async () => {
		const resp = await calendarClient.cancelEvent({
			eventId,
			cancelReason: cancelReason ?? '',
		});
		return resp.success;
	});
}

// =============================================================================
// RSVP API Functions
// =============================================================================

export async function respondToInvite(
	eventId: string,
	rsvpStatus: RSVPStatus,
	responseNote?: string,
): Promise<EventAttendee> {
	return rpcCall(async () => {
		const resp = await calendarClient.respondToInvite({
			eventId,
			rsvpStatus: rsvpStatusToProto(rsvpStatus),
			responseNote: responseNote ?? '',
		});
		if (!resp.attendee) throw new Error('No attendee returned');
		return mapAttendee(resp.attendee);
	});
}

export async function listEventAttendees(eventId: string): Promise<EventAttendee[]> {
	return rpcCall(async () => {
		const resp = await calendarClient.listEventAttendees({ eventId });
		return resp.attendees.map(mapAttendee);
	});
}

// =============================================================================
// Recurring Series Editing API
// =============================================================================

export type EventEditScope = 'this_instance' | 'this_and_following' | 'all';

function editScopeToProto(scope: EventEditScope): calendar.EventEditScope {
	switch (scope) {
		case 'this_instance':
			return calendar.EventEditScope.THIS_INSTANCE;
		case 'this_and_following':
			return calendar.EventEditScope.THIS_AND_FOLLOWING;
		case 'all':
			return calendar.EventEditScope.ALL;
		default:
			return calendar.EventEditScope.UNSPECIFIED;
	}
}

export interface EditEventSeriesInput {
	eventId: string;
	instanceStartTime?: Date;
	changeScope: EventEditScope;
	title?: string;
	description?: string;
	startTime?: Date;
	endTime?: Date;
	locationText?: string;
	virtualLink?: string;
	requiredAttendeeIds?: string[];
	optionalAttendeeIds?: string[];
	skipInstance?: boolean;
}

export async function editEventSeries(input: EditEventSeriesInput): Promise<CalendarEvent> {
	return rpcCall(async () => {
		const resp = await calendarClient.editEventSeries({
			eventId: input.eventId,
			instanceStartTime: dateToProtoTimestamp(input.instanceStartTime),
			changeScope: editScopeToProto(input.changeScope),
			title: input.title ?? '',
			description: input.description ?? '',
			startTime: dateToProtoTimestamp(input.startTime),
			endTime: dateToProtoTimestamp(input.endTime),
			locationText: input.locationText ?? '',
			virtualLink: input.virtualLink ?? '',
			requiredAttendeeIds: input.requiredAttendeeIds ?? [],
			optionalAttendeeIds: input.optionalAttendeeIds ?? [],
			skipInstance: input.skipInstance ?? false,
		});
		if (!resp.event) throw new Error('No event returned');
		return mapEvent(resp.event);
	});
}

// =============================================================================
// Resource API Functions
// =============================================================================

export interface CalendarResource {
	id: string;
	name: string;
	resourceType: string;
	location: string;
	capacity: number;
	isActive: boolean;
}

function mapResource(r: calendar.CalendarResource): CalendarResource {
	return {
		id: r.id,
		name: r.name,
		resourceType: r.resourceType,
		location: r.location,
		capacity: r.capacity,
		isActive: r.isActive,
	};
}

export async function listResources(
	resourceType?: string,
	minCapacity?: number,
): Promise<CalendarResource[]> {
	return rpcCall(async () => {
		const resp = await calendarClient.listResources({
			resourceType: resourceType ?? '',
			minCapacity: minCapacity ?? 0,
		});
		return resp.resources.map(mapResource);
	});
}

export async function createResource(
	name: string,
	resourceType: string,
	location?: string,
	capacity?: number,
): Promise<CalendarResource> {
	return rpcCall(async () => {
		const resp = await calendarClient.createResource({
			name,
			resourceType,
			location: location ?? '',
			capacity: capacity ?? 0,
		});
		if (!resp.resource) throw new Error('No resource returned');
		return mapResource(resp.resource);
	});
}

export async function updateResource(
	resourceId: string,
	updates: { name?: string; location?: string; capacity?: number; isActive?: boolean },
): Promise<CalendarResource> {
	return rpcCall(async () => {
		const resp = await calendarClient.updateResource({
			resourceId,
			name: updates.name ?? '',
			location: updates.location ?? '',
			capacity: updates.capacity ?? 0,
			isActive: updates.isActive ?? true,
		});
		if (!resp.resource) throw new Error('No resource returned');
		return mapResource(resp.resource);
	});
}

export async function setResourceACL(
	resourceId: string,
	entries: Array<{ employeeId: string; role: string }>,
): Promise<boolean> {
	return rpcCall(async () => {
		const resp = await calendarClient.setResourceACL({
			resourceId,
			entries: entries.map(e => ({ employeeId: e.employeeId, role: e.role })),
		});
		return resp.success;
	});
}

// =============================================================================
// Delegation
// =============================================================================

export interface CalendarDelegation {
	id: string;
	delegatorEmployeeId: string;
	delegateEmployeeId: string;
	expiresAt?: Date;
	grantedAt?: Date;
}

function mapDelegation(d: NonNullable<ReturnType<typeof Object>>): CalendarDelegation {
	const raw = d as {
		id?: string;
		delegatorEmployeeId?: string;
		delegateEmployeeId?: string;
		expiresAt?: { seconds?: bigint };
		grantedAt?: { seconds?: bigint };
	};
	return {
		id: raw.id ?? '',
		delegatorEmployeeId: raw.delegatorEmployeeId ?? '',
		delegateEmployeeId: raw.delegateEmployeeId ?? '',
		expiresAt: raw.expiresAt?.seconds ? new Date(Number(raw.expiresAt.seconds) * 1000) : undefined,
		grantedAt: raw.grantedAt?.seconds ? new Date(Number(raw.grantedAt.seconds) * 1000) : undefined,
	};
}

export async function grantDelegation(
	delegateId: string,
	expiresAt?: Date,
): Promise<boolean> {
	return rpcCall(async () => {
		const resp = await calendarClient.grantDelegation({
			delegateId,
			expiresAt: expiresAt ? dateToProtoTimestamp(expiresAt) : undefined,
		});
		return resp.success;
	});
}

export async function listDelegations(
	employeeId?: string,
): Promise<{ grantedByMe: CalendarDelegation[]; grantedToMe: CalendarDelegation[] }> {
	return rpcCall(async () => {
		const resp = await calendarClient.listDelegations({
			employeeId: employeeId ?? '',
		});
		return {
			grantedByMe: resp.grantedByMe.map(mapDelegation),
			grantedToMe: resp.grantedToMe.map(mapDelegation),
		};
	});
}

export async function revokeDelegation(delegateId: string): Promise<boolean> {
	return rpcCall(async () => {
		const resp = await calendarClient.revokeDelegation({
			delegateId,
		});
		return resp.success;
	});
}

// =============================================================================
// Overlay Items
// =============================================================================

export interface OverlayItem {
	sourceId: string;
	sourceDomain: 'task' | 'ritual' | 'doc_deadline' | 'project_milestone';
	title: string;
	dueAt?: Date;
	status: string;
	urlPath: string;
}

export interface ListOverlayItemsOptions {
	start: Date;
	end: Date;
	includeTasks?: boolean;
	includeRituals?: boolean;
	includeDocDeadlines?: boolean;
}

function mapOverlayItem(item: {
	sourceId?: string;
	sourceDomain?: string;
	title?: string;
	dueAt?: { seconds?: bigint };
	status?: string;
	urlPath?: string;
}): OverlayItem {
	return {
		sourceId: item.sourceId ?? '',
		sourceDomain: (item.sourceDomain ?? 'task') as OverlayItem['sourceDomain'],
		title: item.title ?? '',
		dueAt: item.dueAt?.seconds ? new Date(Number(item.dueAt.seconds) * 1000) : undefined,
		status: item.status ?? '',
		urlPath: item.urlPath ?? '',
	};
}

export async function listOverlayItems(opts: ListOverlayItemsOptions): Promise<OverlayItem[]> {
	return rpcCall(async () => {
		const resp = await calendarClient.listOverlayItems({
			start: dateToProtoTimestamp(opts.start),
			end: dateToProtoTimestamp(opts.end),
			includeTasks: opts.includeTasks ?? false,
			includeRituals: opts.includeRituals ?? false,
			includeDocDeadlines: opts.includeDocDeadlines ?? false,
		});
		return resp.items.map(mapOverlayItem);
	});
}

// =============================================================================
// Working Hours
// =============================================================================

export interface WorkingHoursEntry {
	id: string;
	dayOfWeek: number;
	startTime: string;
	endTime: string;
	isWorkingDay: boolean;
	timezone: string;
}

export async function getWorkingHours(employeeId?: string): Promise<WorkingHoursEntry[]> {
	return rpcCall(async () => {
		const resp = await calendarClient.getWorkingHours({ employeeId: employeeId ?? '' });
		return resp.workingHours.map((wh) => ({
			id: wh.id ?? '',
			dayOfWeek: wh.dayOfWeek ?? 0,
			startTime: wh.startTime ?? '',
			endTime: wh.endTime ?? '',
			isWorkingDay: wh.isWorkingDay ?? false,
			timezone: wh.timezone ?? '',
		}));
	});
}

export async function setWorkingHours(hours: WorkingHoursEntry[]): Promise<WorkingHoursEntry[]> {
	return rpcCall(async () => {
		const resp = await calendarClient.setWorkingHours({
			workingHours: hours.map((h) => ({
				id: h.id,
				dayOfWeek: h.dayOfWeek,
				startTime: h.startTime,
				endTime: h.endTime,
				isWorkingDay: h.isWorkingDay,
				timezone: h.timezone,
			})),
		});
		return resp.workingHours.map((wh) => ({
			id: wh.id ?? '',
			dayOfWeek: wh.dayOfWeek ?? 0,
			startTime: wh.startTime ?? '',
			endTime: wh.endTime ?? '',
			isWorkingDay: wh.isWorkingDay ?? false,
			timezone: wh.timezone ?? '',
		}));
	});
}

// =============================================================================
// Scheduling Assistant
// =============================================================================

export interface FreeBusySlot {
	start?: Date;
	end?: Date;
	isFree: boolean;
}

export interface EmployeeFreeBusy {
	employeeId: string;
	slots: FreeBusySlot[];
}

function mapSlot(s: { start?: { seconds?: bigint }; end?: { seconds?: bigint }; isFree?: boolean }): FreeBusySlot {
	return {
		start: s.start?.seconds ? new Date(Number(s.start.seconds) * 1000) : undefined,
		end: s.end?.seconds ? new Date(Number(s.end.seconds) * 1000) : undefined,
		isFree: s.isFree ?? false,
	};
}

export async function getFreeBusy(employeeIds: string[], start: Date, end: Date): Promise<EmployeeFreeBusy[]> {
	return rpcCall(async () => {
		const resp = await calendarClient.getFreeBusy({
			employeeIds,
			start: dateToProtoTimestamp(start),
			end: dateToProtoTimestamp(end),
		});
		return resp.freeBusy.map((fb) => ({
			employeeId: (fb as { employeeId?: string }).employeeId ?? '',
			slots: (fb as { slots?: Array<{ start?: { seconds?: bigint }; end?: { seconds?: bigint }; isFree?: boolean }> }).slots?.map(mapSlot) ?? [],
		}));
	});
}

export async function suggestSlots(
	employeeIds: string[],
	durationMinutes: number,
	searchFrom: Date,
	searchUntil: Date,
	maxSuggestions?: number,
): Promise<FreeBusySlot[]> {
	return rpcCall(async () => {
		const resp = await calendarClient.suggestSlots({
			employeeIds,
			durationMinutes,
			searchFrom: dateToProtoTimestamp(searchFrom),
			searchUntil: dateToProtoTimestamp(searchUntil),
			maxSuggestions: maxSuggestions ?? 5,
		});
		return resp.suggestedSlots.map(mapSlot);
	});
}

// =============================================================================
// Booking Links
// =============================================================================

export interface BookingLink {
	id: string;
	token: string;
	title: string;
	durationMinutes: number;
	validFrom: string;
	validUntil: string;
	status: string;
}

export interface BookingWindow {
	dayOfWeek: number;
	startTime: string;
	endTime: string;
}

export async function createBookingLink(
	title: string,
	durationMinutes: number,
	validFrom: string,
	validUntil: string,
	availableWindows?: BookingWindow[],
	expiresAt?: Date,
): Promise<{ bookingLink: BookingLink; shareUrl: string }> {
	return rpcCall(async () => {
		const resp = await calendarClient.createBookingLink({
			title,
			durationMinutes,
			validFrom,
			validUntil,
			availableWindows: (availableWindows ?? []).map((w) => ({
				dayOfWeek: w.dayOfWeek,
				startTime: w.startTime,
				endTime: w.endTime,
			})),
			expiresAt: expiresAt ? dateToProtoTimestamp(expiresAt) : undefined,
		});
		const bl = resp.bookingLink;
		return {
			bookingLink: {
				id: bl?.id ?? '',
				token: bl?.token ?? '',
				title: bl?.title ?? '',
				durationMinutes: bl?.durationMinutes ?? 0,
				validFrom: bl?.validFrom ?? '',
				validUntil: bl?.validUntil ?? '',
				status: bl?.status ?? '',
			},
			shareUrl: resp.shareUrl ?? '',
		};
	});
}

export async function getBookingLinkByToken(
	token: string,
): Promise<{ bookingLink: BookingLink; availableSlots: FreeBusySlot[] }> {
	return rpcCall(async () => {
		const resp = await calendarClient.getBookingLinkByToken({ token });
		const bl = resp.bookingLink;
		return {
			bookingLink: {
				id: bl?.id ?? '',
				token: bl?.token ?? '',
				title: bl?.title ?? '',
				durationMinutes: bl?.durationMinutes ?? 0,
				validFrom: bl?.validFrom ?? '',
				validUntil: bl?.validUntil ?? '',
				status: bl?.status ?? '',
			},
			availableSlots: resp.availableSlots.map(mapSlot),
		};
	});
}

export async function claimBookingSlot(token: string, slotStart: Date): Promise<CalendarEvent> {
	return rpcCall(async () => {
		const resp = await calendarClient.claimBookingSlot({
			token,
			slotStart: dateToProtoTimestamp(slotStart),
		});
		if (!resp.event) throw new Error('No event returned');
		return mapEvent(resp.event);
	});
}

// =============================================================================
// Compliance (Check-In & Audit)
// =============================================================================

export interface CalendarCheckIn {
	id: string;
	eventId: string;
	employeeId: string;
	checkedInAt?: Date;
	isLate: boolean;
	evidenceFileIds: string[];
	submittedAt?: Date;
}

export interface CalendarAuditEntry {
	id: string;
	eventId: string;
	actorId: string;
	actorName: string;
	delegateId: string;
	actionType: string;
	occurredAt?: Date;
}

export async function checkInToEvent(eventId: string): Promise<CalendarCheckIn> {
	return rpcCall(async () => {
		const resp = await calendarClient.checkInToEvent({ eventId });
		const ci = resp.checkIn;
		return {
			id: ci?.id ?? '',
			eventId: ci?.eventId ?? '',
			employeeId: ci?.employeeId ?? '',
			checkedInAt: ci?.checkedInAt?.seconds ? new Date(Number(ci.checkedInAt.seconds) * 1000) : undefined,
			isLate: ci?.isLate ?? false,
			evidenceFileIds: ci?.evidenceFileIds ?? [],
			submittedAt: ci?.submittedAt?.seconds ? new Date(Number(ci.submittedAt.seconds) * 1000) : undefined,
		};
	});
}

export async function submitCheckInEvidence(eventId: string, fileIds: string[]): Promise<CalendarCheckIn> {
	return rpcCall(async () => {
		const resp = await calendarClient.submitCheckInEvidence({ eventId, fileIds });
		const ci = resp.checkIn;
		return {
			id: ci?.id ?? '',
			eventId: ci?.eventId ?? '',
			employeeId: ci?.employeeId ?? '',
			checkedInAt: ci?.checkedInAt?.seconds ? new Date(Number(ci.checkedInAt.seconds) * 1000) : undefined,
			isLate: ci?.isLate ?? false,
			evidenceFileIds: ci?.evidenceFileIds ?? [],
			submittedAt: ci?.submittedAt?.seconds ? new Date(Number(ci.submittedAt.seconds) * 1000) : undefined,
		};
	});
}

export async function listAuditEntries(
	eventId: string,
	cursor?: string,
	limit?: number,
): Promise<{ entries: CalendarAuditEntry[]; nextCursor: string }> {
	return rpcCall(async () => {
		const resp = await calendarClient.listAuditEntries({
			eventId,
			cursor: cursor ?? '',
			limit: limit ?? 50,
		});
		return {
			entries: resp.entries.map((e) => {
				const raw = e as Record<string, unknown>;
				return {
					id: (raw.id as string) ?? '',
					eventId: (raw.eventId as string) ?? '',
					actorId: (raw.actorId as string) ?? '',
					actorName: (raw.actorName as string) ?? '',
					delegateId: (raw.delegateId as string) ?? '',
					actionType: (raw.actionType as string) ?? '',
					occurredAt: (e as { occurredAt?: { seconds?: bigint } }).occurredAt?.seconds
						? new Date(Number((e as { occurredAt: { seconds: bigint } }).occurredAt.seconds) * 1000)
						: undefined,
				};
			}),
			nextCursor: resp.nextCursor ?? '',
		};
	});
}

// =============================================================================
// Search
// =============================================================================

export interface SearchEventsOptions {
	query: string;
	eventType?: string;
	resourceId?: string;
	attendeeId?: string;
	from?: Date;
	until?: Date;
	limit?: number;
	cursor?: string;
}

export async function searchEvents(
	opts: SearchEventsOptions,
): Promise<{ events: CalendarEvent[]; nextCursor: string }> {
	return rpcCall(async () => {
		const resp = await calendarClient.searchEvents({
			query: opts.query,
			eventType: opts.eventType ?? '',
			resourceId: opts.resourceId ?? '',
			attendeeId: opts.attendeeId ?? '',
			from: opts.from ? dateToProtoTimestamp(opts.from) : undefined,
			until: opts.until ? dateToProtoTimestamp(opts.until) : undefined,
			limit: opts.limit ?? 20,
			cursor: opts.cursor ?? '',
		});
		return {
			events: resp.events.map(mapEvent),
			nextCursor: resp.nextCursor ?? '',
		};
	});
}
