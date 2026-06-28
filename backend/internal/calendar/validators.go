package calendar

const AuditActionTypeUpdated = "modified"

func IsValidRSVPStatus(s string) bool {
	switch s {
	case RSVPStatusPending, RSVPStatusAccepted, RSVPStatusDeclined, RSVPStatusTentative:
		return true
	}
	return false
}

func IsValidEventType(s string) bool {
	switch s {
	case EventTypeMeeting, EventTypeShift, EventTypeDeadline, EventTypeReminder,
		EventTypeOutOfOffice, EventTypeCompanyEvent, EventTypeTraining, EventTypeMaintenanceWindow:
		return true
	}
	return false
}

func IsValidVisibility(s string) bool {
	switch s {
	case VisibilityPrivate, VisibilityPersonalShared, VisibilityTeam, VisibilityOrgWide:
		return true
	}
	return false
}

func IsValidResourceType(s string) bool {
	switch s {
	case ResourceTypeRoom, ResourceTypeVehicle, ResourceTypeEquipment, ResourceTypeDesk, ResourceTypeLab:
		return true
	}
	return false
}
