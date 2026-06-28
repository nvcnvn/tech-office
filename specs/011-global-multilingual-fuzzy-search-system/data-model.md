# Data Model: Global Multilingual Fuzzy Search System

**Feature**: 011-global-multilingual-fuzzy-search-system  
**Date**: 2025-11-01  
**Status**: Draft

---

## Overview

Database schema changes to support multilingual search across users, departments, chat channels, and messages.

**Key Decisions**:
- **NO separate search schema**: Add search columns to existing domain tables
- **PostgreSQL FTS** for chat messages with language-aware indexing
- **pg_trgm** for fuzzy matching on short fields
- **Trigger-based tsvector** maintenance
- **lingua-go language detection** stored in database

---

## Schema Changes

### 1. chat.message (FTS for Message Search)

```sql
-- Add language detection column
ALTER TABLE chat.message 
ADD COLUMN language VARCHAR(10) NOT NULL DEFAULT 'unknown'
  CHECK (language IN ('en', 'zh', 'es', 'hi', 'de', 'ja', 'fr', 'pt', 'vi', 'unknown'));

COMMENT ON COLUMN chat.message.language IS 
'ISO 639-1 language code. Supported: en, zh, es, hi, de, ja, fr, pt, vi, unknown';

-- Add FTS vector column
ALTER TABLE chat.message 
ADD COLUMN content_tsv tsvector;

COMMENT ON COLUMN chat.message.content_tsv IS 
'Full-text search vector. Populated by trigger using language-specific config.';

-- GIN index for FTS
CREATE INDEX idx_message_content_fts ON chat.message USING GIN(content_tsv);

-- Composite index for language-filtered search  
CREATE INDEX idx_message_org_lang ON chat.message(organization_id, language);
```

**Trigger Function**:
```sql
CREATE OR REPLACE FUNCTION chat.update_message_search_vector()
RETURNS TRIGGER AS $$
DECLARE
    config_name TEXT;
BEGIN
    config_name := CASE NEW.language
        WHEN 'en' THEN 'english'
        WHEN 'es' THEN 'spanish'
        WHEN 'fr' THEN 'french'
        WHEN 'de' THEN 'german'
        WHEN 'pt' THEN 'portuguese'
        WHEN 'zh' THEN 'zhparser'
        WHEN 'ja' THEN 'pg_bigm'
        WHEN 'hi' THEN 'simple'
        WHEN 'vi' THEN 'simple'
        ELSE 'simple'
    END;
    
    NEW.content_tsv := to_tsvector(config_name::regconfig, NEW.content);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_message_search_update
BEFORE INSERT OR UPDATE OF content, language ON chat.message
FOR EACH ROW EXECUTE FUNCTION chat.update_message_search_vector();
```

---

### 2. organization.employee (pg_trgm for Names)

```sql
-- Trigram indexes for fuzzy matching
CREATE INDEX idx_employee_given_name_trgm 
  ON organization.employee USING GIN(given_name gin_trgm_ops);

CREATE INDEX idx_employee_family_name_trgm 
  ON organization.employee USING GIN(family_name gin_trgm_ops);

CREATE INDEX idx_employee_email_trgm 
  ON organization.employee USING GIN(email gin_trgm_ops);
```

---

### 3. organization.department (pg_trgm)

```sql
CREATE INDEX idx_department_name_trgm 
  ON organization.department USING GIN(name gin_trgm_ops);
```

---

### 4. chat.channel (pg_trgm)

```sql
CREATE INDEX idx_channel_name_trgm 
  ON chat.channel USING GIN(name gin_trgm_ops);
```

---

## PostgreSQL Extensions

```sql
-- Required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- Already installed
CREATE EXTENSION IF NOT EXISTS unaccent;   -- Likely installed
CREATE EXTENSION IF NOT EXISTS zhparser;   -- NEW - Chinese
CREATE EXTENSION IF NOT EXISTS pg_bigm;    -- NEW - Japanese
```

---

## sqlc Queries (search.query.sql)

```sql
-- name: SearchMessagesByLanguage :many
SELECT 
    m.id, m.organization_id, m.channel_id, m.sender_id,
    m.content, m.language, m.updated_at,
    ts_rank(m.content_tsv, query) AS rank,
    ts_headline(@config_name::regconfig, m.content, query) AS snippet
FROM chat.message m,
     plainto_tsquery(@config_name::regconfig, @search_query) query
WHERE m.organization_id = @organization_id
  AND m.language = @lang
  AND m.content_tsv @@ query
  AND m.deleted_at IS NULL
ORDER BY rank DESC, m.updated_at DESC
LIMIT @result_limit;

-- name: SearchMessagesAllLanguages :many
SELECT 
    m.id, m.organization_id, m.channel_id, m.sender_id,
    m.content, m.language, m.updated_at,
    ts_rank(m.content_tsv, query) AS rank,
    ts_headline('simple', m.content, query) AS snippet
FROM chat.message m,
     plainto_tsquery('simple', @search_query) query
WHERE m.organization_id = @organization_id
  AND m.content_tsv @@ query
  AND m.deleted_at IS NULL
ORDER BY rank DESC, m.updated_at DESC
LIMIT @result_limit;

-- name: SearchEmployeesByName :many
SELECT 
    e.id, e.organization_id, e.given_name, e.family_name, e.email, e.status,
    similarity(e.given_name || ' ' || e.family_name, @search_query) AS name_sim,
    similarity(e.email, @search_query) AS email_sim
FROM organization.employee e
WHERE e.organization_id = @organization_id
  AND e.status = 'active'
  AND (
    e.given_name % @search_query OR
    e.family_name % @search_query OR
    e.email % @search_query
  )
ORDER BY GREATEST(name_sim, email_sim) DESC
LIMIT @result_limit;

-- name: SearchDepartmentsByName :many
SELECT 
    d.id, d.organization_id, d.name, d.description,
    similarity(d.name, @search_query) AS similarity
FROM organization.department d
WHERE d.organization_id = @organization_id
  AND d.deleted_at IS NULL
  AND d.name % @search_query
ORDER BY similarity DESC
LIMIT @result_limit;

-- name: SearchChannelsByName :many
SELECT 
    c.id, c.organization_id, c.name, c.description, c.channel_type,
    similarity(c.name, @search_query) AS similarity
FROM chat.channel c
WHERE c.organization_id = @organization_id
  AND c.deleted_at IS NULL
  AND c.name % @search_query
ORDER BY similarity DESC
LIMIT @result_limit;
```

---

## Multi-Tenant Isolation

**All queries MUST filter by `organization_id`**:
```sql
WHERE m.organization_id = @organization_id  -- MANDATORY
```

**Citus Distribution**:
- All tables already distributed by `organization_id`
- Queries route to correct shard automatically
- Indexes are shard-local (fast)

---

## Performance Estimates

### Index Sizes (1M messages)
- FTS GIN index: ~300-500 MB
- Trigram indexes: ~50 MB (10K users)
- Total: ~500-600 MB per org

### Query Performance
- Message FTS: 100-500ms (cold cache)
- Name trigram: 50-100ms
- Combined: <1s

### Indexing Overhead
- Trigger per INSERT: +5-10ms
- Acceptable for message posting

---

## Migration Strategy

**Phase 1: Schema (No Downtime)**
1. Add columns with defaults (no locks)
2. Create indexes CONCURRENTLY
3. Create trigger (affects new messages only)

**Phase 2: Historical Data (Optional)**
- Background job to detect language for existing messages
- Not critical - trigger handles all new messages

---

**Status**: ✅ Ready for implementation
