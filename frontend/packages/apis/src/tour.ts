/**
 * Feature Tour API functions (Feature 039)
 *
 * The tour is server-driven: GetTour returns the tour this person should see, already
 * selected by their permissions, already filtered to the stops they can use, and already
 * adapted to the platform that asked. Clients render cards and map a target to a route.
 *
 * Proto enums are converted to string unions at this boundary, matching preference.ts, so
 * no UI file imports the generated stubs (Constitution VII).
 */

import { tourClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { tour } from "rpc";

/** Which client is asking. Drives the web-only stop substitution. */
export type TourPlatform = 'web' | 'mobile';

/** Which tour the server decided this person gets. */
export type TourAudience = 'administrator' | 'worker';

/**
 * Progress state. 'not_started' is the absence of a stored row, never a stored value —
 * merely reading the tour writes nothing.
 */
export type TourStatus = 'not_started' | 'in_progress' | 'completed' | 'dismissed';

/**
 * The surface a stop points at. Each client owns a map from this to its own route and
 * must handle every value — enforced by an exhaustiveness test on both clients
 * (Constitution VIII).
 */
export type TourTarget =
	| 'none'
	| 'people'
	| 'projects'
	| 'rituals'
	| 'chat'
	| 'calendar'
	| 'docs'
	| 'today'
	| 'alerts'
	| 'search';

/** One card in the sequence, already filtered and platform-adapted. */
export interface TourStop {
	/** Stable id, used for testIDs. Not shown to anyone. */
	key: string;
	title: string;
	body: string;
	/** Empty when target is 'none'. */
	actionLabel: string;
	target: TourTarget;
}

export interface FeatureTour {
	audience: TourAudience;
	tourId: string;
	contentVersion: string;
	/** Already filtered and adapted; may be shorter than the definition. */
	stops: TourStop[];
	status: TourStatus;
	/** Index into `stops`, clamped to it by the server; 0 when not started. */
	currentStop: number;
	/**
	 * Whether the tour should be offered automatically. True only for 'not_started' and
	 * 'in_progress'. The server owns this rule; the client owns the *moment* — after any
	 * gate, never during a deep-link redirect, never before the workspace has painted.
	 */
	shouldOffer: boolean;
}

export interface TourProgress {
	status: TourStatus;
	currentStop: number;
}

function stringToProtoPlatform(platform: TourPlatform): tour.TourPlatform {
	switch (platform) {
		case 'web':
			return tour.TourPlatform.WEB;
		case 'mobile':
			return tour.TourPlatform.MOBILE;
	}
}

function protoAudienceToString(audience: tour.TourAudience): TourAudience {
	switch (audience) {
		case tour.TourAudience.ADMINISTRATOR:
			return 'administrator';
		default:
			return 'worker';
	}
}

function protoStatusToString(status: tour.TourStatus): TourStatus {
	switch (status) {
		case tour.TourStatus.IN_PROGRESS:
			return 'in_progress';
		case tour.TourStatus.COMPLETED:
			return 'completed';
		case tour.TourStatus.DISMISSED:
			return 'dismissed';
		default:
			return 'not_started';
	}
}

function stringToProtoStatus(status: Exclude<TourStatus, 'not_started'>): tour.TourStatus {
	switch (status) {
		case 'in_progress':
			return tour.TourStatus.IN_PROGRESS;
		case 'completed':
			return tour.TourStatus.COMPLETED;
		case 'dismissed':
			return tour.TourStatus.DISMISSED;
	}
}

/**
 * Every generated TourTarget, mapped to its string union member.
 *
 * This is a `Record` rather than a `switch` on purpose: it is the first link in the
 * Constitution VIII drift guard. Adding a value to the proto enum without adding it here
 * fails `tsc`, and each client's route map is a `Record<TourTarget, ...>` in turn, so it
 * fails there too. A new target cannot reach a client as a dead button.
 *
 * UNSPECIFIED and NONE both mean "render no action button".
 */
const TARGET_BY_PROTO: Record<tour.TourTarget, TourTarget> = {
	[tour.TourTarget.UNSPECIFIED]: 'none',
	[tour.TourTarget.NONE]: 'none',
	[tour.TourTarget.PEOPLE]: 'people',
	[tour.TourTarget.PROJECTS]: 'projects',
	[tour.TourTarget.RITUALS]: 'rituals',
	[tour.TourTarget.CHAT]: 'chat',
	[tour.TourTarget.CALENDAR]: 'calendar',
	[tour.TourTarget.DOCS]: 'docs',
	[tour.TourTarget.TODAY]: 'today',
	[tour.TourTarget.ALERTS]: 'alerts',
	[tour.TourTarget.SEARCH]: 'search',
};

function protoTargetToString(target: tour.TourTarget): TourTarget {
	// A server sending a target this build has never heard of is a deploy skew, not a
	// contract break: render the card without an action rather than throwing.
	return TARGET_BY_PROTO[target] ?? 'none';
}

/**
 * Get the caller's feature tour and their progress in it.
 *
 * @param platform - Which client is asking; a web-only stop is rewritten for 'mobile'
 * @returns The selected, filtered and adapted tour with progress and the offer decision
 *
 * @example
 * ```ts
 * const t = await getTour('web');
 * if (t.shouldOffer) showTour(t.stops[t.currentStop]);
 * ```
 */
export async function getTour(platform: TourPlatform): Promise<FeatureTour> {
	return await rpcCall(async () => {
		const response = await tourClient.getTour({
			platform: stringToProtoPlatform(platform),
		});

		return {
			audience: protoAudienceToString(response.audience),
			tourId: response.tourId,
			contentVersion: response.contentVersion,
			stops: response.stops.map((stop) => ({
				key: stop.key,
				title: stop.title,
				body: stop.body,
				actionLabel: stop.actionLabel,
				target: protoTargetToString(stop.target),
			})),
			status: protoStatusToString(response.status),
			currentStop: response.currentStop,
			shouldOffer: response.shouldOffer,
		};
	});
}

/**
 * Record how far the caller got.
 *
 * The tour id is derived server-side from the caller's audience, so there is nothing to
 * send: a person can only write progress for the tour they are being served. The write is
 * an upsert, so re-sending the same stop is a no-op — which matters because clients write
 * on navigation and again on unmount.
 *
 * @param status - 'in_progress', 'completed' or 'dismissed'; 'not_started' is rejected
 * @param currentStop - Zero-based index into the returned stops; ignored unless in progress
 *
 * @example
 * ```ts
 * await updateTourProgress('in_progress', 2); // moved to the third card
 * await updateTourProgress('dismissed', 2);   // gave up there
 * await updateTourProgress('in_progress', 0); // restarted from Help
 * ```
 */
export async function updateTourProgress(
	status: Exclude<TourStatus, 'not_started'>,
	currentStop: number
): Promise<TourProgress> {
	return await rpcCall(async () => {
		const response = await tourClient.updateTourProgress({
			status: stringToProtoStatus(status),
			currentStop,
		});

		return {
			status: protoStatusToString(response.status),
			currentStop: response.currentStop,
		};
	});
}
