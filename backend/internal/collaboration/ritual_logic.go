package collaboration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// CreateRitualDefinition creates a ritual definition with assignees and evidence requirements.
func (l *logicImpl) CreateRitualDefinition(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.CreateRitualDefinitionRequest,
) (*rpcv1.RitualDefinition, error) {
	slog.DebugContext(ctx, "CreateRitualDefinition",
		"projectID", req.ProjectId,
		"name", req.Name,
	)

	projectID := dbuuid.MustParse(req.ProjectId)

	// Check project role: only admin or owner can manage ritual definitions
	role, err := l.GetProjectMemberRole(ctx, tx, orgID, projectID, employeeID)
	if err != nil || (role != ProjectMemberRoleAdmin && role != ProjectMemberRoleOwner) {
		return nil, ErrAccessDenied
	}

	recurrenceJSON, err := json.Marshal(recurrenceRuleToMap(req.RecurrenceRule))
	if err != nil {
		return nil, fmt.Errorf("failed to marshal recurrence rule: %w", err)
	}

	now := time.Now()
	defID := dbuuid.Must()
	def, err := l.Queries.CreateRitualDefinition(ctx, tx, &database.CreateRitualDefinitionParams{
		ID:                    defID,
		OrganizationID:        orgID,
		ProjectID:             projectID,
		Name:                  req.Name,
		Description:           pgtype.Text{String: req.Description, Valid: req.Description != ""},
		RecurrenceRule:        recurrenceJSON,
		CompletionWindowHours: req.CompletionWindowHours,
		Timezone:              req.Timezone,
		CreatedByEmployeeID:   employeeID,
		GenerationWindowDays:  30,
		UpdatedAt:             pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create ritual definition: %w", err)
	}

	// Create individual assignees
	for _, assigneeIDStr := range req.DefaultAssigneeIds {
		assigneeID := dbuuid.MustParse(assigneeIDStr)
		_, err := l.Queries.CreateRitualDefinitionAssignee(ctx, tx, &database.CreateRitualDefinitionAssigneeParams{
			ID:                 dbuuid.Must(),
			OrganizationID:     orgID,
			RitualDefinitionID: defID,
			EmployeeID:         assigneeID,
			UpdatedAt:          pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to create ritual definition assignee",
				"error", err,
				"assigneeID", assigneeIDStr,
			)
		}
	}

	// Create department pool entries
	var poolProtos []*rpcv1.RitualDepartmentPool
	for _, poolReq := range req.DefaultDepartmentPools {
		deptID := dbuuid.MustParse(poolReq.DepartmentId)
		pool, err := l.Queries.UpsertRitualDefinitionDepartmentPool(ctx, tx, &database.UpsertRitualDefinitionDepartmentPoolParams{
			ID:                 dbuuid.Must(),
			OrganizationID:     orgID,
			RitualDefinitionID: defID,
			DepartmentID:       deptID,
			AssignmentStrategy: poolReq.AssignmentStrategy,
			UpdatedAt:          pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to create department pool", "error", err)
			continue
		}
		poolProtos = append(poolProtos, &rpcv1.RitualDepartmentPool{
			Id:                 pool.ID.String(),
			DepartmentId:       pool.DepartmentID.String(),
			AssignmentStrategy: pool.AssignmentStrategy,
		})
	}

	// Create evidence requirements
	var evidenceReqs []*rpcv1.EvidenceRequirementDetail
	for i, erReq := range req.EvidenceRequirements {
		autoApproveJSON, err := marshalAutoApproveConfigProto(erReq.AutoApproveConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal auto approve config: %w", err)
		}
		evidenceTypes := make([]string, len(erReq.EvidenceTypes))
		for j, et := range erReq.EvidenceTypes {
			evidenceTypes[j] = evidenceTypeToString(et)
		}

		er, err := l.Queries.CreateEvidenceRequirement(ctx, tx, &database.CreateEvidenceRequirementParams{
			ID:                  dbuuid.Must(),
			OrganizationID:      orgID,
			RitualDefinitionID:  defID,
			Name:                erReq.Name,
			Description:         pgtype.Text{String: erReq.Description, Valid: erReq.Description != ""},
			EvidenceTypes:       evidenceTypes,
			IsRequired:          erReq.IsRequired,
			ApprovalMode:        approvalModeToString(erReq.ApprovalMode),
			AutoApproveConfig:   autoApproveJSON,
			Position:            int32(i),
			DeadlineOffsetHours: pgtype.Int4{Int32: erReq.DeadlineOffsetHours, Valid: erReq.DeadlineOffsetHours > 0},
			UpdatedAt:           pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create evidence requirement: %w", err)
		}
		evidenceReqs = append(evidenceReqs, evidenceRequirementToProto(er))
	}

	return assembleRitualDefinition(def, req.DefaultAssigneeIds, evidenceReqs, poolProtos), nil
}

// GetRitualDefinition retrieves a ritual definition with its assignees and evidence requirements.
func (l *logicImpl) GetRitualDefinition(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	id dbuuid.UUID,
) (*rpcv1.RitualDefinition, error) {
	def, err := l.Queries.GetRitualDefinition(ctx, tx, &database.GetRitualDefinitionParams{
		OrganizationID: orgID,
		ID:             id,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrRitualDefinitionNotFound
		}
		return nil, fmt.Errorf("failed to get ritual definition: %w", err)
	}

	assignees, err := l.Queries.ListRitualDefinitionAssignees(ctx, tx, &database.ListRitualDefinitionAssigneesParams{
		OrganizationID:     orgID,
		RitualDefinitionID: id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list assignees: %w", err)
	}

	assigneeIDs := make([]string, len(assignees))
	for i, a := range assignees {
		assigneeIDs[i] = a.EmployeeID.String()
	}

	reqs, err := l.Queries.ListEvidenceRequirements(ctx, tx, &database.ListEvidenceRequirementsParams{
		OrganizationID:     orgID,
		RitualDefinitionID: id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list evidence requirements: %w", err)
	}

	evidenceReqs := make([]*rpcv1.EvidenceRequirementDetail, len(reqs))
	for i, r := range reqs {
		evidenceReqs[i] = evidenceRequirementToProto(r)
	}

	poolProtos := l.listDepartmentPoolsProto(ctx, tx, orgID, id)

	return assembleRitualDefinition(def, assigneeIDs, evidenceReqs, poolProtos), nil
}

// UpdateRitualDefinition performs a partial COALESCE update on a ritual definition.
func (l *logicImpl) UpdateRitualDefinition(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.UpdateRitualDefinitionRequest,
) (*rpcv1.RitualDefinition, error) {
	defID := dbuuid.MustParse(req.RitualDefinitionId)

	params := &database.UpdateRitualDefinitionParams{
		OrganizationID: orgID,
		ID:             defID,
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}

	if req.Name != nil {
		params.Name = pgtype.Text{String: *req.Name, Valid: true}
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.RecurrenceRule != nil {
		ruleJSON, err := json.Marshal(recurrenceRuleToMap(req.RecurrenceRule))
		if err != nil {
			return nil, fmt.Errorf("failed to marshal recurrence rule: %w", err)
		}
		params.RecurrenceRule = ruleJSON
	}
	if req.CompletionWindowHours != nil {
		params.CompletionWindowHours = pgtype.Int4{Int32: *req.CompletionWindowHours, Valid: true}
	}
	if req.Timezone != nil {
		params.Timezone = pgtype.Text{String: *req.Timezone, Valid: true}
	}

	_, err := l.Queries.UpdateRitualDefinition(ctx, tx, params)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrRitualDefinitionNotFound
		}
		return nil, fmt.Errorf("failed to update ritual definition: %w", err)
	}

	// Sync individual assignees: always replace the full list
	err = l.Queries.DeleteAllRitualDefinitionAssignees(ctx, tx, &database.DeleteAllRitualDefinitionAssigneesParams{
		OrganizationID:     orgID,
		RitualDefinitionID: defID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to delete old assignees: %w", err)
	}
	for _, assigneeIDStr := range req.DefaultAssigneeIds {
		assigneeID := dbuuid.MustParse(assigneeIDStr)
		_, err := l.Queries.CreateRitualDefinitionAssignee(ctx, tx, &database.CreateRitualDefinitionAssigneeParams{
			ID:                 dbuuid.Must(),
			OrganizationID:     orgID,
			RitualDefinitionID: defID,
			EmployeeID:         assigneeID,
			UpdatedAt:          pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to re-create assignee", "error", err)
		}
	}

	// Sync department pools: always replace the full list
	if err := l.Queries.DeleteAllRitualDefinitionDepartmentPools(ctx, tx, &database.DeleteAllRitualDefinitionDepartmentPoolsParams{
		OrganizationID:     orgID,
		RitualDefinitionID: defID,
	}); err != nil {
		return nil, fmt.Errorf("failed to delete old department pools: %w", err)
	}
	now := time.Now()
	for _, poolReq := range req.DefaultDepartmentPools {
		deptID := dbuuid.MustParse(poolReq.DepartmentId)
		_, err := l.Queries.UpsertRitualDefinitionDepartmentPool(ctx, tx, &database.UpsertRitualDefinitionDepartmentPoolParams{
			ID:                 dbuuid.Must(),
			OrganizationID:     orgID,
			RitualDefinitionID: defID,
			DepartmentID:       deptID,
			AssignmentStrategy: poolReq.AssignmentStrategy,
			UpdatedAt:          pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to upsert department pool", "error", err)
		}
	}

	return l.GetRitualDefinition(ctx, tx, orgID, defID)
}

// ArchiveRitualDefinition archives or unarchives a ritual definition.
// When archiving, also soft-deletes pending (scheduled/todo) ritual instances.
func (l *logicImpl) ArchiveRitualDefinition(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	id dbuuid.UUID,
	archive bool,
) (*rpcv1.RitualDefinition, error) {
	_, err := l.Queries.ArchiveRitualDefinition(ctx, tx, &database.ArchiveRitualDefinitionParams{
		OrganizationID: orgID,
		ID:             id,
		IsArchived:     archive,
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrRitualDefinitionNotFound
		}
		return nil, fmt.Errorf("failed to archive ritual definition: %w", err)
	}

	// When archiving, soft-delete pending (scheduled/todo) instances
	if archive {
		if err := l.Queries.SoftDeletePendingRitualInstances(ctx, tx, &database.SoftDeletePendingRitualInstancesParams{
			OrganizationID:     orgID,
			RitualDefinitionID: dbuuid.UUIDToNullUUID(id),
		}); err != nil {
			slog.WarnContext(ctx, "failed to soft-delete pending ritual instances", "error", err)
		}
	}

	return l.GetRitualDefinition(ctx, tx, orgID, id)
}

// ListRitualDefinitions lists ritual definitions for a project.
func (l *logicImpl) ListRitualDefinitions(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
	includeArchived bool,
) ([]*rpcv1.RitualDefinition, error) {
	defs, err := l.Queries.ListRitualDefinitions(ctx, tx, &database.ListRitualDefinitionsParams{
		OrganizationID:  orgID,
		ProjectID:       projectID,
		IncludeArchived: includeArchived,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list ritual definitions: %w", err)
	}

	results := make([]*rpcv1.RitualDefinition, len(defs))
	for i, def := range defs {
		defID := dbuuid.UUID(def.ID)

		assignees, _ := l.Queries.ListRitualDefinitionAssignees(ctx, tx, &database.ListRitualDefinitionAssigneesParams{
			OrganizationID:     orgID,
			RitualDefinitionID: defID,
		})
		assigneeIDs := make([]string, len(assignees))
		for j, a := range assignees {
			assigneeIDs[j] = a.EmployeeID.String()
		}

		reqs, _ := l.Queries.ListEvidenceRequirements(ctx, tx, &database.ListEvidenceRequirementsParams{
			OrganizationID:     orgID,
			RitualDefinitionID: defID,
		})
		evidenceReqs := make([]*rpcv1.EvidenceRequirementDetail, len(reqs))
		for j, r := range reqs {
			evidenceReqs[j] = evidenceRequirementToProto(r)
		}

		poolProtos := l.listDepartmentPoolsProto(ctx, tx, orgID, defID)
		results[i] = assembleRitualDefinition(def, assigneeIDs, evidenceReqs, poolProtos)
	}

	return results, nil
}

// ============================================================================
// Schedule Change Operations
// ============================================================================

// GetScheduleChangeImpact returns a read-only preview of how a recurrence change
// would affect future instances (untouched → remove, touched → detach, new → create).
func (l *logicImpl) GetScheduleChangeImpact(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.GetScheduleChangeImpactRequest,
) (*rpcv1.GetScheduleChangeImpactResponse, error) {
	defID := dbuuid.MustParse(req.RitualDefinitionId)

	def, err := l.Queries.GetRitualDefinition(ctx, tx, &database.GetRitualDefinitionParams{
		OrganizationID: orgID,
		ID:             defID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrRitualDefinitionNotFound
		}
		return nil, fmt.Errorf("failed to get ritual definition: %w", err)
	}

	// Authorization: must be creator or project admin/owner
	if err := l.authorizeScheduleChange(ctx, tx, orgID, employeeID, def); err != nil {
		return nil, err
	}

	// Validate new recurrence rule
	if req.NewRecurrenceRule == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("new_recurrence_rule is required"))
	}

	loc := loadTimezone(def.Timezone)
	todayCutoff := time.Now().In(loc).Truncate(24 * time.Hour)
	todayDate := pgtype.Date{Time: todayCutoff, Valid: true}

	// Load future instances and classify in Go — same logic used by ChangeRitualDefinitionSchedule.
	impact, err := l.loadAndClassifyFutureInstances(ctx, tx, orgID, defID, todayDate)
	if err != nil {
		return nil, err
	}

	// Estimate new instances using the proposed rule.
	newRuleJSON, err := json.Marshal(recurrenceRuleToMap(req.NewRecurrenceRule))
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid recurrence rule: %w", err))
	}
	newRule, err := parseRecurrenceRule(newRuleJSON)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid recurrence rule: %w", err))
	}

	yesterday := todayCutoff.AddDate(0, 0, -1)
	newDates := computeDatesInWindow(newRule, yesterday, int(def.GenerationWindowDays), loc, time.Now())

	return &rpcv1.GetScheduleChangeImpactResponse{
		InstancesToRemove: int32(len(impact.Untouched)),
		InstancesToDetach: int32(len(impact.Touched)),
		InstancesToCreate: int32(len(newDates)),
	}, nil
}

// ChangeRitualDefinitionSchedule atomically applies a recurrence pattern change:
// 1. Soft-deletes untouched future instances
// 2. Detaches touched future instances as standalone tasks
// 3. Updates recurrence rule + increments schedule_version
// 4. Regenerates new instances on the new pattern
func (l *logicImpl) ChangeRitualDefinitionSchedule(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.ChangeRitualDefinitionScheduleRequest,
) (*rpcv1.ChangeRitualDefinitionScheduleResponse, error) {
	if !req.Confirmed {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("schedule change must be confirmed"))
	}

	defID := dbuuid.MustParse(req.RitualDefinitionId)

	def, err := l.Queries.GetRitualDefinition(ctx, tx, &database.GetRitualDefinitionParams{
		OrganizationID: orgID,
		ID:             defID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrRitualDefinitionNotFound
		}
		return nil, fmt.Errorf("failed to get ritual definition: %w", err)
	}

	// Authorization: must be creator or project admin/owner
	if err := l.authorizeScheduleChange(ctx, tx, orgID, employeeID, def); err != nil {
		return nil, err
	}

	// Validate new recurrence rule
	if req.NewRecurrenceRule == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("new_recurrence_rule is required"))
	}

	newRuleJSON, err := json.Marshal(recurrenceRuleToMap(req.NewRecurrenceRule))
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid recurrence rule: %w", err))
	}

	// No-op check: if the new rule is identical to the current one, skip all cleanup and regeneration.
	existingRuleJSON, err := json.Marshal(recurrenceRuleToMap(parseRecurrenceRuleProto(def.RecurrenceRule)))
	if err == nil && bytes.Equal(existingRuleJSON, newRuleJSON) {
		slog.DebugContext(ctx, "ChangeRitualDefinitionSchedule: new rule identical to existing, no-op", "defID", defID)
		defProto := l.assembleRitualDefinitionFromRow(ctx, tx, orgID, def)
		return &rpcv1.ChangeRitualDefinitionScheduleResponse{
			RitualDefinition:  defProto,
			InstancesRemoved:  0,
			InstancesDetached: 0,
			InstancesCreated:  0,
		}, nil
	}

	loc := loadTimezone(def.Timezone)
	todayCutoff := time.Now().In(loc).Truncate(24 * time.Hour)
	todayDate := pgtype.Date{Time: todayCutoff, Valid: true}

	// Load future instances and classify using the same Go logic as GetScheduleChangeImpact,
	// so the impact preview the user confirmed exactly matches what gets executed.
	impact, err := l.loadAndClassifyFutureInstances(ctx, tx, orgID, defID, todayDate)
	if err != nil {
		return nil, err
	}

	// Step 1: Soft-delete untouched future instances by ID list.
	removedRows, err := l.Queries.SoftDeleteTasksByIDs(ctx, tx, &database.SoftDeleteTasksByIDsParams{
		OrganizationID: orgID,
		Ids:            impact.Untouched,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to soft-delete untouched instances: %w", err)
	}

	// Step 2: Detach touched future instances by ID list.
	detachedRows, err := l.Queries.DetachRitualInstancesByIDs(ctx, tx, &database.DetachRitualInstancesByIDsParams{
		OrganizationID: orgID,
		Ids:            impact.Touched,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to detach touched instances: %w", err)
	}

	// Step 3: Update recurrence rule + increment schedule_version + reset waterline
	yesterday := todayCutoff.AddDate(0, 0, -1)
	updatedDef, err := l.Queries.UpdateRitualDefinitionSchedule(ctx, tx, &database.UpdateRitualDefinitionScheduleParams{
		OrganizationID:     orgID,
		ID:                 defID,
		RecurrenceRule:     newRuleJSON,
		WaterlineResetDate: pgtype.Date{Time: yesterday, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to update ritual definition schedule: %w", err)
	}

	// Step 4: Regenerate instances using the new pattern
	created, err := l.GenerateRitualInstances(ctx, tx, orgID, time.Now())
	if err != nil {
		slog.WarnContext(ctx, "ChangeRitualDefinitionSchedule: failed to regenerate instances",
			"error", err, "defID", defID)
	}

	// Assemble response
	defProto := l.assembleRitualDefinitionFromRow(ctx, tx, orgID, updatedDef)

	return &rpcv1.ChangeRitualDefinitionScheduleResponse{
		RitualDefinition:  defProto,
		InstancesRemoved:  int32(removedRows),
		InstancesDetached: int32(detachedRows),
		InstancesCreated:  int32(created),
	}, nil
}

// authorizeScheduleChange checks that the employee is the definition creator or a project admin/owner.
func (l *logicImpl) authorizeScheduleChange(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	def *database.CollaborationRitualDefinition,
) error {
	isCreator := dbuuid.UUID(def.CreatedByEmployeeID) == employeeID
	if isCreator {
		return nil
	}
	role, err := l.GetProjectMemberRole(ctx, tx, orgID, dbuuid.UUID(def.ProjectID), employeeID)
	if err != nil {
		return ErrAccessDenied
	}
	if role != ProjectMemberRoleAdmin && role != ProjectMemberRoleOwner {
		return ErrAccessDenied
	}
	return nil
}

// loadAndClassifyFutureInstances fetches all future (non-deleted) ritual instances for a
// definition beyond todayCutoff and classifies them into untouched vs. touched buckets
// using the canonical Go-level isUntouched predicate.
// This is the shared entry point used by both GetScheduleChangeImpact (preview) and
// ChangeRitualDefinitionSchedule (execution) to guarantee the two are consistent.
func (l *logicImpl) loadAndClassifyFutureInstances(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	defID dbuuid.UUID,
	todayCutoff pgtype.Date,
) (scheduleChangeImpact, error) {
	rows, err := l.Queries.ListFutureRitualInstancesForClassification(ctx, tx, &database.ListFutureRitualInstancesForClassificationParams{
		OrganizationID:     orgID,
		RitualDefinitionID: dbuuid.UUIDToNullUUID(defID),
		TodayCutoff:        todayCutoff,
	})
	if err != nil {
		return scheduleChangeImpact{}, fmt.Errorf("failed to list future ritual instances: %w", err)
	}
	inputs := make([]ritualInstanceInput, len(rows))
	for i, row := range rows {
		inputs[i] = ritualInstanceInput{
			TaskID:         dbuuid.UUID(row.ID),
			CommentCount:   row.CommentCount,
			IsInitialState: row.IsInitialState,
			HasEvidence:    row.HasEvidence,
			HasChannel:     row.HasChannel,
		}
	}
	return classifyScheduleChangeImpact(inputs), nil
}

// assembleRitualDefinitionFromRow assembles a proto from a DB row, loading assignees and evidence reqs.
func (l *logicImpl) assembleRitualDefinitionFromRow(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	def *database.CollaborationRitualDefinition,
) *rpcv1.RitualDefinition {
	defID := dbuuid.UUID(def.ID)

	assignees, _ := l.Queries.ListRitualDefinitionAssignees(ctx, tx, &database.ListRitualDefinitionAssigneesParams{
		OrganizationID:     orgID,
		RitualDefinitionID: defID,
	})
	assigneeIDs := make([]string, len(assignees))
	for i, a := range assignees {
		assigneeIDs[i] = a.EmployeeID.String()
	}

	reqs, _ := l.Queries.ListEvidenceRequirements(ctx, tx, &database.ListEvidenceRequirementsParams{
		OrganizationID:     orgID,
		RitualDefinitionID: defID,
	})
	evidenceReqs := make([]*rpcv1.EvidenceRequirementDetail, len(reqs))
	for i, r := range reqs {
		evidenceReqs[i] = evidenceRequirementToProto(r)
	}

	poolProtos := l.listDepartmentPoolsProto(ctx, tx, orgID, defID)
	return assembleRitualDefinition(def, assigneeIDs, evidenceReqs, poolProtos)
}

// ============================================================================
// Helper Functions — Ritual
// ============================================================================

// listDepartmentPoolsProto loads department pools for a ritual definition and converts to proto.
func (l *logicImpl) listDepartmentPoolsProto(
	ctx context.Context,
	tx database.DBTX,
	orgID, defID dbuuid.UUID,
) []*rpcv1.RitualDepartmentPool {
	pools, err := l.Queries.ListRitualDefinitionDepartmentPools(ctx, tx, &database.ListRitualDefinitionDepartmentPoolsParams{
		OrganizationID:     orgID,
		RitualDefinitionID: defID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to list department pools", "error", err)
		return nil
	}
	protos := make([]*rpcv1.RitualDepartmentPool, len(pools))
	for i, p := range pools {
		proto := &rpcv1.RitualDepartmentPool{
			Id:                 p.ID.String(),
			DepartmentId:       p.DepartmentID.String(),
			DepartmentName:     p.DepartmentName,
			AssignmentStrategy: p.AssignmentStrategy,
		}
		if p.LastAssignedEmployeeID.Valid {
			proto.LastAssignedEmployeeId = dbuuid.UUID(p.LastAssignedEmployeeID.UUID).String()
		}
		protos[i] = proto
	}
	return protos
}

func assembleRitualDefinition(
	def *database.CollaborationRitualDefinition,
	assigneeIDs []string,
	evidenceReqs []*rpcv1.EvidenceRequirementDetail,
	pools []*rpcv1.RitualDepartmentPool,
) *rpcv1.RitualDefinition {
	rd := &rpcv1.RitualDefinition{
		Id:                     def.ID.String(),
		ProjectId:              def.ProjectID.String(),
		Name:                   def.Name,
		Description:            def.Description.String,
		CompletionWindowHours:  def.CompletionWindowHours,
		Timezone:               def.Timezone,
		IsArchived:             def.IsArchived,
		CreatedByEmployeeId:    def.CreatedByEmployeeID.String(),
		DefaultAssigneeIds:     assigneeIDs,
		EvidenceRequirements:   evidenceReqs,
		DefaultDepartmentPools: pools,
		UpdatedAt:              timestamppb.New(def.UpdatedAt.Time),
	}

	rd.ScheduleVersion = def.ScheduleVersion

	// Parse recurrence rule from JSON
	if len(def.RecurrenceRule) > 0 {
		rd.RecurrenceRule = parseRecurrenceRuleProto(def.RecurrenceRule)
	}

	return rd
}

func evidenceRequirementToProto(r *database.CollaborationEvidenceRequirement) *rpcv1.EvidenceRequirementDetail {
	er := &rpcv1.EvidenceRequirementDetail{
		Id:                  r.ID.String(),
		RitualDefinitionId:  r.RitualDefinitionID.String(),
		Name:                r.Name,
		Description:         r.Description.String,
		IsRequired:          r.IsRequired,
		ApprovalMode:        stringToApprovalModeProto(r.ApprovalMode),
		Position:            r.Position,
		DeadlineOffsetHours: r.DeadlineOffsetHours.Int32,
	}

	for _, et := range r.EvidenceTypes {
		er.EvidenceTypes = append(er.EvidenceTypes, stringToEvidenceTypeProto(et))
	}

	if len(r.AutoApproveConfig) > 0 {
		er.AutoApproveConfig = parseAutoApproveConfigProto(r.AutoApproveConfig)
	}

	return er
}

func recurrenceRuleToMap(r *rpcv1.RecurrenceRule) map[string]interface{} {
	if r == nil {
		return map[string]interface{}{}
	}
	m := map[string]interface{}{
		"type":     recurrenceTypeToString(r.Type),
		"interval": r.Interval,
	}
	if len(r.DaysOfWeek) > 0 {
		m["days_of_week"] = r.DaysOfWeek
	}
	if r.DayOfMonth > 0 {
		m["day_of_month"] = r.DayOfMonth
	}
	if r.NthWeekday != nil {
		m["nth_weekday"] = map[string]interface{}{
			"week": r.NthWeekday.Week,
			"day":  r.NthWeekday.Day,
		}
	}
	if r.TimeOfDay != "" {
		m["time_of_day"] = r.TimeOfDay
	}
	return m
}

func parseRecurrenceRuleProto(data []byte) *rpcv1.RecurrenceRule {
	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		return nil
	}
	r := &rpcv1.RecurrenceRule{}
	if t, ok := m["type"].(string); ok {
		r.Type = stringToRecurrenceTypeProto(t)
	}
	if v, ok := m["interval"].(float64); ok {
		r.Interval = int32(v)
	}
	if dow, ok := m["days_of_week"].([]interface{}); ok {
		for _, d := range dow {
			if v, ok := d.(float64); ok {
				r.DaysOfWeek = append(r.DaysOfWeek, int32(v))
			}
		}
	}
	if v, ok := m["day_of_month"].(float64); ok {
		r.DayOfMonth = int32(v)
	}
	if nw, ok := m["nth_weekday"].(map[string]interface{}); ok {
		r.NthWeekday = &rpcv1.NthWeekday{}
		if v, ok := nw["week"].(float64); ok {
			r.NthWeekday.Week = int32(v)
		}
		if v, ok := nw["day"].(float64); ok {
			r.NthWeekday.Day = int32(v)
		}
	}
	if v, ok := m["time_of_day"].(string); ok {
		r.TimeOfDay = v
	}
	return r
}

func marshalAutoApproveConfigProto(c *rpcv1.AutoApproveConfig) ([]byte, error) {
	if c == nil {
		return nil, nil
	}
	return (protojson.MarshalOptions{UseProtoNames: true}).Marshal(c)
}

func parseAutoApproveConfigProto(data []byte) *rpcv1.AutoApproveConfig {
	if len(data) == 0 {
		return nil
	}
	c := &rpcv1.AutoApproveConfig{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(data, c); err != nil {
		return nil
	}
	return c
}

func evidenceTypeToString(t rpcv1.EvidenceType) string {
	switch t {
	case rpcv1.EvidenceType_EVIDENCE_TYPE_PHOTO:
		return EvidenceTypePhoto
	case rpcv1.EvidenceType_EVIDENCE_TYPE_VOICE_MEMO:
		return EvidenceTypeVoiceMemo
	case rpcv1.EvidenceType_EVIDENCE_TYPE_PDF:
		return EvidenceTypePDF
	case rpcv1.EvidenceType_EVIDENCE_TYPE_FILE:
		return EvidenceTypeFile
	case rpcv1.EvidenceType_EVIDENCE_TYPE_LINK:
		return EvidenceTypeLink
	case rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE:
		return EvidenceTypeTextNote
	case rpcv1.EvidenceType_EVIDENCE_TYPE_GPS_CHECKIN:
		return EvidenceTypeGPSCheckin
	default:
		return EvidenceTypeFile
	}
}

func stringToEvidenceTypeProto(s string) rpcv1.EvidenceType {
	switch s {
	case EvidenceTypePhoto:
		return rpcv1.EvidenceType_EVIDENCE_TYPE_PHOTO
	case EvidenceTypeVoiceMemo:
		return rpcv1.EvidenceType_EVIDENCE_TYPE_VOICE_MEMO
	case EvidenceTypePDF:
		return rpcv1.EvidenceType_EVIDENCE_TYPE_PDF
	case EvidenceTypeFile:
		return rpcv1.EvidenceType_EVIDENCE_TYPE_FILE
	case EvidenceTypeLink:
		return rpcv1.EvidenceType_EVIDENCE_TYPE_LINK
	case EvidenceTypeTextNote:
		return rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE
	case EvidenceTypeGPSCheckin:
		return rpcv1.EvidenceType_EVIDENCE_TYPE_GPS_CHECKIN
	default:
		return rpcv1.EvidenceType_EVIDENCE_TYPE_UNSPECIFIED
	}
}

func approvalModeToString(m rpcv1.ApprovalMode) string {
	switch m {
	case rpcv1.ApprovalMode_APPROVAL_MODE_AUTO_APPROVE:
		return ApprovalModeAutoApprove
	default:
		return ApprovalModeManual
	}
}

func stringToApprovalModeProto(s string) rpcv1.ApprovalMode {
	switch s {
	case ApprovalModeAutoApprove:
		return rpcv1.ApprovalMode_APPROVAL_MODE_AUTO_APPROVE
	default:
		return rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL
	}
}

func stringToApprovalStatusProto(s string) rpcv1.ApprovalStatus {
	switch s {
	case ApprovalStatusApproved:
		return rpcv1.ApprovalStatus_APPROVAL_STATUS_APPROVED
	case ApprovalStatusRejected:
		return rpcv1.ApprovalStatus_APPROVAL_STATUS_REJECTED
	case ApprovalStatusPendingReview:
		return rpcv1.ApprovalStatus_APPROVAL_STATUS_PENDING_REVIEW
	default:
		return rpcv1.ApprovalStatus_APPROVAL_STATUS_UNSPECIFIED
	}
}

func recurrenceTypeToString(t rpcv1.RecurrenceType) string {
	switch t {
	case rpcv1.RecurrenceType_RECURRENCE_TYPE_DAILY:
		return RecurrenceTypeDaily
	case rpcv1.RecurrenceType_RECURRENCE_TYPE_WEEKLY:
		return RecurrenceTypeWeekly
	case rpcv1.RecurrenceType_RECURRENCE_TYPE_MONTHLY:
		return RecurrenceTypeMonthly
	case rpcv1.RecurrenceType_RECURRENCE_TYPE_CUSTOM_INTERVAL:
		return RecurrenceTypeCustomInterval
	default:
		return RecurrenceTypeDaily
	}
}

func stringToRecurrenceTypeProto(s string) rpcv1.RecurrenceType {
	switch s {
	case RecurrenceTypeDaily:
		return rpcv1.RecurrenceType_RECURRENCE_TYPE_DAILY
	case RecurrenceTypeWeekly:
		return rpcv1.RecurrenceType_RECURRENCE_TYPE_WEEKLY
	case RecurrenceTypeMonthly:
		return rpcv1.RecurrenceType_RECURRENCE_TYPE_MONTHLY
	case RecurrenceTypeCustomInterval:
		return rpcv1.RecurrenceType_RECURRENCE_TYPE_CUSTOM_INTERVAL
	default:
		return rpcv1.RecurrenceType_RECURRENCE_TYPE_UNSPECIFIED
	}
}
