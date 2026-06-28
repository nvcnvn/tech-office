package collaboration

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// CreateEvidenceRequirement creates a new evidence requirement for a ritual definition.
func (l *logicImpl) CreateEvidenceRequirement(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.CreateEvidenceRequirementRequest,
) (*rpcv1.EvidenceRequirementDetail, error) {
	ritualDefID := dbuuid.MustParse(req.RitualDefinitionId)

	// Get next position
	posResult, err := l.Queries.GetNextEvidenceRequirementPosition(ctx, tx, &database.GetNextEvidenceRequirementPositionParams{
		OrganizationID:     orgID,
		RitualDefinitionID: ritualDefID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get next position: %w", err)
	}

	evidenceTypes := make([]string, len(req.EvidenceTypes))
	for i, et := range req.EvidenceTypes {
		evidenceTypes[i] = evidenceTypeToString(et)
	}

	autoApproveJSON, err := marshalAutoApproveConfigProto(req.AutoApproveConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal auto approve config: %w", err)
	}

	er, err := l.Queries.CreateEvidenceRequirement(ctx, tx, &database.CreateEvidenceRequirementParams{
		ID:                  dbuuid.Must(),
		OrganizationID:      orgID,
		RitualDefinitionID:  ritualDefID,
		Name:                req.Name,
		Description:         pgtype.Text{String: req.Description, Valid: req.Description != ""},
		EvidenceTypes:       evidenceTypes,
		IsRequired:          req.IsRequired,
		ApprovalMode:        approvalModeToString(req.ApprovalMode),
		AutoApproveConfig:   autoApproveJSON,
		Position:            posResult,
		DeadlineOffsetHours: pgtype.Int4{Int32: req.DeadlineOffsetHours, Valid: req.DeadlineOffsetHours > 0},
		UpdatedAt:           pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create evidence requirement: %w", err)
	}

	return evidenceRequirementToProto(er), nil
}

// UpdateEvidenceRequirement performs a partial COALESCE update on an evidence requirement.
func (l *logicImpl) UpdateEvidenceRequirement(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.UpdateEvidenceRequirementRequest,
) (*rpcv1.EvidenceRequirementDetail, error) {
	erID := dbuuid.MustParse(req.EvidenceRequirementId)

	params := &database.UpdateEvidenceRequirementParams{
		OrganizationID: orgID,
		ID:             erID,
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}

	if req.Name != nil {
		params.Name = pgtype.Text{String: *req.Name, Valid: true}
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if len(req.EvidenceTypes) > 0 {
		evidenceTypes := make([]string, len(req.EvidenceTypes))
		for i, et := range req.EvidenceTypes {
			evidenceTypes[i] = evidenceTypeToString(et)
		}
		params.EvidenceTypes = evidenceTypes
	}
	if req.IsRequired != nil {
		params.IsRequired = pgtype.Bool{Bool: *req.IsRequired, Valid: true}
	}
	if req.ApprovalMode != nil {
		params.ApprovalMode = pgtype.Text{String: approvalModeToString(*req.ApprovalMode), Valid: true}
	}
	if req.AutoApproveConfig != nil {
		autoApproveJSON, err := marshalAutoApproveConfigProto(req.AutoApproveConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal auto approve config: %w", err)
		}
		params.AutoApproveConfig = autoApproveJSON
	}
	if req.DeadlineOffsetHours != nil {
		params.DeadlineOffsetHours = pgtype.Int4{Int32: *req.DeadlineOffsetHours, Valid: true}
	}

	er, err := l.Queries.UpdateEvidenceRequirement(ctx, tx, params)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrEvidenceRequirementNotFound
		}
		return nil, fmt.Errorf("failed to update evidence requirement: %w", err)
	}

	return evidenceRequirementToProto(er), nil
}

// DeleteEvidenceRequirement deletes an evidence requirement.
func (l *logicImpl) DeleteEvidenceRequirement(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	id dbuuid.UUID,
) error {
	err := l.Queries.DeleteEvidenceRequirement(ctx, tx, &database.DeleteEvidenceRequirementParams{
		OrganizationID: orgID,
		ID:             id,
	})
	if err != nil {
		return fmt.Errorf("failed to delete evidence requirement: %w", err)
	}
	return nil
}

// ListEvidenceRequirements lists evidence requirements for a ritual definition.
func (l *logicImpl) ListEvidenceRequirements(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	ritualDefID dbuuid.UUID,
) ([]*rpcv1.EvidenceRequirementDetail, error) {
	reqs, err := l.Queries.ListEvidenceRequirements(ctx, tx, &database.ListEvidenceRequirementsParams{
		OrganizationID:     orgID,
		RitualDefinitionID: ritualDefID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list evidence requirements: %w", err)
	}

	results := make([]*rpcv1.EvidenceRequirementDetail, len(reqs))
	for i, r := range reqs {
		results[i] = evidenceRequirementToProto(r)
	}
	return results, nil
}

// SubmitEvidence creates an evidence submission with auto-approval check.
func (l *logicImpl) SubmitEvidence(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.SubmitEvidenceRequest,
) (*rpcv1.EvidenceSubmission, error) {
	taskID := dbuuid.MustParse(req.TaskId)
	erID := dbuuid.MustParse(req.EvidenceRequirementId)

	// Get the evidence requirement for auto-approve check
	er, err := l.Queries.GetEvidenceRequirement(ctx, tx, &database.GetEvidenceRequirementParams{
		OrganizationID: orgID,
		ID:             erID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrEvidenceRequirementNotFound
		}
		return nil, fmt.Errorf("failed to get evidence requirement: %w", err)
	}

	approvalStatus := ApprovalStatusPendingReview

	// Check auto-approve
	if er.ApprovalMode == ApprovalModeAutoApprove {
		decision := evaluateAutoApprove(req, er.AutoApproveConfig)
		slog.DebugContext(ctx, "SubmitEvidence auto-approve evaluated",
			"taskID", taskID,
			"evidenceRequirementID", erID,
			"approved", decision.approved,
			"reason", decision.reason,
			"distanceMeters", decision.distanceMeters,
			"radiusMeters", decision.radiusMeters,
			"hasGpsCoordinates", req.GpsCoordinates != nil,
		)
		if decision.approved {
			approvalStatus = ApprovalStatusApproved
		}
	}

	// Parse GPS coordinates
	var gpsLat, gpsLon, gpsAccuracy pgtype.Numeric
	if req.GpsCoordinates != nil {
		_ = gpsLat.Scan(fmt.Sprintf("%f", req.GpsCoordinates.Latitude))
		_ = gpsLon.Scan(fmt.Sprintf("%f", req.GpsCoordinates.Longitude))
		_ = gpsAccuracy.Scan(fmt.Sprintf("%f", req.GpsCoordinates.AccuracyMeters))
	}

	var deviceTimestamp pgtype.Timestamptz
	if req.DeviceTimestamp != nil {
		deviceTimestamp = pgtype.Timestamptz{Time: req.DeviceTimestamp.AsTime(), Valid: true}
	}

	var fileID dbuuid.NullUUID
	if req.FileId != "" {
		fileID = dbuuid.UUIDToNullUUID(dbuuid.MustParse(req.FileId))
	}

	sub, err := l.Queries.CreateEvidenceSubmission(ctx, tx, &database.CreateEvidenceSubmissionParams{
		ID:                    dbuuid.Must(),
		OrganizationID:        orgID,
		TaskID:                taskID,
		EvidenceRequirementID: erID,
		SubmittedByEmployeeID: employeeID,
		EvidenceType:          evidenceTypeToString(req.EvidenceType),
		FileID:                fileID,
		TextContent:           pgtype.Text{String: req.TextContent, Valid: req.TextContent != ""},
		LinkUrl:               pgtype.Text{String: req.LinkUrl, Valid: req.LinkUrl != ""},
		DeviceTimestamp:       deviceTimestamp,
		ServerTimestamp:       pgtype.Timestamptz{Time: time.Now(), Valid: true},
		GpsLatitude:           gpsLat,
		GpsLongitude:          gpsLon,
		GpsAccuracyMeters:     gpsAccuracy,
		ApprovalStatus:        approvalStatus,
		UpdatedAt:             pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create evidence submission: %w", err)
	}

	if reconcileErr := l.reconcileRitualTaskState(ctx, tx, orgID, taskID); reconcileErr != nil {
		return nil, reconcileErr
	}

	if approvalStatus == ApprovalStatusPendingReview {
		l.notifyEvidenceSubmitted(ctx, tx, orgID, taskID, erID, employeeID, "")
	}

	return evidenceSubmissionToProto(sub), nil
}

// ApproveEvidence approves an evidence submission.
func (l *logicImpl) ApproveEvidence(
	ctx context.Context,
	tx database.DBTX,
	orgID, reviewerID dbuuid.UUID,
	req *rpcv1.ApproveEvidenceRequest,
) (*rpcv1.EvidenceSubmission, error) {
	submissionID := dbuuid.MustParse(req.GetEvidenceSubmissionId())
	comment := req.GetComment()

	sub, err := l.Queries.UpdateEvidenceSubmissionApproval(ctx, tx, &database.UpdateEvidenceSubmissionApprovalParams{
		OrganizationID:       orgID,
		ID:                   submissionID,
		ApprovalStatus:       ApprovalStatusApproved,
		ReviewedByEmployeeID: dbuuid.UUIDToNullUUID(reviewerID),
		ReviewedAt:           pgtype.Timestamptz{Time: time.Now(), Valid: true},
		ReviewerComment:      pgtype.Text{String: comment, Valid: comment != ""},
		UpdatedAt:            pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrEvidenceSubmissionNotFound
		}
		return nil, fmt.Errorf("failed to approve evidence: %w", err)
	}

	if reconcileErr := l.reconcileRitualTaskState(ctx, tx, orgID, sub.TaskID); reconcileErr != nil {
		return nil, reconcileErr
	}

	l.notifyEvidenceApproved(ctx, tx, orgID, sub.TaskID, reviewerID, "")

	return evidenceSubmissionToProto(sub), nil
}

// RejectEvidence rejects an evidence submission.
func (l *logicImpl) RejectEvidence(
	ctx context.Context,
	tx database.DBTX,
	orgID, reviewerID dbuuid.UUID,
	req *rpcv1.RejectEvidenceRequest,
) (*rpcv1.EvidenceSubmission, error) {
	submissionID := dbuuid.MustParse(req.GetEvidenceSubmissionId())
	comment := req.GetComment()

	sub, err := l.Queries.UpdateEvidenceSubmissionApproval(ctx, tx, &database.UpdateEvidenceSubmissionApprovalParams{
		OrganizationID:       orgID,
		ID:                   submissionID,
		ApprovalStatus:       ApprovalStatusRejected,
		ReviewedByEmployeeID: dbuuid.UUIDToNullUUID(reviewerID),
		ReviewedAt:           pgtype.Timestamptz{Time: time.Now(), Valid: true},
		ReviewerComment:      pgtype.Text{String: comment, Valid: comment != ""},
		UpdatedAt:            pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrEvidenceSubmissionNotFound
		}
		return nil, fmt.Errorf("failed to reject evidence: %w", err)
	}

	if reconcileErr := l.reconcileRitualTaskState(ctx, tx, orgID, sub.TaskID); reconcileErr != nil {
		return nil, reconcileErr
	}

	l.notifyEvidenceRejected(ctx, tx, orgID, sub.TaskID, reviewerID, "")

	return evidenceSubmissionToProto(sub), nil
}

// ListEvidenceSubmissions lists evidence submissions for a task.
func (l *logicImpl) ListEvidenceSubmissions(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	taskID dbuuid.UUID,
) ([]*rpcv1.EvidenceSubmission, error) {
	subs, err := l.Queries.ListEvidenceSubmissions(ctx, tx, &database.ListEvidenceSubmissionsParams{
		OrganizationID: orgID,
		TaskID:         taskID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list evidence submissions: %w", err)
	}

	results := make([]*rpcv1.EvidenceSubmission, len(subs))
	for i, s := range subs {
		results[i] = evidenceSubmissionToProto(s)
	}
	return results, nil
}

// ============================================================================
// Helper Functions — Evidence
// ============================================================================

func checkAutoApprove(req *rpcv1.SubmitEvidenceRequest, configJSON []byte) bool {
	return evaluateAutoApprove(req, configJSON).approved
}

type autoApproveDecision struct {
	approved       bool
	reason         string
	distanceMeters float64
	radiusMeters   int32
}

func evaluateAutoApprove(req *rpcv1.SubmitEvidenceRequest, configJSON []byte) autoApproveDecision {
	if len(configJSON) == 0 || req.GpsCoordinates == nil {
		if len(configJSON) == 0 {
			return autoApproveDecision{reason: "missing_auto_approve_config"}
		}
		return autoApproveDecision{reason: "missing_gps_coordinates"}
	}

	config := parseAutoApproveConfigProto(configJSON)
	if config == nil || config.GpsTarget == nil {
		if config == nil {
			return autoApproveDecision{reason: "invalid_auto_approve_config"}
		}
		return autoApproveDecision{reason: "missing_gps_target"}
	}

	distance := haversineDistance(
		req.GpsCoordinates.Latitude, req.GpsCoordinates.Longitude,
		config.GpsTarget.Latitude, config.GpsTarget.Longitude,
	)

	approved := distance <= float64(config.GpsRadiusMeters)
	reason := "outside_geofence"
	if approved {
		reason = "within_geofence"
	}

	return autoApproveDecision{
		approved:       approved,
		reason:         reason,
		distanceMeters: distance,
		radiusMeters:   config.GpsRadiusMeters,
	}
}

func haversineDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusMeters = 6371000.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusMeters * c
}

func evidenceSubmissionToProto(s *database.CollaborationEvidenceSubmission) *rpcv1.EvidenceSubmission {
	sub := &rpcv1.EvidenceSubmission{
		Id:                    s.ID.String(),
		TaskId:                s.TaskID.String(),
		EvidenceRequirementId: s.EvidenceRequirementID.String(),
		SubmittedByEmployeeId: s.SubmittedByEmployeeID.String(),
		EvidenceType:          stringToEvidenceTypeProto(s.EvidenceType),
		ApprovalStatus:        stringToApprovalStatusProto(s.ApprovalStatus),
	}

	if s.FileID.Valid {
		sub.FileId = s.FileID.UUID.String()
	}
	if s.TextContent.Valid {
		sub.TextContent = s.TextContent.String
	}
	if s.LinkUrl.Valid {
		sub.LinkUrl = s.LinkUrl.String
	}
	if s.DeviceTimestamp.Valid {
		sub.DeviceTimestamp = timestamppb.New(s.DeviceTimestamp.Time)
	}
	if s.ServerTimestamp.Valid {
		sub.ServerTimestamp = timestamppb.New(s.ServerTimestamp.Time)
	}
	if s.GpsLatitude.Valid && s.GpsLongitude.Valid {
		lat, latOK := numericToFloat64(s.GpsLatitude)
		lon, lonOK := numericToFloat64(s.GpsLongitude)
		if latOK && lonOK {
			acc, _ := numericToFloat64(s.GpsAccuracyMeters)
			sub.GpsCoordinates = &rpcv1.GpsCoordinates{
				Latitude:       lat,
				Longitude:      lon,
				AccuracyMeters: acc,
			}
		}
	}
	if s.ReviewedByEmployeeID.Valid {
		sub.ReviewedByEmployeeId = s.ReviewedByEmployeeID.UUID.String()
	}
	if s.ReviewedAt.Valid {
		sub.ReviewedAt = timestamppb.New(s.ReviewedAt.Time)
	}
	if s.ReviewerComment.Valid {
		sub.ReviewerComment = s.ReviewerComment.String
	}

	return sub
}

func numericToFloat64(value pgtype.Numeric) (float64, bool) {
	if !value.Valid {
		return 0, false
	}

	floatValue, err := value.Float64Value()
	if err != nil || !floatValue.Valid {
		return 0, false
	}

	return floatValue.Float64, true
}
