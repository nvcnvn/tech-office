package organization

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/converter"
	"github.com/nvcnvn/tech-office/backend/internal/iam"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"

	v1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// OrganizationServiceConnect is the RPC handler layer for organization operations.
// It owns connection pools, manages transactions, extracts auth context,
// and translates between protobuf and domain types.
type OrganizationServiceConnect struct {
	rpcv1connect.UnimplementedOrganizationServiceHandler
	Logic      OrganizationLogic
	AdminPool  database.AdminDatabaseConnector
	TenantPool database.TenantDatabaseConnector
}

// NewOrganizationServiceConnect creates a new organization service connect layer
func NewOrganizationServiceConnect(
	logic OrganizationLogic,
	adminPool database.AdminDatabaseConnector,
	tenantPool database.TenantDatabaseConnector,
) *OrganizationServiceConnect {
	return &OrganizationServiceConnect{
		Logic:      logic,
		AdminPool:  adminPool,
		TenantPool: tenantPool,
	}
}

// GetOrganizationBySubdomain resolves organization from subdomain for login page
// Called by frontend before initiating OIDC flow to display org name and get org ID
// This endpoint is unauthenticated (allow_unauthenticated: true in proto)
func (s *OrganizationServiceConnect) GetOrganizationBySubdomain(
	ctx context.Context,
	req *connect.Request[v1.GetOrganizationBySubdomainRequest],
) (*connect.Response[v1.GetOrganizationBySubdomainResponse], error) {
	slog.DebugContext(ctx, "GetOrganizationBySubdomain RPC called",
		"function", "GetOrganizationBySubdomain",
		"subdomain", req.Msg.Subdomain,
	)

	subdomain := req.Msg.Subdomain

	// Read-only operation: pass pool directly
	org, err := s.Logic.GetOrganizationBySubdomain(ctx, s.AdminPool, subdomain)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}

	// Step 4: Return organization details
	return connect.NewResponse(&v1.GetOrganizationBySubdomainResponse{
		Organization: converter.OrganizationToProto(org),
	}), nil
}

// RegisterOrganizationWithAdminPassword handles the registration of a new organization along with an admin user.
// This is a write operation that requires a transaction.
func (s *OrganizationServiceConnect) RegisterOrganizationWithAdminPassword(
	ctx context.Context,
	req *connect.Request[v1.RegisterOrganizationWithAdminPasswordRequest],
) (*connect.Response[v1.RegisterOrganizationWithAdminPasswordResponse], error) {
	slog.DebugContext(ctx, "RegisterOrganizationWithAdminPassword RPC called",
		"function", "RegisterOrganizationWithAdminPassword",
		"companyName", req.Msg.CompanyName,
		"subdomain", req.Msg.Subdomain,
	)

	// The terms must be acknowledged to create an account (FR-010). This is a
	// required field rather than an optional one: a request that omits it is
	// rejected, so no account can exist without a recorded acceptance.
	if err := iam.ValidateAcceptedTermsVersion(req.Msg.GetAcceptedTermsVersion()); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// Convert proto request to logic layer parameters
	params := &RegisterOrgParams{
		CompanyName:          req.Msg.CompanyName,
		Subdomain:            req.Msg.Subdomain,
		AdminEmail:           req.Msg.AdminEmail,
		AdminPassword:        req.Msg.AdminPassword,
		AdminGivenName:       req.Msg.AdminGivenName,
		AdminFamilyName:      req.Msg.AdminFamilyName,
		AcceptedTermsVersion: req.Msg.GetAcceptedTermsVersion(),
	}

	// Write operation: use transaction
	var organizationRecord *database.Organization
	err := txn.WithTxn(ctx, s.AdminPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		organizationRecord, txErr = s.Logic.RegisterOrganizationWithAdmin(ctx, tx, params)
		return txErr
	})

	if err != nil {
		// Error is already wrapped from logic layer or connect.NewError from txn
		slog.ErrorContext(ctx, "failed to register organization",
			"function", "RegisterOrganizationWithAdminPassword",
			"error", err,
		)
		return nil, toConnectError(err)
	}

	resp := &v1.RegisterOrganizationWithAdminPasswordResponse{
		Organization: converter.OrganizationToProto(organizationRecord),
	}
	slog.InfoContext(ctx, "organization registration completed",
		"function", "RegisterOrganizationWithAdminPassword",
		"orgID", resp.GetOrganization().GetId(),
	)

	return connect.NewResponse(resp), nil
}

// CheckSubdomainAvailable reports whether a workspace address is free and well-formed.
// Unauthenticated: it is called by a signup form before an account exists.
func (s *OrganizationServiceConnect) CheckSubdomainAvailable(
	ctx context.Context,
	req *connect.Request[v1.CheckSubdomainAvailableRequest],
) (*connect.Response[v1.CheckSubdomainAvailableResponse], error) {
	slog.DebugContext(ctx, "CheckSubdomainAvailable RPC called",
		"function", "CheckSubdomainAvailable",
		"subdomain", req.Msg.Subdomain,
	)

	// Read-only operation: pass pool directly
	available, suggested, err := s.Logic.CheckSubdomainAvailable(ctx, s.AdminPool, req.Msg.Subdomain)
	if err != nil {
		// A taken address is not an error here — only a malformed one is.
		return nil, toConnectError(err)
	}

	return connect.NewResponse(&v1.CheckSubdomainAvailableResponse{
		Available: available,
		Suggested: suggested,
	}), nil
}

// toConnectError maps organization domain errors to Connect codes, attaching a
// google.rpc.BadRequest naming `subdomain` so a six-field signup form knows which input to
// correct rather than receiving a bare code for the whole request (Principle X).
func toConnectError(err error) *connect.Error {
	switch {
	case errors.Is(err, ErrSubdomainTaken):
		return subdomainViolation(connect.CodeAlreadyExists, err, "already in use")
	case errors.Is(err, ErrSubdomainInvalid):
		return subdomainViolation(connect.CodeInvalidArgument, err, err.Error())
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

func subdomainViolation(code connect.Code, err error, description string) *connect.Error {
	cErr := connect.NewError(code, err)

	badReq := &errdetails.BadRequest{
		FieldViolations: []*errdetails.BadRequest_FieldViolation{
			{
				Field:       "subdomain",
				Description: description,
			},
		},
	}
	if d, detailErr := connect.NewErrorDetail(badReq); detailErr == nil {
		cErr.AddDetail(d)
	}

	return cErr
}

func (s *OrganizationServiceConnect) SearchEmployees(
	ctx context.Context,
	req *connect.Request[v1.SearchEmployeesRequest],
) (*connect.Response[v1.SearchEmployeesResponse], error) {
	slog.DebugContext(ctx, "SearchEmployees RPC called",
		"function", "SearchEmployees",
		"query_text", req.Msg.QueryText,
		"limit", req.Msg.Limit,
	)

	orgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		slog.ErrorContext(ctx, "missing organization context",
			"function", "SearchDepartments",
		)
		return nil, connect.NewError(connect.CodeUnauthenticated, nil)
	}

	organizationID := dbuuid.MustParse(orgID)

	// Convert cursor
	var cursor *dbuuid.UUID
	if req.Msg.Cursor != "" {
		c := converter.ProtoToUUID(req.Msg.Cursor)
		cursor = &c
	}

	// Call logic layer
	results, err := s.Logic.SearchEmployees(
		ctx,
		s.TenantPool, // Read-only operation, no transaction needed
		organizationID,
		req.Msg.QueryText,
		req.Msg.Limit,
		cursor,
	)
	if err != nil {
		slog.ErrorContext(ctx, "employee search failed",
			"function", "SearchEmployees",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert results to proto
	protoResults := make([]*v1.EmployeeSearchResult, len(results))
	for i, r := range results {
		protoResults[i] = &v1.EmployeeSearchResult{
			Id:             converter.UUIDToProto(r.ID),
			Email:          r.Email,
			GivenName:      r.GivenName,
			FamilyName:     r.FamilyName,
			IsActive:       r.IsActive,
			RelevanceScore: r.RelevanceScore,
			UpdatedAt:      converter.TimeToProto(r.UpdatedAt),
		}
	}

	resp := &v1.SearchEmployeesResponse{
		Results: protoResults,
	}

	slog.DebugContext(ctx, "employee search completed",
		"function", "SearchEmployees",
		"result_count", len(protoResults),
	)

	return connect.NewResponse(resp), nil
}

func (s *OrganizationServiceConnect) SearchDepartments(
	ctx context.Context,
	req *connect.Request[v1.SearchDepartmentsRequest],
) (*connect.Response[v1.SearchDepartmentsResponse], error) {
	slog.DebugContext(ctx, "SearchDepartments RPC called",
		"function", "SearchDepartments",
		"query_text", req.Msg.QueryText,
		"limit", req.Msg.Limit,
	)

	orgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		slog.ErrorContext(ctx, "missing organization context",
			"function", "SearchDepartments",
		)
		return nil, connect.NewError(connect.CodeUnauthenticated, nil)
	}

	organizationID := dbuuid.MustParse(orgID)
	// Convert cursor
	var cursor *dbuuid.UUID
	if req.Msg.Cursor != "" {
		c := converter.ProtoToUUID(req.Msg.Cursor)
		cursor = &c
	}

	// Call logic layer
	results, err := s.Logic.SearchDepartments(
		ctx,
		s.TenantPool,
		organizationID,
		req.Msg.QueryText,
		req.Msg.Limit,
		cursor,
	)
	if err != nil {
		slog.ErrorContext(ctx, "department search failed",
			"function", "SearchDepartments",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert results to proto
	protoResults := make([]*v1.DepartmentSearchResult, len(results))
	for i, r := range results {
		protoResults[i] = &v1.DepartmentSearchResult{
			Id:                 converter.UUIDToProto(r.ID),
			Name:               r.Name,
			Description:        r.Description.String,
			MemberCount:        r.MemberCount,
			ParentDepartmentId: converter.NullUUIDToProto(r.ParentDepartmentID),
			RelevanceScore:     r.RelevanceScore,
			UpdatedAt:          converter.TimeToProto(r.UpdatedAt),
		}
	}

	resp := &v1.SearchDepartmentsResponse{
		Results: protoResults,
	}

	slog.DebugContext(ctx, "department search completed",
		"function", "SearchDepartments",
		"result_count", len(protoResults),
	)

	return connect.NewResponse(resp), nil
}

func (s *OrganizationServiceConnect) AutocompleteEmployees(
	ctx context.Context,
	req *connect.Request[v1.AutocompleteEmployeesRequest],
) (*connect.Response[v1.AutocompleteEmployeesResponse], error) {
	slog.DebugContext(ctx, "AutocompleteEmployees RPC called",
		"function", "AutocompleteEmployees",
		"prefix", req.Msg.Prefix,
		"limit", req.Msg.Limit,
	)

	orgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		slog.ErrorContext(ctx, "missing organization context",
			"function", "SearchDepartments",
		)
		return nil, connect.NewError(connect.CodeUnauthenticated, nil)
	}

	organizationID := dbuuid.MustParse(orgID)

	// Call logic layer
	results, err := s.Logic.AutocompleteEmployees(
		ctx,
		s.TenantPool,
		organizationID,
		req.Msg.Prefix,
		req.Msg.Limit,
	)
	if err != nil {
		slog.ErrorContext(ctx, "employee autocomplete failed",
			"function", "AutocompleteEmployees",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert results to proto
	protoSuggestions := make([]*v1.EmployeeAutocompleteSuggestion, len(results))
	for i, r := range results {
		protoSuggestions[i] = &v1.EmployeeAutocompleteSuggestion{
			Id:         converter.UUIDToProto(r.ID),
			Email:      r.Email,
			GivenName:  r.GivenName,
			FamilyName: r.FamilyName,
		}
	}

	resp := &v1.AutocompleteEmployeesResponse{
		Suggestions: protoSuggestions,
	}

	slog.DebugContext(ctx, "employee autocomplete completed",
		"function", "AutocompleteEmployees",
		"suggestion_count", len(protoSuggestions),
	)

	return connect.NewResponse(resp), nil
}

func (s *OrganizationServiceConnect) AutocompleteDepartments(
	ctx context.Context,
	req *connect.Request[v1.AutocompleteDepartmentsRequest],
) (*connect.Response[v1.AutocompleteDepartmentsResponse], error) {
	slog.DebugContext(ctx, "AutocompleteDepartments RPC called",
		"function", "AutocompleteDepartments",
		"prefix", req.Msg.Prefix,
		"limit", req.Msg.Limit,
	)

	orgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		slog.ErrorContext(ctx, "missing organization context",
			"function", "SearchDepartments",
		)
		return nil, connect.NewError(connect.CodeUnauthenticated, nil)
	}

	organizationID := dbuuid.MustParse(orgID)

	// Call logic layer
	results, err := s.Logic.AutocompleteDepartments(
		ctx,
		s.TenantPool,
		organizationID,
		req.Msg.Prefix,
		req.Msg.Limit,
	)
	if err != nil {
		slog.ErrorContext(ctx, "department autocomplete failed",
			"function", "AutocompleteDepartments",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert results to proto
	protoSuggestions := make([]*v1.DepartmentAutocompleteSuggestion, len(results))
	for i, r := range results {
		protoSuggestions[i] = &v1.DepartmentAutocompleteSuggestion{
			Id:          converter.UUIDToProto(r.ID),
			Name:        r.Name,
			Description: r.Description.String,
		}
	}

	resp := &v1.AutocompleteDepartmentsResponse{
		Suggestions: protoSuggestions,
	}

	slog.DebugContext(ctx, "department autocomplete completed",
		"function", "AutocompleteDepartments",
		"suggestion_count", len(protoSuggestions),
	)

	return connect.NewResponse(resp), nil
}
