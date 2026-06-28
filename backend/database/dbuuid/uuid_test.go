package dbuuid

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUUID_JSONMarshal(t *testing.T) {
	// Create a UUID
	googleUUID := uuid.MustParse("550e8400-e29b-41d4-a716-446655440000")
	customUUID := UUID(googleUUID)

	// Test marshaling
	data, err := json.Marshal(customUUID)
	require.NoError(t, err)

	// Verify it's human-readable text format (quoted string), not binary
	expected := `"550e8400-e29b-41d4-a716-446655440000"`
	assert.Equal(t, expected, string(data), "UUID should marshal to human-readable string format")
}

func TestUUID_JSONUnmarshal(t *testing.T) {
	// JSON string representation
	jsonData := `"550e8400-e29b-41d4-a716-446655440000"`

	// Test unmarshaling
	var customUUID UUID
	err := json.Unmarshal([]byte(jsonData), &customUUID)
	require.NoError(t, err)

	// Verify the value
	assert.Equal(t, "550e8400-e29b-41d4-a716-446655440000", customUUID.String())
}

func TestUUID_JSONRoundTrip(t *testing.T) {
	// Original UUID
	original := UUID(uuid.MustParse("550e8400-e29b-41d4-a716-446655440000"))

	// Marshal
	data, err := json.Marshal(original)
	require.NoError(t, err)

	// Unmarshal
	var decoded UUID
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	// Verify round-trip
	assert.Equal(t, original, decoded)
}

func TestNullUUID_JSONMarshal_Valid(t *testing.T) {
	// Create a valid NullUUID
	googleNullUUID := uuid.NullUUID{
		UUID:  uuid.MustParse("550e8400-e29b-41d4-a716-446655440000"),
		Valid: true,
	}
	customNullUUID := NullUUID(googleNullUUID)

	// Test marshaling
	data, err := json.Marshal(customNullUUID)
	require.NoError(t, err)

	// Verify it's human-readable text format
	expected := `"550e8400-e29b-41d4-a716-446655440000"`
	assert.Equal(t, expected, string(data), "Valid NullUUID should marshal to human-readable string format")
}

func TestNullUUID_JSONMarshal_Null(t *testing.T) {
	// Create a null NullUUID
	customNullUUID := NullUUID{Valid: false}

	// Test marshaling
	data, err := json.Marshal(customNullUUID)
	require.NoError(t, err)

	// Verify it marshals to null
	expected := `null`
	assert.Equal(t, expected, string(data), "Invalid NullUUID should marshal to null")
}

func TestNullUUID_JSONUnmarshal_Valid(t *testing.T) {
	// JSON string representation
	jsonData := `"550e8400-e29b-41d4-a716-446655440000"`

	// Test unmarshaling
	var customNullUUID NullUUID
	err := json.Unmarshal([]byte(jsonData), &customNullUUID)
	require.NoError(t, err)

	// Verify the value
	assert.True(t, customNullUUID.Valid)
	assert.Equal(t, "550e8400-e29b-41d4-a716-446655440000", uuid.UUID(customNullUUID.UUID).String())
}

func TestNullUUID_JSONUnmarshal_Null(t *testing.T) {
	// JSON null
	jsonData := `null`

	// Test unmarshaling
	var customNullUUID NullUUID
	err := json.Unmarshal([]byte(jsonData), &customNullUUID)
	require.NoError(t, err)

	// Verify it's invalid/null
	assert.False(t, customNullUUID.Valid)
}

func TestNullUUID_JSONRoundTrip_Valid(t *testing.T) {
	// Original valid NullUUID
	original := NullUUID{
		UUID:  uuid.MustParse("550e8400-e29b-41d4-a716-446655440000"),
		Valid: true,
	}

	// Marshal
	data, err := json.Marshal(original)
	require.NoError(t, err)

	// Unmarshal
	var decoded NullUUID
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	// Verify round-trip
	assert.Equal(t, original.Valid, decoded.Valid)
	assert.Equal(t, original.UUID, decoded.UUID)
}

func TestNullUUID_JSONRoundTrip_Null(t *testing.T) {
	// Original null NullUUID
	original := NullUUID{Valid: false}

	// Marshal
	data, err := json.Marshal(original)
	require.NoError(t, err)

	// Unmarshal
	var decoded NullUUID
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	// Verify round-trip
	assert.Equal(t, original.Valid, decoded.Valid)
}

// Test with struct containing UUID fields
type TestStruct struct {
	ID       UUID     `json:"id"`
	ParentID NullUUID `json:"parent_id"`
}

func TestStruct_JSONMarshal(t *testing.T) {
	obj := TestStruct{
		ID: UUID(uuid.MustParse("550e8400-e29b-41d4-a716-446655440000")),
		ParentID: NullUUID{
			UUID:  uuid.MustParse("660e8400-e29b-41d4-a716-446655440000"),
			Valid: true,
		},
	}

	data, err := json.Marshal(obj)
	require.NoError(t, err)

	// Verify human-readable format
	expected := `{"id":"550e8400-e29b-41d4-a716-446655440000","parent_id":"660e8400-e29b-41d4-a716-446655440000"}`
	assert.Equal(t, expected, string(data))
}

func TestStruct_JSONMarshal_WithNull(t *testing.T) {
	obj := TestStruct{
		ID:       UUID(uuid.MustParse("550e8400-e29b-41d4-a716-446655440000")),
		ParentID: NullUUID{Valid: false},
	}

	data, err := json.Marshal(obj)
	require.NoError(t, err)

	// Verify human-readable format with null
	expected := `{"id":"550e8400-e29b-41d4-a716-446655440000","parent_id":null}`
	assert.Equal(t, expected, string(data))
}
