// Package compliance implements content reporting, blocking, account removal
// requests and the resumable account-deletion worker (Feature 036).
//
// Constitution Principle VIII: every enumeration below is mirrored in four
// places, and changing one means changing all four in the same change set:
//
//	SQL CHECK   backend/database/scripts/schema.sql (and the 036 migration)
//	Go          this file
//	proto       backend/rpc/v1/compliance.proto
//	TypeScript  frontend/packages/apis/src/compliance.ts
package compliance

import rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"

// === Report target kinds ===
// MUST align with the target_kind CHECK on compliance.content_report and
// rpcv1.ReportTargetKind.
const (
	TargetKindChatMessage     = "chat_message"
	TargetKindDirectMessage   = "direct_message"
	TargetKindFile            = "file"
	TargetKindDocumentComment = "document_comment"
	TargetKindCallRecord      = "call_record"
)

var targetKindByProto = map[rpcv1.ReportTargetKind]string{
	rpcv1.ReportTargetKind_REPORT_TARGET_KIND_CHAT_MESSAGE:     TargetKindChatMessage,
	rpcv1.ReportTargetKind_REPORT_TARGET_KIND_DIRECT_MESSAGE:   TargetKindDirectMessage,
	rpcv1.ReportTargetKind_REPORT_TARGET_KIND_FILE:             TargetKindFile,
	rpcv1.ReportTargetKind_REPORT_TARGET_KIND_DOCUMENT_COMMENT: TargetKindDocumentComment,
	rpcv1.ReportTargetKind_REPORT_TARGET_KIND_CALL_RECORD:      TargetKindCallRecord,
}

// TargetKindFromProto returns the stored string for a proto target kind. The
// zero value UNSPECIFIED returns ok=false so a client that omits the field is
// rejected rather than silently defaulting.
func TargetKindFromProto(k rpcv1.ReportTargetKind) (string, bool) {
	v, ok := targetKindByProto[k]
	return v, ok
}

func TargetKindToProto(s string) rpcv1.ReportTargetKind {
	for k, v := range targetKindByProto {
		if v == s {
			return k
		}
	}
	return rpcv1.ReportTargetKind_REPORT_TARGET_KIND_UNSPECIFIED
}

// === Report reasons ===
// MUST align with the reason CHECK on compliance.content_report and
// rpcv1.ReportReason.
const (
	ReasonHarassment    = "harassment"
	ReasonHateSpeech    = "hate_speech"
	ReasonSexualContent = "sexual_content"
	ReasonViolence      = "violence"
	ReasonSpam          = "spam"
	ReasonOther         = "other"
)

var reasonByProto = map[rpcv1.ReportReason]string{
	rpcv1.ReportReason_REPORT_REASON_HARASSMENT:     ReasonHarassment,
	rpcv1.ReportReason_REPORT_REASON_HATE_SPEECH:    ReasonHateSpeech,
	rpcv1.ReportReason_REPORT_REASON_SEXUAL_CONTENT: ReasonSexualContent,
	rpcv1.ReportReason_REPORT_REASON_VIOLENCE:       ReasonViolence,
	rpcv1.ReportReason_REPORT_REASON_SPAM:           ReasonSpam,
	rpcv1.ReportReason_REPORT_REASON_OTHER:          ReasonOther,
}

// ReasonFromProto returns the stored string for a proto reason. UNSPECIFIED
// returns ok=false: a report without a reason is rejected (FR-015).
func ReasonFromProto(r rpcv1.ReportReason) (string, bool) {
	v, ok := reasonByProto[r]
	return v, ok
}

func ReasonToProto(s string) rpcv1.ReportReason {
	for k, v := range reasonByProto {
		if v == s {
			return k
		}
	}
	return rpcv1.ReportReason_REPORT_REASON_UNSPECIFIED
}

// === Report status / outcome ===
// MUST align with the status CHECK on compliance.content_report and
// rpcv1.ReportStatus.
const (
	ReportStatusOutstanding = "outstanding"
	ReportStatusActioned    = "actioned"
	ReportStatusDismissed   = "dismissed"
)

var reportStatusByProto = map[rpcv1.ReportStatus]string{
	rpcv1.ReportStatus_REPORT_STATUS_OUTSTANDING: ReportStatusOutstanding,
	rpcv1.ReportStatus_REPORT_STATUS_ACTIONED:    ReportStatusActioned,
	rpcv1.ReportStatus_REPORT_STATUS_DISMISSED:   ReportStatusDismissed,
}

func ReportStatusFromProto(s rpcv1.ReportStatus) (string, bool) {
	v, ok := reportStatusByProto[s]
	return v, ok
}

func ReportStatusToProto(s string) rpcv1.ReportStatus {
	for k, v := range reportStatusByProto {
		if v == s {
			return k
		}
	}
	return rpcv1.ReportStatus_REPORT_STATUS_UNSPECIFIED
}

// IsReportOutcome reports whether a status is one a reviewer may resolve to.
// OUTSTANDING is not an outcome.
func IsReportOutcome(s string) bool {
	return s == ReportStatusActioned || s == ReportStatusDismissed
}

// === Removal request status ===
// MUST align with the status CHECK on compliance.removal_request and
// rpcv1.RemovalRequestStatus.
const (
	RemovalStatusOutstanding = "outstanding"
	RemovalStatusGranted     = "granted"
	RemovalStatusDeclined    = "declined"
)

var removalStatusByProto = map[rpcv1.RemovalRequestStatus]string{
	rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_OUTSTANDING: RemovalStatusOutstanding,
	rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_GRANTED:     RemovalStatusGranted,
	rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_DECLINED:    RemovalStatusDeclined,
}

func RemovalStatusFromProto(s rpcv1.RemovalRequestStatus) (string, bool) {
	v, ok := removalStatusByProto[s]
	return v, ok
}

func RemovalStatusToProto(s string) rpcv1.RemovalRequestStatus {
	for k, v := range removalStatusByProto {
		if v == s {
			return k
		}
	}
	return rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_UNSPECIFIED
}

// IsRemovalDecision reports whether a status is one an owner may decide to.
func IsRemovalDecision(s string) bool {
	return s == RemovalStatusGranted || s == RemovalStatusDeclined
}

// === Account deletion state ===
// MUST align with the state CHECK on compliance.account_deletion and
// rpcv1.AccountDeletionState.
//
// State machine (research.md R3):
//
//	pending -> anonymising -> purging -> done
//	   |            |            |
//	   +------------+------------+--> failed  (retryable; the worker resumes from
//	                                           the last completed state)
const (
	DeletionStatePending     = "pending"
	DeletionStateAnonymising = "anonymising"
	DeletionStatePurging     = "purging"
	DeletionStateDone        = "done"
	DeletionStateFailed      = "failed"
)

var deletionStateByProto = map[rpcv1.AccountDeletionState]string{
	rpcv1.AccountDeletionState_ACCOUNT_DELETION_STATE_PENDING:     DeletionStatePending,
	rpcv1.AccountDeletionState_ACCOUNT_DELETION_STATE_ANONYMISING: DeletionStateAnonymising,
	rpcv1.AccountDeletionState_ACCOUNT_DELETION_STATE_PURGING:     DeletionStatePurging,
	rpcv1.AccountDeletionState_ACCOUNT_DELETION_STATE_DONE:        DeletionStateDone,
	rpcv1.AccountDeletionState_ACCOUNT_DELETION_STATE_FAILED:      DeletionStateFailed,
}

func DeletionStateToProto(s string) rpcv1.AccountDeletionState {
	for k, v := range deletionStateByProto {
		if v == s {
			return k
		}
	}
	return rpcv1.AccountDeletionState_ACCOUNT_DELETION_STATE_UNSPECIFIED
}

// === Deletion triggers ===
// MUST align with the trigger CHECK on compliance.account_deletion.
const (
	DeletionTriggerSelfService           = "self_service"
	DeletionTriggerRemovalRequestGranted = "removal_request_granted"
)
