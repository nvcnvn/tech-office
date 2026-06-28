package collaboration

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// CreateCustomField creates a new custom field definition for a project
func (l *logicImpl) CreateCustomField(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.CreateCustomFieldRequest,
) (*rpcv1.CustomFieldDefinition, error) {
	slog.DebugContext(ctx, "CreateCustomField",
		"projectID", req.ProjectId,
		"name", req.Name,
		"fieldType", req.FieldType.String(),
	)

	projectID := dbuuid.MustParse(req.ProjectId)
	fieldType := fieldTypeToString(req.FieldType)

	// Validate field type
	if !IsValidCustomFieldType(fieldType) {
		return nil, ErrInvalidFieldType
	}

	// Serialize options if provided
	var options []byte
	if len(req.Options) > 0 {
		var err error
		options, err = json.Marshal(req.Options)
		if err != nil {
			return nil, fmt.Errorf("failed to serialize options: %w", err)
		}
	}

	// Serialize default value if provided
	var defaultValue []byte
	if req.DefaultValue != nil {
		var err error
		defaultValue, err = json.Marshal(req.DefaultValue)
		if err != nil {
			return nil, fmt.Errorf("failed to serialize default value: %w", err)
		}
	}

	// Get next position
	position, err := l.Queries.GetNextFieldPosition(ctx, tx, &database.GetNextFieldPositionParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
	})
	if err != nil {
		position = 0
	}

	// Parse min/max values
	var minValue, maxValue pgtype.Numeric
	if req.MinValue != nil {
		minValue = pgtype.Numeric{Valid: true}
		_ = minValue.Scan(*req.MinValue)
	}
	if req.MaxValue != nil {
		maxValue = pgtype.Numeric{Valid: true}
		_ = maxValue.Scan(*req.MaxValue)
	}

	// Create field
	field, err := l.Queries.CreateCustomFieldDefinition(ctx, tx, &database.CreateCustomFieldDefinitionParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		ProjectID:      projectID,
		Name:           req.Name,
		Description:    pgtype.Text{String: req.GetDescription(), Valid: req.Description != nil},
		FieldType:      fieldType,
		Options:        options,
		DefaultValue:   defaultValue,
		IsRequired:     req.GetIsRequired(),
		MinValue:       minValue,
		MaxValue:       maxValue,
		Position:       int32(position),
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create custom field",
			"error", err,
		)
		return nil, fmt.Errorf("failed to create custom field: %w", err)
	}

	slog.InfoContext(ctx, "custom field created successfully",
		"fieldID", field.ID,
		"name", req.Name,
	)

	return customFieldToProto(field), nil
}

// UpdateCustomField updates a custom field definition
func (l *logicImpl) UpdateCustomField(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.UpdateCustomFieldRequest,
) (*rpcv1.CustomFieldDefinition, error) {
	slog.DebugContext(ctx, "UpdateCustomField",
		"fieldID", req.FieldId,
	)

	fieldID := dbuuid.MustParse(req.FieldId)
	now := time.Now()

	// Get current field
	current, err := l.Queries.GetCustomFieldDefinition(ctx, tx, &database.GetCustomFieldDefinitionParams{
		OrganizationID: orgID,
		ID:             fieldID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrCustomFieldNotFound
		}
		return nil, fmt.Errorf("failed to get custom field: %w", err)
	}

	// Build update params
	name := pgtype.Text{String: current.Name, Valid: true}
	if req.Name != nil {
		name = pgtype.Text{String: *req.Name, Valid: true}
	}

	description := current.Description
	if req.Description != nil {
		description = pgtype.Text{String: *req.Description, Valid: true}
	}

	options := current.Options
	if req.Options != nil {
		var err error
		options, err = json.Marshal(req.Options)
		if err != nil {
			return nil, fmt.Errorf("failed to serialize options: %w", err)
		}
	}

	isRequired := pgtype.Bool{Bool: current.IsRequired, Valid: true}
	if req.IsRequired != nil {
		isRequired = pgtype.Bool{Bool: *req.IsRequired, Valid: true}
	}

	// Update field
	updated, err := l.Queries.UpdateCustomFieldDefinition(ctx, tx, &database.UpdateCustomFieldDefinitionParams{
		OrganizationID: orgID,
		ID:             fieldID,
		Name:           name,
		Description:    description,
		Options:        options,
		IsRequired:     isRequired,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update custom field",
			"error", err,
		)
		return nil, fmt.Errorf("failed to update custom field: %w", err)
	}

	slog.InfoContext(ctx, "custom field updated successfully",
		"fieldID", fieldID,
	)

	return customFieldToProto(updated), nil
}

// ArchiveCustomField archives a custom field definition
func (l *logicImpl) ArchiveCustomField(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	fieldID dbuuid.UUID,
	archive bool,
) (*rpcv1.CustomFieldDefinition, error) {
	slog.DebugContext(ctx, "ArchiveCustomField",
		"fieldID", fieldID,
		"archive", archive,
	)

	now := time.Now()

	field, err := l.Queries.ArchiveCustomFieldDefinition(ctx, tx, &database.ArchiveCustomFieldDefinitionParams{
		OrganizationID: orgID,
		ID:             fieldID,
		IsArchived:     archive,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrCustomFieldNotFound
		}
		slog.ErrorContext(ctx, "failed to archive custom field",
			"error", err,
		)
		return nil, fmt.Errorf("failed to archive custom field: %w", err)
	}

	slog.InfoContext(ctx, "custom field archived successfully",
		"fieldID", fieldID,
	)

	return customFieldToProto(field), nil
}

// ListCustomFields lists all custom field definitions for a project
func (l *logicImpl) ListCustomFields(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
	includeArchived bool,
) ([]*rpcv1.CustomFieldDefinition, error) {
	slog.DebugContext(ctx, "ListCustomFields",
		"projectID", projectID,
		"includeArchived", includeArchived,
	)

	dbFields, err := l.Queries.ListCustomFieldDefinitions(ctx, tx, &database.ListCustomFieldDefinitionsParams{
		OrganizationID:  orgID,
		ProjectID:       projectID,
		IncludeArchived: pgtype.Bool{Bool: includeArchived, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list custom fields: %w", err)
	}

	fields := make([]*rpcv1.CustomFieldDefinition, len(dbFields))
	for i, f := range dbFields {
		fields[i] = customFieldToProto(f)
	}

	return fields, nil
}

// SetCustomFieldValue sets or updates a custom field value for a task
func (l *logicImpl) SetCustomFieldValue(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	taskID, fieldID dbuuid.UUID,
	value string,
) (*rpcv1.CustomFieldValue, error) {
	slog.DebugContext(ctx, "SetCustomFieldValue",
		"taskID", taskID,
		"fieldID", fieldID,
	)

	// Check task exists
	_, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrTaskNotFound
		}
		return nil, fmt.Errorf("failed to get task: %w", err)
	}

	// Check field exists
	field, err := l.Queries.GetCustomFieldDefinition(ctx, tx, &database.GetCustomFieldDefinitionParams{
		OrganizationID: orgID,
		ID:             fieldID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrCustomFieldNotFound
		}
		return nil, fmt.Errorf("failed to get field: %w", err)
	}

	// Validate value against field type and constraints
	if (field.FieldType == CustomFieldTypeSingleSelect || field.FieldType == CustomFieldTypeMultiSelect) && len(field.Options) > 0 {
		// The value is JSON-encoded (e.g. `"M"` stored as `"\"M\""`)
		var rawValue string
		if err := json.Unmarshal([]byte(value), &rawValue); err == nil {
			var allowedOptions []string
			if jsonErr := json.Unmarshal(field.Options, &allowedOptions); jsonErr == nil && len(allowedOptions) > 0 {
				found := false
				for _, opt := range allowedOptions {
					if opt == rawValue {
						found = true
						break
					}
				}
				if !found {
					return nil, fmt.Errorf("%w: option %q not allowed for field %q", ErrInvalidFieldValue, rawValue, field.Name)
				}
			}
		}
	}

	// Upsert value
	cfValue, err := l.Queries.UpsertCustomFieldValue(ctx, tx, &database.UpsertCustomFieldValueParams{
		ID:                dbuuid.Must(),
		OrganizationID:    orgID,
		TaskID:            taskID,
		FieldDefinitionID: fieldID,
		Value:             []byte(value),
		UpdatedAt:         pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to set custom field value",
			"error", err,
		)
		return nil, fmt.Errorf("failed to set custom field value: %w", err)
	}

	slog.InfoContext(ctx, "custom field value set successfully",
		"taskID", taskID,
		"fieldID", fieldID,
	)

	// Build result message and parse stored JSON value to oneof
	result := &rpcv1.CustomFieldValue{
		FieldId:   cfValue.FieldDefinitionID.String(),
		FieldName: field.Name,
		FieldType: stringToFieldTypeProto(field.FieldType),
	}

	// Parse stored JSON value to appropriate oneof field
	if err := setCustomFieldValueOneof(result, []byte(value), field.FieldType); err != nil {
		slog.WarnContext(ctx, "failed to parse custom field value JSON",
			"error", err,
			"fieldType", field.FieldType,
			"valueJSON", value,
		)
		// Fallback to string value if parsing fails
		result.Value = &rpcv1.FieldValue{
			Value: &rpcv1.FieldValue_StringValue{StringValue: value},
		}
	}

	return result, nil
}

// GetCustomFieldValue gets a custom field value for a task
func (l *logicImpl) GetCustomFieldValue(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	taskID, fieldID dbuuid.UUID,
) (*rpcv1.CustomFieldValue, error) {
	slog.DebugContext(ctx, "GetCustomFieldValue",
		"taskID", taskID,
		"fieldID", fieldID,
	)

	value, err := l.Queries.GetCustomFieldValue(ctx, tx, &database.GetCustomFieldValueParams{
		OrganizationID:    orgID,
		TaskID:            taskID,
		FieldDefinitionID: fieldID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrCustomFieldValueNotFound
		}
		return nil, fmt.Errorf("failed to get custom field value: %w", err)
	}

	// Get field definition for metadata
	field, err := l.Queries.GetCustomFieldDefinition(ctx, tx, &database.GetCustomFieldDefinitionParams{
		OrganizationID: orgID,
		ID:             fieldID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get field definition: %w", err)
	}

	// Build result message and parse stored JSON value to oneof
	result := &rpcv1.CustomFieldValue{
		FieldId:   value.FieldDefinitionID.String(),
		FieldName: field.Name,
		FieldType: stringToFieldTypeProto(field.FieldType),
	}

	// Parse stored JSON value to appropriate oneof field
	if err := setCustomFieldValueOneof(result, value.Value, field.FieldType); err != nil {
		slog.WarnContext(ctx, "failed to parse custom field value JSON",
			"error", err,
			"fieldType", field.FieldType,
			"valueJSON", string(value.Value),
		)
		// Fallback to string value if parsing fails
		result.Value = &rpcv1.FieldValue{
			Value: &rpcv1.FieldValue_StringValue{StringValue: string(value.Value)},
		}
	}

	return result, nil
}

// ListTaskCustomFieldValues lists all custom field values for a task
func (l *logicImpl) ListTaskCustomFieldValues(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID dbuuid.UUID,
) ([]*rpcv1.CustomFieldValue, error) {
	slog.DebugContext(ctx, "ListTaskCustomFieldValues",
		"taskID", taskID,
	)

	dbValues, err := l.Queries.ListCustomFieldValues(ctx, tx, &database.ListCustomFieldValuesParams{
		OrganizationID: orgID,
		TaskID:         taskID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list custom field values: %w", err)
	}

	values := make([]*rpcv1.CustomFieldValue, len(dbValues))
	for i, v := range dbValues {
		result := &rpcv1.CustomFieldValue{
			FieldId:   v.FieldDefinitionID.String(),
			FieldName: v.FieldName,
			FieldType: stringToFieldTypeProto(v.FieldType),
		}

		// Parse stored JSON value to appropriate oneof field
		if err := setCustomFieldValueOneof(result, v.Value, v.FieldType); err != nil {
			slog.WarnContext(ctx, "failed to parse custom field value JSON",
				"error", err,
				"fieldType", v.FieldType,
				"valueJSON", string(v.Value),
			)
			// Fallback to string value if parsing fails
			result.Value = &rpcv1.FieldValue{
				Value: &rpcv1.FieldValue_StringValue{StringValue: string(v.Value)},
			}
		}

		values[i] = result
	}

	return values, nil
}

// ============================================================================
// Helper Functions
// ============================================================================

func customFieldToProto(f *database.CollaborationCustomFieldDefinition) *rpcv1.CustomFieldDefinition {
	def := &rpcv1.CustomFieldDefinition{
		Id:         f.ID.String(),
		ProjectId:  f.ProjectID.String(),
		Name:       f.Name,
		FieldType:  stringToFieldTypeProto(f.FieldType),
		IsRequired: f.IsRequired,
		Position:   f.Position,
		IsArchived: f.IsArchived,
	}

	if f.Description.Valid {
		def.Description = f.Description.String
	}

	// Parse options from JSON
	if len(f.Options) > 0 {
		var options []string
		if err := json.Unmarshal(f.Options, &options); err == nil {
			def.Options = options
		}
	}

	// Parse default value to oneof structure
	if len(f.DefaultValue) > 0 {
		// Create temporary CustomFieldValue to reuse conversion logic
		tempValue := &rpcv1.CustomFieldValue{
			FieldType: stringToFieldTypeProto(f.FieldType),
		}
		if err := setCustomFieldValueOneof(tempValue, f.DefaultValue, f.FieldType); err == nil && tempValue.Value != nil {
			// Extract the oneof value and set it on the definition's default_value oneof
			switch v := tempValue.Value.Value.(type) {
			case *rpcv1.FieldValue_StringValue:
				def.DefaultValue = &rpcv1.CustomFieldDefinition_DefaultStringValue{DefaultStringValue: v.StringValue}
			case *rpcv1.FieldValue_NumberValue:
				def.DefaultValue = &rpcv1.CustomFieldDefinition_DefaultNumberValue{DefaultNumberValue: v.NumberValue}
			case *rpcv1.FieldValue_BoolValue:
				def.DefaultValue = &rpcv1.CustomFieldDefinition_DefaultBoolValue{DefaultBoolValue: v.BoolValue}
			case *rpcv1.FieldValue_StringArrayValue:
				def.DefaultValue = &rpcv1.CustomFieldDefinition_DefaultStringArrayValue{DefaultStringArrayValue: v.StringArrayValue}
			}
		}
	}

	// Parse min/max
	if f.MinValue.Valid {
		v, _ := f.MinValue.Float64Value()
		if v.Valid {
			def.MinValue = &v.Float64
		}
	}
	if f.MaxValue.Valid {
		v, _ := f.MaxValue.Float64Value()
		if v.Valid {
			def.MaxValue = &v.Float64
		}
	}

	return def
}

func fieldTypeToString(t rpcv1.CustomFieldType) string {
	switch t {
	case rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_TEXT:
		return CustomFieldTypeText
	case rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_NUMBER:
		return CustomFieldTypeNumber
	case rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_SINGLE_SELECT:
		return CustomFieldTypeSingleSelect
	case rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_MULTI_SELECT:
		return CustomFieldTypeMultiSelect
	case rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_DATE:
		return CustomFieldTypeDate
	case rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_USER:
		return CustomFieldTypeUser
	case rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_CHECKBOX:
		return CustomFieldTypeCheckbox
	default:
		return ""
	}
}
