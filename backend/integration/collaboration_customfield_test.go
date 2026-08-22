package integration

import (
	"testing"

	"connectrpc.com/connect"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCustomField covers the 7 custom field types, value CRUD, validation rules, and archiving.
func TestCustomField(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	proj := w.createProject(owner, "CF Test", uniqueProjectKey("CF"))

	t.Run("when creating all supported field types", func(t *testing.T) {
		types := []rpcv1.CustomFieldType{
			rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_TEXT,
			rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_NUMBER,
			rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_SINGLE_SELECT,
			rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_MULTI_SELECT,
			rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_DATE,
			rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_USER,
			rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_CHECKBOX,
		}

		for _, ft := range types {
			id := w.createCustomField(owner, proj.ID, ft.String(), ft)
			assert.NotEmpty(t, id, "field ID for type %s", ft)
		}

		t.Run("all 7 types appear in the field list", func(t *testing.T) {
			fields := w.listCustomFields(owner, proj.ID)
			require.GreaterOrEqual(t, len(fields), 7)
		})
	})

	t.Run("when creating a select field with options", func(t *testing.T) {
		fieldID := w.createSelectField(owner, proj.ID, "Size", []string{"XS", "S", "M", "L", "XL"})
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)
		task := w.createTask(owner, proj.ID, "Size Task", level0.Id)

		t.Run("setting a valid option succeeds", func(t *testing.T) {
			w.setCustomFieldStringValue(owner, task.Id, fieldID, "M")
		})

		t.Run("setting an invalid option is rejected", func(t *testing.T) {
			err := w.setCustomFieldStringValueError(owner, task.Id, fieldID, "XXL")
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})
	})

	t.Run("when setting and reading a text field value", func(t *testing.T) {
		fieldID := w.createCustomField(owner, proj.ID, "Notes", rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_TEXT)
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)
		task := w.createTask(owner, proj.ID, "Text Task", level0.Id)

		w.setCustomFieldStringValue(owner, task.Id, fieldID, "hello world")

		t.Run("the value is retrievable on the task", func(t *testing.T) {
			fetched := w.getTaskWithCustomFields(owner, task.Id)
			require.NotEmpty(t, fetched.CustomFieldValues)
			found := false
			for _, v := range fetched.CustomFieldValues {
				if v.FieldId == fieldID {
					found = true
				}
			}
			assert.True(t, found, "custom field value should be present")
		})
	})

	t.Run("when archiving a custom field", func(t *testing.T) {
		fieldID := w.createCustomField(owner, proj.ID, "Archivable", rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_TEXT)
		w.archiveCustomField(owner, fieldID)

		t.Run("it is excluded from the default list", func(t *testing.T) {
			fields := w.listCustomFields(owner, proj.ID)
			for _, f := range fields {
				assert.NotEqual(t, fieldID, f.Id, "archived field should not be in default list")
			}
		})

		t.Run("it appears when includeArchived is set", func(t *testing.T) {
			fields := w.listCustomFieldsIncludeArchived(owner, proj.ID)
			found := false
			for _, f := range fields {
				if f.Id == fieldID {
					found = true
					assert.True(t, f.IsArchived)
				}
			}
			assert.True(t, found, "archived field should be in includeArchived list")
		})
	})
}
