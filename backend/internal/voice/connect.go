package voice

import (
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

type ServiceConnect struct {
	rpcv1connect.UnimplementedVoiceServiceHandler

	Logic      *Logic
	TenantPool database.TenantDatabaseConnector
}

func NewServiceConnect(logic *Logic, tenantPool database.TenantDatabaseConnector) *ServiceConnect {
	return &ServiceConnect{
		Logic:      logic,
		TenantPool: tenantPool,
	}
}
