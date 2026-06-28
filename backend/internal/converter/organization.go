package converter

import (
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	v1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func ProtoToOrganization(organization *v1.Organization) *database.Organization {
	return &database.Organization{
		ID:          ProtoToUUID(organization.Id),
		CompanyName: organization.CompanyName,
		Subdomain:   organization.Subdomain,
		ClientID:    pgtype.Text{String: organization.ClientId, Valid: true},
		UpdatedAt:   ProtoToTime(organization.UpdatedAt),
	}
}

func OrganizationToProto(organization *database.Organization) *v1.Organization {
	clientID := ""
	if organization.ClientID.Valid {
		clientID = organization.ClientID.String
	}

	return &v1.Organization{
		Id:          UUIDToProto(organization.ID),
		CompanyName: organization.CompanyName,
		Subdomain:   organization.Subdomain,
		ClientId:    clientID,
		UpdatedAt:   TimeToProto(organization.UpdatedAt),
	}
}
