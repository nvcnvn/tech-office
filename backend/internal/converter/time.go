package converter

import (
	"github.com/jackc/pgx/v5/pgtype"

	"google.golang.org/protobuf/types/known/timestamppb"
)

func TimeToProto(t pgtype.Timestamptz) *timestamppb.Timestamp {
	return timestamppb.New(t.Time)
}

func ProtoToTime(ts *timestamppb.Timestamp) pgtype.Timestamptz {
	return pgtype.Timestamptz{
		Time:  ts.AsTime(),
		Valid: true,
	}
}
