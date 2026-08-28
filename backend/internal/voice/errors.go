package voice

import (
	"errors"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
)

const ErrorDomain = "voice.tech-office"

type ErrorReason string

const (
	ErrorReasonCallNotFound             ErrorReason = "VOICE_CALL_NOT_FOUND"
	ErrorReasonCallAlreadyActive        ErrorReason = "VOICE_CALL_ALREADY_ACTIVE"
	ErrorReasonCallEnded                ErrorReason = "VOICE_CALL_ENDED"
	ErrorReasonAccessDenied             ErrorReason = "VOICE_ACCESS_DENIED"
	ErrorReasonParticipantLimitExceeded ErrorReason = "VOICE_PARTICIPANT_LIMIT_EXCEEDED"
	ErrorReasonInviteNotFound           ErrorReason = "VOICE_INVITE_NOT_FOUND"
	ErrorReasonInviteExpired            ErrorReason = "VOICE_INVITE_EXPIRED"
	ErrorReasonInviteAlreadyResponded   ErrorReason = "VOICE_INVITE_ALREADY_RESPONDED"
	ErrorReasonUploadNotFound           ErrorReason = "VOICE_UPLOAD_NOT_FOUND"
	ErrorReasonInvalidUpload            ErrorReason = "VOICE_INVALID_UPLOAD"
	ErrorReasonVoiceMessageFinalized    ErrorReason = "VOICE_MESSAGE_FINALIZED"
	ErrorReasonIdempotencyConflict      ErrorReason = "VOICE_MESSAGE_IDEMPOTENCY_CONFLICT"
	ErrorReasonUnsupportedMimeType      ErrorReason = "VOICE_UNSUPPORTED_MIME_TYPE"
	ErrorReasonMediaProviderUnavailable ErrorReason = "VOICE_MEDIA_PROVIDER_UNAVAILABLE"
	ErrorReasonDirectContactBlocked     ErrorReason = "VOICE_DIRECT_CONTACT_BLOCKED"
	ErrorReasonCalleeBusy               ErrorReason = "VOICE_CALLEE_BUSY"
	ErrorReasonCalleeUnreachable        ErrorReason = "VOICE_CALLEE_UNREACHABLE"
)

var (
	ErrCallNotFound                    = errors.New("voice call not found")
	ErrCallAlreadyActive               = errors.New("voice call already active")
	ErrCallEnded                       = errors.New("voice call has ended")
	ErrAccessDenied                    = errors.New("voice call access denied")
	ErrParticipantLimitExceeded        = errors.New("voice participant limit exceeded")
	ErrInviteNotFound                  = errors.New("voice invitation not found")
	ErrInviteExpired                   = errors.New("voice invitation has expired")
	ErrInviteAlreadyResponded          = errors.New("voice invitation already responded")
	ErrUploadNotFound                  = errors.New("voice upload not found")
	ErrInvalidUpload                   = errors.New("invalid voice upload")
	ErrVoiceMessageFinalized           = errors.New("voice message upload is finalized")
	ErrVoiceMessageIdempotencyConflict = errors.New("voice message idempotency conflict")
	ErrUnsupportedMimeType             = errors.New("unsupported voice mime type")
	ErrMediaProviderUnavailable        = errors.New("voice media provider unavailable")

	// ErrDirectContactBlocked is returned when a block refuses a call in a direct
	// conversation. Its text names neither party and does not say a block exists:
	// the blocked person must never learn they were blocked (Feature 036, FR-022).
	ErrDirectContactBlocked = errors.New("this call is not available")

	// ErrCalleeBusy and ErrCalleeUnreachable are outcomes the caller has to be able to
	// tell apart — one means try again later, the other means this person cannot be
	// reached at all — so they are structured error details rather than message text
	// the caller's UI would have to match on (Constitution X).
	ErrCalleeBusy = errors.New("the person you are calling is already on a call")

	// ErrCalleeUnreachable ends the call immediately instead of ringing out for the
	// full timeout, so the caller stops re-dialling a phone that cannot be woken
	// (FR-006, SC-006).
	ErrCalleeUnreachable = errors.New("the person you are calling cannot be reached")
)

func ToConnectError(err error, metadata map[string]string) *connect.Error {
	if err == nil {
		return nil
	}

	code, reason := connect.CodeInternal, ErrorReasonMediaProviderUnavailable
	switch {
	case errors.Is(err, ErrCallNotFound):
		code, reason = connect.CodeNotFound, ErrorReasonCallNotFound
	case errors.Is(err, ErrCallAlreadyActive):
		code, reason = connect.CodeAlreadyExists, ErrorReasonCallAlreadyActive
	case errors.Is(err, ErrCallEnded):
		code, reason = connect.CodeFailedPrecondition, ErrorReasonCallEnded
	case errors.Is(err, ErrAccessDenied):
		code, reason = connect.CodePermissionDenied, ErrorReasonAccessDenied
	case errors.Is(err, ErrParticipantLimitExceeded):
		code, reason = connect.CodeResourceExhausted, ErrorReasonParticipantLimitExceeded
	case errors.Is(err, ErrInviteNotFound):
		code, reason = connect.CodeNotFound, ErrorReasonInviteNotFound
	case errors.Is(err, ErrInviteExpired):
		code, reason = connect.CodeFailedPrecondition, ErrorReasonInviteExpired
	case errors.Is(err, ErrInviteAlreadyResponded):
		code, reason = connect.CodeFailedPrecondition, ErrorReasonInviteAlreadyResponded
	case errors.Is(err, ErrUploadNotFound):
		code, reason = connect.CodeNotFound, ErrorReasonUploadNotFound
	case errors.Is(err, ErrInvalidUpload):
		code, reason = connect.CodeInvalidArgument, ErrorReasonInvalidUpload
	case errors.Is(err, ErrVoiceMessageFinalized):
		code, reason = connect.CodeFailedPrecondition, ErrorReasonVoiceMessageFinalized
	case errors.Is(err, ErrVoiceMessageIdempotencyConflict):
		code, reason = connect.CodeAlreadyExists, ErrorReasonIdempotencyConflict
	case errors.Is(err, ErrUnsupportedMimeType):
		code, reason = connect.CodeInvalidArgument, ErrorReasonUnsupportedMimeType
	case errors.Is(err, ErrMediaProviderUnavailable):
		code, reason = connect.CodeUnavailable, ErrorReasonMediaProviderUnavailable
	case errors.Is(err, ErrDirectContactBlocked):
		code, reason = connect.CodeFailedPrecondition, ErrorReasonDirectContactBlocked
	case errors.Is(err, ErrCalleeBusy):
		code, reason = connect.CodeFailedPrecondition, ErrorReasonCalleeBusy
	case errors.Is(err, ErrCalleeUnreachable):
		code, reason = connect.CodeFailedPrecondition, ErrorReasonCalleeUnreachable
	}

	connectErr := connect.NewError(code, err)
	info := &errdetails.ErrorInfo{
		Reason:   string(reason),
		Domain:   ErrorDomain,
		Metadata: metadata,
	}
	if detail, detailErr := connect.NewErrorDetail(info); detailErr == nil {
		connectErr.AddDetail(detail)
	}
	return connectErr
}
