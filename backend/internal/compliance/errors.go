package compliance

import (
	"errors"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
)

const ErrorDomain = "compliance.tech-office"

type ErrorReason string

const (
	ErrorReasonReportNotFound       ErrorReason = "COMPLIANCE_REPORT_NOT_FOUND"
	ErrorReasonReportAlreadyFiled   ErrorReason = "COMPLIANCE_REPORT_ALREADY_FILED"
	ErrorReasonReportAlreadyClosed  ErrorReason = "COMPLIANCE_REPORT_ALREADY_RESOLVED"
	ErrorReasonInvalidReason        ErrorReason = "COMPLIANCE_INVALID_REPORT_REASON"
	ErrorReasonInvalidTarget        ErrorReason = "COMPLIANCE_INVALID_REPORT_TARGET"
	ErrorReasonTargetNotFound       ErrorReason = "COMPLIANCE_REPORT_TARGET_NOT_FOUND"
	ErrorReasonOutcomeNoteRequired  ErrorReason = "COMPLIANCE_OUTCOME_NOTE_REQUIRED"
	ErrorReasonCannotBlockSelf      ErrorReason = "COMPLIANCE_CANNOT_BLOCK_SELF"
	ErrorReasonContactBlocked       ErrorReason = "COMPLIANCE_CONTACT_BLOCKED"
	ErrorReasonRemovalNotFound      ErrorReason = "COMPLIANCE_REMOVAL_REQUEST_NOT_FOUND"
	ErrorReasonRemovalAlreadyClosed ErrorReason = "COMPLIANCE_REMOVAL_REQUEST_DECIDED"
	ErrorReasonInvalidDecision      ErrorReason = "COMPLIANCE_INVALID_DECISION"
	ErrorReasonNotOrgManaged        ErrorReason = "COMPLIANCE_NOT_ORG_MANAGED"
)

var (
	ErrReportNotFound       = errors.New("content report not found")
	ErrReportAlreadyFiled   = errors.New("you have already reported this item; it is waiting for review")
	ErrReportAlreadyClosed  = errors.New("this report has already been resolved")
	ErrInvalidReason        = errors.New("a report must give a reason")
	ErrInvalidTarget        = errors.New("a report must name what kind of item it is about")
	ErrTargetNotFound       = errors.New("the reported item could not be found")
	ErrOutcomeNoteRequired  = errors.New("recording an outcome requires a note describing what was done")
	ErrCannotBlockSelf      = errors.New("you cannot block yourself")
	ErrRemovalNotFound      = errors.New("removal request not found")
	ErrRemovalAlreadyClosed = errors.New("this removal request has already been decided")
	ErrInvalidDecision      = errors.New("a removal request must be granted or declined")
	ErrNotOrgManaged        = errors.New("only accounts created by an administrator use the removal-request path")

	// ErrContactBlocked is returned to the *initiator* of direct contact. Its text
	// deliberately does not say who blocked whom: the blocked person must never
	// learn that they were blocked (FR-022).
	ErrContactBlocked = errors.New("this conversation is not available")
)

var errorReasons = map[error]struct {
	reason ErrorReason
	code   connect.Code
}{
	ErrReportNotFound:       {ErrorReasonReportNotFound, connect.CodeNotFound},
	ErrReportAlreadyFiled:   {ErrorReasonReportAlreadyFiled, connect.CodeAlreadyExists},
	ErrReportAlreadyClosed:  {ErrorReasonReportAlreadyClosed, connect.CodeFailedPrecondition},
	ErrInvalidReason:        {ErrorReasonInvalidReason, connect.CodeInvalidArgument},
	ErrInvalidTarget:        {ErrorReasonInvalidTarget, connect.CodeInvalidArgument},
	ErrTargetNotFound:       {ErrorReasonTargetNotFound, connect.CodeNotFound},
	ErrOutcomeNoteRequired:  {ErrorReasonOutcomeNoteRequired, connect.CodeInvalidArgument},
	ErrCannotBlockSelf:      {ErrorReasonCannotBlockSelf, connect.CodeInvalidArgument},
	ErrContactBlocked:       {ErrorReasonContactBlocked, connect.CodeFailedPrecondition},
	ErrRemovalNotFound:      {ErrorReasonRemovalNotFound, connect.CodeNotFound},
	ErrRemovalAlreadyClosed: {ErrorReasonRemovalAlreadyClosed, connect.CodeFailedPrecondition},
	ErrInvalidDecision:      {ErrorReasonInvalidDecision, connect.CodeInvalidArgument},
	ErrNotOrgManaged:        {ErrorReasonNotOrgManaged, connect.CodeFailedPrecondition},
}

// ToConnectError maps a domain error to a Connect error carrying an ErrorInfo
// detail, so clients branch on a stable reason rather than on message text
// (Constitution Principle X).
func ToConnectError(err error, metadata map[string]string) *connect.Error {
	if err == nil {
		return nil
	}
	for domainErr, mapping := range errorReasons {
		if errors.Is(err, domainErr) {
			connectErr := connect.NewError(mapping.code, domainErr)
			info := &errdetails.ErrorInfo{
				Reason:   string(mapping.reason),
				Domain:   ErrorDomain,
				Metadata: metadata,
			}
			if detail, detailErr := connect.NewErrorDetail(info); detailErr == nil {
				connectErr.AddDetail(detail)
			}
			return connectErr
		}
	}
	return connect.NewError(connect.CodeInternal, err)
}
