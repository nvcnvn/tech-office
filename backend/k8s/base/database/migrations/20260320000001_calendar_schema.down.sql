-- Migration: Drop calendar schema tables (Feature 026)
-- Direction: DOWN

DROP TABLE IF EXISTS calendar.event_reminder;
DROP TABLE IF EXISTS calendar.booking_link;
DROP TABLE IF EXISTS calendar.audit_entry;
DROP TABLE IF EXISTS calendar.check_in;
DROP TABLE IF EXISTS calendar.delegation;
DROP TABLE IF EXISTS calendar.working_hours;
DROP TABLE IF EXISTS calendar.resource_booking;
DROP TABLE IF EXISTS calendar.resource_acl;
DROP TABLE IF EXISTS calendar.resource;
DROP TABLE IF EXISTS calendar.attendee;
DROP TABLE IF EXISTS calendar.recurrence_exception;
DROP TABLE IF EXISTS calendar.event;
