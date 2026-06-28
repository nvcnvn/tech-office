package converter

import (
	"github.com/google/uuid"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

func UUIDToProto(id dbuuid.UUID) string {
	return id.String()
}

func ProtoToUUID(id string) dbuuid.UUID {
	uid, err := dbuuid.Parse(id)
	if err != nil {
		panic(err)
	}
	return uid
}

func NullUUIDToProto(nu dbuuid.NullUUID) string {
	if !nu.Valid {
		return ""
	}
	return UUIDToProto(dbuuid.UUID(nu.UUID))
}

func ProtoToNullUUID(id string) dbuuid.NullUUID {
	if id == "" {
		return dbuuid.NullUUID{Valid: false}
	}
	uid, err := dbuuid.Parse(id)
	if err != nil {
		panic(err)
	}
	return dbuuid.UUIDToNullUUID(uid)
}

// UUIDArrayToStrings converts []dbuuid.UUID to []string
func UUIDArrayToStrings(ids []dbuuid.UUID) []string {
	result := make([]string, len(ids))
	for i, id := range ids {
		result[i] = id.String()
	}
	return result
}

// StringsToUUIDs converts []string to []dbuuid.UUID
func StringsToUUIDs(ids []string) []dbuuid.UUID {
	result := make([]dbuuid.UUID, len(ids))
	for i, id := range ids {
		result[i] = ProtoToUUID(id)
	}
	return result
}

// StringsToGoogleUUIDs converts []string to []github.com/google/uuid.UUID
func StringsToGoogleUUIDs(ids []string) []uuid.UUID {
	result := make([]uuid.UUID, len(ids))
	for i, id := range ids {
		dbuuid := ProtoToUUID(id)
		result[i] = uuid.UUID(dbuuid)
	}
	return result
}
