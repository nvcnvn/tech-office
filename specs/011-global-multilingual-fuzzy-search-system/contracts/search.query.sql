-- Search Queries for Global Multilingual Fuzzy Search System
-- Domain-owned search approach: queries belong in domain-specific files
-- 
-- ⚠️ IMPLEMENTATION NOTE:
-- This file shows all search queries together for planning purposes.
-- During implementation, these queries should be split into domain-specific files:
--   - organization.query.sql: SearchEmployees, SearchDepartments, Autocomplete*Employees, Autocomplete*Departments
--   - chat.query.sql: SearchChannels, SearchMessages, AutocompleteChannels
--
-- All queries MUST filter by organization_id for multi-tenant isolation

-- ============================================================
-- EMPLOYEE SEARCH
-- ============================================================

-- name: SearchEmployees :many
-- Search users with fuzzy matching on email + names
SELECT 
    id,
    email,
    given_name,
    family_name,
    is_active,
    similarity(email || ' ' || given_name || ' ' || family_name, sqlc.arg('query_text')) AS score,
    updated_at
FROM organization.employee
WHERE organization_id = sqlc.arg('organization_id')
  AND is_active = true
  AND (email || ' ' || given_name || ' ' || family_name) % sqlc.arg('query_text')
  -- Optional cursor-based pagination
  AND (sqlc.narg('cursor')::UUID IS NULL OR id < sqlc.narg('cursor')::UUID)
ORDER BY score DESC, updated_at DESC, id DESC
LIMIT sqlc.arg('limit')::INT;

-- name: AutocompleteEmployees :many
-- Prefix-based autocomplete for employee selection
SELECT 
    id,
    email,
    given_name,
    family_name
FROM organization.employee
WHERE organization_id = sqlc.arg('organization_id')
  AND is_active = true
  AND (email || ' ' || given_name || ' ' || family_name) ILIKE sqlc.arg('prefix') || '%'
ORDER BY 
    LENGTH(email || ' ' || given_name || ' ' || family_name),
    family_name, given_name
LIMIT 10;

-- ============================================================
-- DEPARTMENT SEARCH
-- ============================================================

-- name: SearchDepartments :many
-- Search departments with fuzzy matching on name + description
SELECT 
    id,
    name,
    description,
    member_count,
    parent_department_id,
    similarity(name || ' ' || COALESCE(description, ''), sqlc.arg('query_text')) AS score,
    updated_at
FROM organization.department
WHERE organization_id = sqlc.arg('organization_id')
  AND (name || ' ' || COALESCE(description, '')) % sqlc.arg('query_text')
  AND (sqlc.narg('cursor')::UUID IS NULL OR id < sqlc.narg('cursor')::UUID)
ORDER BY score DESC, member_count DESC, id DESC
LIMIT sqlc.arg('limit')::INT;

-- name: AutocompleteDepartments :many
-- Prefix-based autocomplete for department selection
SELECT 
    id,
    name,
    description
FROM organization.department
WHERE organization_id = sqlc.arg('organization_id')
  AND name ILIKE sqlc.arg('prefix') || '%'
ORDER BY 
    LENGTH(name),
    name
LIMIT 10;

-- ============================================================
-- CHANNEL SEARCH
-- ============================================================

-- name: SearchChannels :many
-- Search channels with permission filtering (public OR member)
SELECT 
    c.id,
    c.display_name,
    c.description,
    c.channel_type,
    c.title_slug,
    c.is_private,
    similarity(c.display_name || ' ' || COALESCE(c.description, ''), sqlc.arg('query_text')) AS score,
    c.updated_at
FROM chat.channel c
WHERE c.organization_id = sqlc.arg('organization_id')
  AND c.is_archived = false
  AND (c.display_name || ' ' || COALESCE(c.description, '')) % sqlc.arg('query_text')
  AND (
    -- Permission filtering: public channels OR user is member
    c.is_private = false
    OR EXISTS (
        SELECT 1 FROM chat.channel_membership cm
        WHERE cm.channel_id = c.id AND cm.employee_id = sqlc.arg('employee_id')
    )
  )
  AND (sqlc.narg('cursor')::UUID IS NULL OR c.id < sqlc.narg('cursor')::UUID)
ORDER BY score DESC, c.updated_at DESC, c.id DESC
LIMIT sqlc.arg('limit')::INT;

-- name: AutocompleteChannels :many
-- Prefix-based autocomplete for channel selection
SELECT 
    c.id,
    c.display_name,
    c.channel_type,
    c.is_private
FROM chat.channel c
WHERE c.organization_id = sqlc.arg('organization_id')
  AND c.is_archived = false
  AND c.display_name ILIKE sqlc.arg('prefix') || '%'
  AND (
    c.is_private = false
    OR EXISTS (
        SELECT 1 FROM chat.channel_membership cm
        WHERE cm.channel_id = c.id AND cm.employee_id = sqlc.arg('employee_id')
    )
  )
ORDER BY 
    LENGTH(c.display_name),
    c.display_name
LIMIT 10;

-- ============================================================
-- MESSAGE SEARCH
-- ============================================================

-- name: SearchMessages :many
-- Search messages with channel permission filtering
SELECT 
    m.id,
    m.message_text,
    m.author_employee_id,
    m.channel_id,
    m.parent_message_id,
    m.is_edited,
    similarity(m.message_text, sqlc.arg('query_text')) AS score,
    m.updated_at,
    c.display_name as channel_name,
    c.is_private as channel_is_private
FROM chat.message m
INNER JOIN chat.channel c ON m.channel_id = c.id
WHERE m.organization_id = sqlc.arg('organization_id')
  AND m.is_deleted = false
  AND c.is_archived = false
  AND m.message_text % sqlc.arg('query_text')
  AND (
    -- Permission filtering: inherit from channel
    c.is_private = false
    OR EXISTS (
        SELECT 1 FROM chat.channel_membership cm
        WHERE cm.channel_id = c.id AND cm.employee_id = sqlc.arg('employee_id')
    )
  )
  AND (sqlc.narg('cursor')::UUID IS NULL OR m.id < sqlc.narg('cursor')::UUID)
ORDER BY score DESC, m.updated_at DESC, m.id DESC
LIMIT sqlc.arg('limit')::INT;
