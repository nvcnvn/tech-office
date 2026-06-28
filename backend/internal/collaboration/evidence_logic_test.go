package collaboration

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAutoApproveConfigProtoJSONRoundTrip(t *testing.T) {
	config := &rpcv1.AutoApproveConfig{
		GpsTarget:       &rpcv1.GpsTarget{Latitude: 48.8566, Longitude: 2.3522},
		GpsRadiusMeters: 500,
		DeadlineTime:    "09:30",
	}

	data, err := marshalAutoApproveConfigProto(config)
	require.NoError(t, err)
	assert.JSONEq(t, `{"gps_target":{"latitude":48.8566,"longitude":2.3522},"gps_radius_meters":500,"deadline_time":"09:30"}`, string(data))

	parsed := parseAutoApproveConfigProto(data)
	require.NotNil(t, parsed)
	assert.Equal(t, config, parsed)
}

func TestCheckAutoApproveWithProtoJSONConfig(t *testing.T) {
	req := &rpcv1.SubmitEvidenceRequest{
		GpsCoordinates: &rpcv1.GpsCoordinates{
			Latitude:       48.8566,
			Longitude:      2.3522,
			AccuracyMeters: 5,
		},
	}

	configData, err := marshalAutoApproveConfigProto(&rpcv1.AutoApproveConfig{
		GpsTarget:       &rpcv1.GpsTarget{Latitude: 48.8566, Longitude: 2.3522},
		GpsRadiusMeters: 500,
	})
	require.NoError(t, err)

	assert.True(t, checkAutoApprove(req, configData))
}

func TestEvidenceSubmissionToProtoPreservesGpsCoordinates(t *testing.T) {
	submission := &database.CollaborationEvidenceSubmission{
		ID:                    dbuuid.Must(),
		TaskID:                dbuuid.Must(),
		EvidenceRequirementID: dbuuid.Must(),
		SubmittedByEmployeeID: dbuuid.Must(),
		EvidenceType:          "gps_checkin",
		GpsLatitude:           mustNumeric(t, "10.77690"),
		GpsLongitude:          mustNumeric(t, "106.70090"),
		GpsAccuracyMeters:     mustNumeric(t, "8.50"),
		ApprovalStatus:        "pending_review",
	}

	proto := evidenceSubmissionToProto(submission)
	require.NotNil(t, proto.GpsCoordinates)
	assert.InDelta(t, 10.7769, proto.GpsCoordinates.Latitude, 0.000001)
	assert.InDelta(t, 106.7009, proto.GpsCoordinates.Longitude, 0.000001)
	assert.InDelta(t, 8.5, proto.GpsCoordinates.AccuracyMeters, 0.000001)
}

func mustNumeric(t *testing.T, value string) pgtype.Numeric {
	t.Helper()

	var numeric pgtype.Numeric
	require.NoError(t, numeric.Scan(value))
	return numeric
}
