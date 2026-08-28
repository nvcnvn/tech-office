/**
 * Voice communication API functions.
 */

import { voice } from "rpc";
import { voiceClient } from "./rpc";
import rpcCall from "./rpcWrapper";

export type StartVoiceCallResponse = voice.StartVoiceCallResponse;
export type GetActiveVoiceCallResponse = voice.GetActiveVoiceCallResponse;
export type JoinVoiceCallResponse = voice.JoinVoiceCallResponse;
export type LeaveVoiceCallResponse = voice.LeaveVoiceCallResponse;
export type EndVoiceCallResponse = voice.EndVoiceCallResponse;
export type VoiceCallSession = voice.VoiceCallSession;
export type VoiceJoinCredentials = voice.VoiceJoinCredentials;
export type InviteToVoiceCallResponse = voice.InviteToVoiceCallResponse;
export type RespondToVoiceCallInviteResponse = voice.RespondToVoiceCallInviteResponse;
export type ListCallRecordsResponse = voice.ListCallRecordsResponse;
export type GetCallRecordResponse = voice.GetCallRecordResponse;
export type RequestVoiceMessageUploadResponse = voice.RequestVoiceMessageUploadResponse;
export type ConfirmVoiceMessageUploadResponse = voice.ConfirmVoiceMessageUploadResponse;
export type CancelVoiceMessageResponse = voice.CancelVoiceMessageResponse;

export type VoiceCallState = 'ringing' | 'active' | 'ending' | 'ended';
export type VoiceCallOutcome = 'answered' | 'missed' | 'declined' | 'cancelled' | 'completed';
export type VoiceCallParticipantState =
        | 'invited'
        | 'ringing'
        | 'joining'
        | 'joined'
        | 'disconnected'
        | 'left'
        | 'declined'
        | 'removed';
export type VoiceInvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
export type VoiceArtifactType = 'recording' | 'transcript';
export type VoiceArtifactStatus = 'pending' | 'processing' | 'ready' | 'unavailable' | 'failed';
export type VoiceMessageStatus = 'requested' | 'uploading' | 'posted' | 'failed' | 'cancelled';
export type VoiceInviteDecision = 'accept' | 'decline';

// LiveKit DisconnectReason values (see @livekit/protocol) that mean the room
// closed the way it was supposed to rather than failing: we hung up, the
// backend deleted the room when the call ended, the server removed us, or the
// last participant left. livekit-client is not a dependency of this package,
// so the numeric values are inlined.
const expectedLiveKitDisconnectReasons = new Set<number>([
	1, // CLIENT_INITIATED
	4, // PARTICIPANT_REMOVED
	5, // ROOM_DELETED
	10, // ROOM_CLOSED
]);

/**
 * True when a LiveKit disconnect is an ordinary end of call. Callers must not
 * surface these as errors — hanging up and being declined both land here.
 */
export function isExpectedVoiceDisconnect(reason: unknown): boolean {
	return typeof reason === 'number' && expectedLiveKitDisconnectReasons.has(reason);
}

/**
 * Why a call could not be placed, when the reason is one the caller should act on
 * differently.
 *
 * These are distinct outcomes, not shades of failure: "busy" means try again shortly,
 * "unreachable" means this person cannot be reached at all right now, and "blocked"
 * must never be named as such to the caller. Collapsing them into one error message is
 * what makes people re-dial a phone that was never going to ring.
 *
 * MUST align with the ErrorReason* constants in backend/internal/voice/errors.go.
 */
export type VoiceCallFailure = 'busy' | 'unreachable' | 'unavailable' | 'other';

const VOICE_ERROR_REASONS: ReadonlyArray<readonly [string, VoiceCallFailure]> = [
        ['VOICE_CALLEE_BUSY', 'busy'],
        ['VOICE_CALLEE_UNREACHABLE', 'unreachable'],
        ['VOICE_MEDIA_PROVIDER_UNAVAILABLE', 'unavailable'],
];

/**
 * Classifies a failed call attempt.
 *
 * Reads the structured error reason rather than matching on message text, so the
 * wording can change without silently reclassifying an outcome.
 */
export function voiceCallFailureKind(error: unknown): VoiceCallFailure {
        const message = error instanceof Error ? error.message : '';
        const details = (error as { details?: unknown[] } | null)?.details;
        const haystack = [message, JSON.stringify(details ?? '')].join(' ');

        for (const [reason, kind] of VOICE_ERROR_REASONS) {
                if (haystack.includes(reason)) {
                        return kind;
                }
        }

        const normalized = message.toLowerCase();
        if (normalized.includes('already on a call')) return 'busy';
        if (normalized.includes('cannot be reached')) return 'unreachable';
        if (
                normalized.includes('voice media provider unavailable') ||
                normalized.includes('livekit') ||
                normalized.includes('twirp') ||
                normalized.includes('connect: connection refused')
        ) {
                return 'unavailable';
        }
        return 'other';
}

export function voiceCallErrorMessage(error: unknown, fallback: string): string {
        const message = error instanceof Error ? error.message : '';

        switch (voiceCallFailureKind(error)) {
                case 'busy':
                        // Named as a state of the other person, not a failure of the caller's
                        // action, because "try again shortly" is the useful next step.
                        return 'They are already on another call. Try again in a moment.';
                case 'unreachable':
                        // Deliberately says nothing about why. The callee may have no device
                        // registered, may have revoked notifications, or may simply be
                        // powered off, and none of that is the caller's business.
                        return 'They cannot be reached right now.';
                case 'unavailable':
                        return 'Voice calling is temporarily unavailable. Please try again in a moment.';
                default:
                        return message || fallback;
        }
}

export interface StartVoiceCallParams {
        channelId: string;
        requestRecording?: boolean;
}

export interface InviteToVoiceCallParams {
        callId: string;
        employeeIds: string[];
}

export interface RespondToVoiceCallInviteParams {
        invitationId: string;
        response: VoiceInviteDecision;
}

export interface ListCallRecordsParams {
        channelId: string;
        cursor?: string;
        limit?: number;
}

export interface RequestVoiceMessageUploadParams {
        channelId: string;
        clientDeduplicationKey: string;
        filename: string;
        mimeType: string;
        sizeBytes: number | bigint;
        expectedDurationMs: number | bigint;
}

export interface ConfirmVoiceMessageUploadParams {
        voiceMessageId: string;
        fileId: string;
        clientDeduplicationKey: string;
        durationMs: number | bigint;
        waveformPeaks?: number[];
}

function toBigInt(value: number | bigint): bigint {
        return typeof value === 'bigint' ? value : BigInt(value);
}

function toVoiceInviteResponse(response: VoiceInviteDecision): voice.VoiceInviteResponse {
        return response === 'accept'
                ? voice.VoiceInviteResponse.ACCEPT
                : voice.VoiceInviteResponse.DECLINE;
}

export function voiceCallStateToString(state: voice.VoiceCallState): VoiceCallState {
        switch (state) {
                case voice.VoiceCallState.RINGING:
                        return 'ringing';
                case voice.VoiceCallState.ACTIVE:
                        return 'active';
                case voice.VoiceCallState.ENDING:
                        return 'ending';
                case voice.VoiceCallState.ENDED:
                        return 'ended';
                default:
                        return 'ended';
        }
}

export function voiceParticipantStateToString(state: voice.VoiceCallParticipantState): VoiceCallParticipantState {
        switch (state) {
                case voice.VoiceCallParticipantState.INVITED:
                        return 'invited';
                case voice.VoiceCallParticipantState.RINGING:
                        return 'ringing';
                case voice.VoiceCallParticipantState.JOINING:
                        return 'joining';
                case voice.VoiceCallParticipantState.JOINED:
                        return 'joined';
                case voice.VoiceCallParticipantState.DISCONNECTED:
                        return 'disconnected';
                case voice.VoiceCallParticipantState.LEFT:
                        return 'left';
                case voice.VoiceCallParticipantState.DECLINED:
                        return 'declined';
                case voice.VoiceCallParticipantState.REMOVED:
                        return 'removed';
                default:
                        return 'removed';
        }
}

export async function startVoiceCall(
        params: StartVoiceCallParams
): Promise<StartVoiceCallResponse> {
        return await rpcCall(async () => {
                return await voiceClient.startVoiceCall({
                        channelId: params.channelId,
                        requestRecording: params.requestRecording ?? false,
                }) as StartVoiceCallResponse;
        });
}

export async function getActiveVoiceCall(channelId: string): Promise<GetActiveVoiceCallResponse> {
        return await rpcCall(async () => {
                return await voiceClient.getActiveVoiceCall({ channelId }) as GetActiveVoiceCallResponse;
        });
}

export async function joinVoiceCall(callId: string): Promise<JoinVoiceCallResponse> {
        return await rpcCall(async () => {
                return await voiceClient.joinVoiceCall({ callId }) as JoinVoiceCallResponse;
        });
}

export async function leaveVoiceCall(callId: string): Promise<LeaveVoiceCallResponse> {
        return await rpcCall(async () => {
                return await voiceClient.leaveVoiceCall({ callId }) as LeaveVoiceCallResponse;
        });
}

export async function endVoiceCall(callId: string): Promise<EndVoiceCallResponse> {
        return await rpcCall(async () => {
                return await voiceClient.endVoiceCall({ callId }) as EndVoiceCallResponse;
        });
}

export async function inviteToVoiceCall(
        params: InviteToVoiceCallParams
): Promise<InviteToVoiceCallResponse> {
        return await rpcCall(async () => {
                return await voiceClient.inviteToVoiceCall({
                        callId: params.callId,
                        employeeIds: params.employeeIds,
                }) as InviteToVoiceCallResponse;
        });
}

export async function respondToVoiceCallInvite(
        params: RespondToVoiceCallInviteParams
): Promise<RespondToVoiceCallInviteResponse> {
        return await rpcCall(async () => {
                return await voiceClient.respondToVoiceCallInvite({
                        invitationId: params.invitationId,
                        response: toVoiceInviteResponse(params.response),
                }) as RespondToVoiceCallInviteResponse;
        });
}

export async function listCallRecords(
        params: ListCallRecordsParams
): Promise<ListCallRecordsResponse> {
        return await rpcCall(async () => {
                return await voiceClient.listCallRecords({
                        channelId: params.channelId,
                        cursor: params.cursor ?? '',
                        limit: params.limit ?? 50,
                }) as ListCallRecordsResponse;
        });
}

export async function getCallRecord(callId: string): Promise<GetCallRecordResponse> {
        return await rpcCall(async () => {
                return await voiceClient.getCallRecord({ callId }) as GetCallRecordResponse;
        });
}

export async function requestVoiceMessageUpload(
        params: RequestVoiceMessageUploadParams
): Promise<RequestVoiceMessageUploadResponse> {
        return await rpcCall(async () => {
                return await voiceClient.requestVoiceMessageUpload({
                        channelId: params.channelId,
                        clientDeduplicationKey: params.clientDeduplicationKey,
                        filename: params.filename,
                        mimeType: params.mimeType,
                        sizeBytes: toBigInt(params.sizeBytes),
                        expectedDurationMs: toBigInt(params.expectedDurationMs),
                }) as RequestVoiceMessageUploadResponse;
        });
}

export async function confirmVoiceMessageUpload(
        params: ConfirmVoiceMessageUploadParams
): Promise<ConfirmVoiceMessageUploadResponse> {
        return await rpcCall(async () => {
                return await voiceClient.confirmVoiceMessageUpload({
                        voiceMessageId: params.voiceMessageId,
                        fileId: params.fileId,
                        clientDeduplicationKey: params.clientDeduplicationKey,
                        durationMs: toBigInt(params.durationMs),
                        waveformPeaks: params.waveformPeaks ?? [],
                }) as ConfirmVoiceMessageUploadResponse;
        });
}

export async function cancelVoiceMessage(voiceMessageId: string): Promise<CancelVoiceMessageResponse> {
        return await rpcCall(async () => {
                return await voiceClient.cancelVoiceMessage({ voiceMessageId }) as CancelVoiceMessageResponse;
        });
}