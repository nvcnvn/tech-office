package iam

import (
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/protobuf/types/known/durationpb"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// Domain errors for IAM operations.
var (
	ErrInvalidCredentials         = errors.New("invalid email or password")
	ErrUserNotFound               = errors.New("user not found")
	ErrUserSuspended              = errors.New("user account is suspended")
	ErrPasswordTooWeak            = errors.New("password does not meet complexity requirements")
	ErrInvalidResetToken          = errors.New("invalid or expired reset token")
	ErrResetTokenExpired          = errors.New("reset token has expired")
	ErrResetTokenUsed             = errors.New("reset token has already been used")
	ErrInvalidInvitation          = errors.New("invalid invitation")
	ErrInvitationExpired          = errors.New("invitation has expired")
	ErrInvitationNotPending       = errors.New("invitation is not pending")
	ErrInvitationSSOEmailMismatch = errors.New("this sign-in used a different email than the one invited. Continue with your invited email first, then link Apple or Google later")
	ErrCannotUnlinkLastAuth       = errors.New("cannot unlink last authentication method")
	ErrNotOrgMember               = errors.New("user is not a member of this organization")
	ErrAlreadyOrgMember           = errors.New("user is already a member of this organization")
	ErrSSOIdentityNotFound        = errors.New("SSO identity not found")
	ErrSSOIdentityNotOwned        = errors.New("SSO identity does not belong to this user")
	ErrInvalidSSOToken            = errors.New("invalid SSO token")
	ErrSessionNotFound            = errors.New("session not found")

	// PIN-based auth errors
	ErrPINTooShort              = errors.New("PIN must be exactly 6 digits")
	ErrPINNotNumeric            = errors.New("PIN must contain only numeric digits")
	ErrPINMatchesDOB            = errors.New("PIN must not match your date of birth")
	ErrPINMatchesPhone          = errors.New("PIN must not match your phone number")
	ErrDuplicateLoginIdentifier = errors.New("login identifier already exists in this organization")
	ErrTemporaryPINExpired      = errors.New("temporary PIN has expired")
	ErrInvalidPINChangeToken    = errors.New("invalid or expired PIN change token")
	ErrWorkerAccountSuspended   = errors.New("worker account is suspended")

	// ErrLoginIdentifierInvalid keeps the login_identifier and email namespaces disjoint.
	// PIN login resolves an identifier against either column, so a login identifier that
	// looks like an email could match two identities.
	ErrLoginIdentifierInvalid = errors.New("login identifier must not contain '@' — use a badge number or username, not an email address")

	// Voluntary PIN change errors. First-time set is exempt — see logic SetPIN.
	ErrCurrentPINRequired  = errors.New("current PIN is required to change an existing PIN")
	ErrCurrentPINIncorrect = errors.New("current PIN is incorrect")
)

// ErrAccountLocked is returned when an account is locked due to failed PIN attempts.
type ErrAccountLocked struct {
	Tier          int
	LockoutUntil  time.Time // Zero value when admin reset required
	AdminRequired bool
}

func (e *ErrAccountLocked) Error() string {
	if e.AdminRequired {
		return "account is locked, contact admin to unlock"
	}
	return fmt.Sprintf("account is locked (tier %d) until %s", e.Tier, e.LockoutUntil.Format(time.RFC3339))
}

// ToConnectError maps a domain error to a connect.Error with appropriate gRPC code.
func ToConnectError(err error) *connect.Error {
	// Check typed error first
	var lockoutErr *ErrAccountLocked
	if errors.As(err, &lockoutErr) {
		return lockoutToConnectError(lockoutErr)
	}

	switch {
	case errors.Is(err, ErrInvalidCredentials):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, ErrUserNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrUserSuspended),
		errors.Is(err, ErrWorkerAccountSuspended):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, ErrPasswordTooWeak):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrInvalidResetToken),
		errors.Is(err, ErrResetTokenExpired),
		errors.Is(err, ErrResetTokenUsed):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrInvalidInvitation),
		errors.Is(err, ErrInvitationExpired),
		errors.Is(err, ErrInvitationNotPending),
		errors.Is(err, ErrInvitationSSOEmailMismatch):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrCannotUnlinkLastAuth):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, ErrNotOrgMember):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, ErrAlreadyOrgMember):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, ErrSSOIdentityNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrSSOIdentityNotOwned):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, ErrInvalidSSOToken):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, ErrSessionNotFound):
		return connect.NewError(connect.CodeNotFound, err)

	// PIN validation errors → InvalidArgument with FieldViolation
	case errors.Is(err, ErrPINTooShort),
		errors.Is(err, ErrPINNotNumeric),
		errors.Is(err, ErrPINMatchesDOB),
		errors.Is(err, ErrPINMatchesPhone):
		return pinValidationToConnectError(err)

	// Duplicate login identifier → AlreadyExists with ResourceInfo
	case errors.Is(err, ErrDuplicateLoginIdentifier):
		return duplicateIdentifierToConnectError(err)

	// Malformed login identifier → InvalidArgument naming the field
	case errors.Is(err, ErrLoginIdentifierInvalid):
		return fieldViolationToConnectError(connect.CodeInvalidArgument, "login_identifier", err)

	// Voluntary PIN change: missing current PIN is a bad request, a wrong one is denied
	case errors.Is(err, ErrCurrentPINRequired):
		return fieldViolationToConnectError(connect.CodeInvalidArgument, "current_pin", err)
	case errors.Is(err, ErrCurrentPINIncorrect):
		return connect.NewError(connect.CodePermissionDenied, err)

	case errors.Is(err, ErrTemporaryPINExpired):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, ErrInvalidPINChangeToken):
		return connect.NewError(connect.CodeUnauthenticated, err)

	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

// lockoutToConnectError creates a ResourceExhausted error with PinAuthErrorDetail.
func lockoutToConnectError(lockoutErr *ErrAccountLocked) *connect.Error {
	cErr := connect.NewError(connect.CodeResourceExhausted, lockoutErr)

	detail := &rpcv1.PinAuthErrorDetail{
		LockoutTier:        int32(lockoutErr.Tier),
		AdminResetRequired: lockoutErr.AdminRequired,
	}
	if !lockoutErr.AdminRequired && !lockoutErr.LockoutUntil.IsZero() {
		detail.LockoutUntilUnix = lockoutErr.LockoutUntil.Unix()
	}

	if d, detailErr := connect.NewErrorDetail(detail); detailErr == nil {
		cErr.AddDetail(d)
	}

	// Tiers 1-3: attach google.rpc.RetryInfo so the client can render a live countdown
	// rather than a static "try later". Tier 4 carries none — no delay resolves a full lock.
	if !lockoutErr.AdminRequired && !lockoutErr.LockoutUntil.IsZero() {
		remaining := time.Until(lockoutErr.LockoutUntil)
		if remaining < 0 {
			remaining = 0
		}
		retryInfo := &errdetails.RetryInfo{RetryDelay: durationpb.New(remaining)}
		if d, detailErr := connect.NewErrorDetail(retryInfo); detailErr == nil {
			cErr.AddDetail(d)
		}
	}

	// Tier 4: also attach ErrorInfo
	if lockoutErr.AdminRequired {
		errorInfo := &errdetails.ErrorInfo{
			Reason: "PIN_ACCOUNT_LOCKED",
			Domain: "iam.tech-office",
		}
		if d, detailErr := connect.NewErrorDetail(errorInfo); detailErr == nil {
			cErr.AddDetail(d)
		}
	}

	return cErr
}

// pinValidationToConnectError creates an InvalidArgument error with BadRequest.FieldViolation.
func pinValidationToConnectError(err error) *connect.Error {
	return fieldViolationToConnectError(connect.CodeInvalidArgument, "new_pin", err)
}

// fieldViolationToConnectError attaches a google.rpc.BadRequest naming the offending field,
// so a client with several inputs on screen knows which one to correct.
func fieldViolationToConnectError(code connect.Code, field string, err error) *connect.Error {
	cErr := connect.NewError(code, err)

	badReq := &errdetails.BadRequest{
		FieldViolations: []*errdetails.BadRequest_FieldViolation{
			{
				Field:       field,
				Description: err.Error(),
			},
		},
	}
	if d, detailErr := connect.NewErrorDetail(badReq); detailErr == nil {
		cErr.AddDetail(d)
	}

	return cErr
}

// duplicateIdentifierToConnectError creates an AlreadyExists error with ResourceInfo.
func duplicateIdentifierToConnectError(err error) *connect.Error {
	cErr := connect.NewError(connect.CodeAlreadyExists, err)

	resourceInfo := &errdetails.ResourceInfo{
		ResourceType: "iam.identity",
		Description:  err.Error(),
	}
	if d, detailErr := connect.NewErrorDetail(resourceInfo); detailErr == nil {
		cErr.AddDetail(d)
	}

	return cErr
}
