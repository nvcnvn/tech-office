# Research: Global Multilingual Fuzzy Search System

**Date**: 2025-11-01  
**Feature**: 011-global-multilingual-fuzzy-search-system  
**Purpose**: Resolve technical unknowns and document technology choices
**Status**: Complete (Updated based on early testing feedback)

---

## Executive Summary

**Key Decision**: Pivot from pg_trgm to PostgreSQL Full-Text Search (FTS) for medium/long content based on early testing results showing poor performance of pg_trgm on chat messages.

**Technology Stack**:
- **PostgreSQL FTS** for message search with language-aware processing
- **pg_trgm** retained for short-field fuzzy matching (names, emails)
- **lingua-go** for automatic language detection
- **Language-specific extensions** for non-Latin scripts (zhparser, etc.)

**Critical Finding from Early Testing**:
> "Early testing showing that current plan of using pg_trgm for search medium content like chat message give very poor result, the longer the content the worse the match, if we set the threshold too low we risk having false negative result"

This finding invalidates the original approach and requires a fundamental pivot in search strategy.

---

## 1. Search Technology Evaluation

### 1.1 pg_trgm Performance Issues (Early Testing Results)

**Decision**: DO NOT use pg_trgm for medium/long content (chat messages)

**Problems Identified**:
- **Poor matching on longer content**: Match quality degrades as message length increases
- **False negative risk**: Low similarity thresholds needed to catch matches also increase false positives
- **No semantic understanding**: Trigrams are purely character-based, no term weighting
- **No relevance ranking**: Equal weight to all trigram matches regardless of term importance

**Retain pg_trgm ONLY for**:
- User names (given_name, family_name)
- Email addresses  
- Department names
- Channel names

These are short fields where trigram fuzzy matching excels at handling typos and partial matches.

### 1.2 PostgreSQL Full-Text Search (FTS) - ADOPTED

**Decision**: Use PostgreSQL FTS for chat message search

**Rationale**:
- **Native to PostgreSQL**: No external dependencies (meets NFR-001)
- **Language-aware text processing**:
  - Tokenization: Splits text into words/terms
  - Stemming: "running" → "run", "ran" → "run"  
  - Stop words: Ignores "the", "a", "is" for better relevance
  - Dictionary support: 20+ built-in languages
- **Relevance ranking**: `ts_rank()` provides TF-IDF-like scoring
- **Match highlighting**: `ts_headline()` generates snippets with <b> tags
- **Performance**: GIN indexes enable millisecond searches on millions of documents
- **Proven at scale**: Battle-tested in production systems worldwide

**PostgreSQL FTS Language Support**:

| Language | ISO Code | Config Name | Built-in | Extension | Notes |
|----------|----------|-------------|----------|-----------|-------|
| English | en | `english` | ✅ Yes | None | Porter stemmer, comprehensive |
| Spanish | es | `spanish` | ✅ Yes | None | Snowball stemmer |
| French | fr | `french` | ✅ Yes | None | Snowball stemmer |
| German | de | `german` | ✅ Yes | None | Snowball stemmer |
| Portuguese | pt | `portuguese` | ✅ Yes | None | Snowball stemmer |
| Mandarin Chinese | zh | `zhparser` | ❌ No | **zhparser** | Word segmentation (no spaces) |
| Japanese | ja | `pg_bigm` | ❌ No | **pg_bigm** | Bigram-based tokenization |
| Hindi | hi | `simple` + unaccent | ⚠️ Partial | unaccent | Basic tokenization, limited stemming |
| Vietnamese | vi | `simple` + unaccent | ⚠️ Partial | unaccent | Basic tokenization, limited stemming |

**Extension Installation Plan**:
1. **zhparser** (Chinese): `CREATE EXTENSION zhparser;`
2. **pg_bigm** (Japanese): `CREATE EXTENSION pg_bigm;`  
3. **unaccent** (diacritics): `CREATE EXTENSION unaccent;` (likely already installed)

### 1.3 Language Detection - lingua-go

**Decision**: Use lingua-go (https://github.com/pemistahl/lingua-go)

**Rationale**:
- **High accuracy**: ML-based, state-of-the-art language detection
- **Fast performance**: <1ms per message in benchmarks
- **Wide coverage**: Supports all 9 target languages plus 70+ more
- **Pure Go implementation**: No C dependencies, easy Docker integration
- **Production-ready**: Active maintenance, used by multiple projects

**Integration Pattern**:
```go
import "github.com/pemistahl/lingua-go"

// Initialize once at startup
detector := lingua.NewLanguageDetectorBuilder().
    FromLanguages(
        lingua.English, lingua.Spanish, lingua.French, lingua.German, 
        lingua.Portuguese, lingua.Chinese, lingua.Japanese, 
        lingua.Hindi, lingua.Vietnamese,
    ).
    Build()

// On message insert
func (l *ChatLogic) CreateMessage(ctx context.Context, tx database.DBTX, content string) {
    detectedLang := detector.DetectLanguageOf(content)
    langCode := convertToISO639(detectedLang) // "en", "zh", "es", etc.
    
    // Store in database
    l.queries.InsertMessage(ctx, tx, database.InsertMessageParams{
        Content: content,
        Language: langCode, // New column
        // ... other fields
    })
}
```

**Fallback Handling**:
- **Short text (<20 chars)**: Confidence may be low → store as `unknown`
- **Mixed language**: Detect dominant language
- **Unknown language**: Store as `unknown`, index with `simple` config

---

## 2. Multi-Language Indexing Architecture

### 2.1 Index Strategy Decision

**Research Question**: How to efficiently index and search messages in 9 different languages?

**Option A: Separate tsvector column per language** ❌
```sql
content_en_tsv tsvector,
content_es_tsv tsvector,
content_zh_tsv tsvector,
-- ... 9 columns, 9 GIN indexes
```
**Problems**:
- Column explosion (9+ columns)
- Index bloat (9 GIN indexes)
- Query complexity (must UNION across all columns)
- Inflexible (adding language = schema migration)

**Option B: Single tsvector with dynamic config** ❌
```sql
content_tsv tsvector GENERATED ALWAYS AS (to_tsvector(language_config, content))
```
**Problem**: PostgreSQL doesn't support runtime variable in GENERATED column

**Option C: Application-managed tsvector via trigger** ✅ CHOSEN
```sql
CREATE TABLE chat.message (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    content TEXT NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'unknown',
    content_tsv tsvector, -- Populated by trigger
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION chat.update_message_search_vector()
RETURNS TRIGGER AS $$
DECLARE
    config_name TEXT;
BEGIN
    -- Map ISO code to PostgreSQL config
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

**Advantages**:
✅ Single column, single GIN index  
✅ Flexible - easy to add new languages  
✅ Efficient - one index covers all languages  
✅ Maintainable - clear trigger logic  

### 2.2 Search Query Strategy

**Decision**: Two-phase search approach

**Phase 1: Language-matched search** (Fast Path)
```sql
-- User searches "budget meeting" (detected as English)
SELECT 
    m.id,
    m.content,
    m.language,
    ts_rank(m.content_tsv, query) AS rank,
    ts_headline('english', m.content, query) AS snippet
FROM chat.message m,
     to_tsquery('english', 'budget & meeting') query
WHERE m.organization_id = $1
  AND m.language = 'en'  -- Filter by detected language
  AND m.content_tsv @@ query
ORDER BY rank DESC
LIMIT 20;
```

**Phase 2: Fallback to all languages** (if Phase 1 returns <10 results)
```sql
-- Broaden search using 'simple' config (language-agnostic)
SELECT 
    m.id,
    m.content,
    m.language,
    ts_rank(m.content_tsv, query) AS rank,
    ts_headline('simple', m.content, query) AS snippet
FROM chat.message m,
     to_tsquery('simple', 'budget & meeting') query
WHERE m.organization_id = $1
  AND m.content_tsv @@ query
ORDER BY rank DESC
LIMIT 20;
```

**Performance Characteristics**:
- **Phase 1**: Fast (indexed on `organization_id, language, content_tsv`)
- **Phase 2**: Slower but comprehensive (all languages)
- **Logic**: Phase 2 only executes if Phase 1 insufficient

---

## 3. Database Schema Design

### 3.1 Schema Organization

**Decision**: Add search columns to existing domain tables, NO separate search schema

**Rationale**:
- **Simplicity**: Avoid maintaining duplicate denormalized data
- **Real-time consistency**: No sync lag between source and search tables
- **Direct access**: Query source tables with FTS indexes
- **Easier permission filtering**: Native FK relationships preserved

**Affected Tables**:

**chat.message** (PRIMARY target for FTS)
```sql
ALTER TABLE chat.message 
ADD COLUMN language VARCHAR(10) NOT NULL DEFAULT 'unknown'
    CHECK (language IN ('en', 'zh', 'es', 'hi', 'de', 'ja', 'fr', 'pt', 'vi', 'unknown')),
ADD COLUMN content_tsv tsvector;

CREATE INDEX idx_message_content_fts ON chat.message USING GIN(content_tsv);
CREATE INDEX idx_message_org_lang ON chat.message(organization_id, language);

-- Trigger (see section 2.1)
CREATE TRIGGER trg_message_search_update ...
```

**organization.employee** (pg_trgm for names)
```sql
-- Add trigram indexes for fuzzy name search
CREATE INDEX idx_employee_given_name_trgm ON organization.employee USING GIN(given_name gin_trgm_ops);
CREATE INDEX idx_employee_family_name_trgm ON organization.employee USING GIN(family_name gin_trgm_ops);
CREATE INDEX idx_employee_email_trgm ON organization.employee USING GIN(email gin_trgm_ops);
```

**organization.department** (pg_trgm for names)
```sql
CREATE INDEX idx_department_name_trgm ON organization.department USING GIN(name gin_trgm_ops);
```

**chat.channel** (pg_trgm for names)
```sql
CREATE INDEX idx_channel_name_trgm ON chat.channel USING GIN(name gin_trgm_ops);
```

### 3.2 Multi-Tenant Isolation

**All queries MUST filter by `organization_id`**:
```sql
-- Example: Search messages
SELECT * FROM chat.message
WHERE organization_id = $1  -- ALWAYS filter by org
  AND content_tsv @@ to_tsquery('english', $2);
```

**Citus Distribution**:
- `chat.message` already distributed by `organization_id`
- `organization.employee` already distributed by `organization_id`
- Indexes are local to each shard → fast queries

---

## 4. Service Architecture

### 4.1 Two-Layer Service Design

**SearchLogic** (Logic Layer)
```go
package search

type SearchLogic struct {
    queries       *database.Queries
    channelLogic  chat.ChannelLogicInterface      // For permission checks
    employeeLogic organization.EmployeeLogicInterface
    linguaDetector lingua.LanguageDetector
}

func NewSearchLogic(
    queries *database.Queries,
    channelLogic chat.ChannelLogicInterface,
    employeeLogic organization.EmployeeLogicInterface,
    linguaDetector lingua.LanguageDetector,
) *SearchLogic {
    return &SearchLogic{
        queries: queries,
        channelLogic: channelLogic,
        employeeLogic: employeeLogic,
        linguaDetector: linguaDetector,
    }
}

func (l *SearchLogic) SearchMessages(
    ctx context.Context,
    tx database.DBTX,
    orgID dbuuid.UUID,
    employeeID dbuuid.UUID,
    query string,
) ([]MessageResult, error) {
    // 1. Detect query language
    langCode := l.detectLanguage(query)
    
    // 2. Search messages (Phase 1: language-matched)
    results := l.queries.SearchMessagesByLanguage(ctx, tx, orgID, langCode, query)
    
    // 3. Fallback if insufficient (Phase 2: all languages)
    if len(results) < 10 {
        results = l.queries.SearchMessagesAllLanguages(ctx, tx, orgID, query)
    }
    
    // 4. Filter by channel permissions
    accessibleResults := l.filterByChannelAccess(ctx, tx, employeeID, results)
    
    return accessibleResults, nil
}
```

**SearchServiceConnect** (Connect Layer)
```go
package search

type SearchServiceConnect struct {
    logic      *SearchLogic
    adminPool  database.AdminDatabaseConnector
    tenantPool database.TenantDatabaseConnector
}

func (s *SearchServiceConnect) Search(
    ctx context.Context,
    req *connect.Request[rpcv1.SearchRequest],
) (*connect.Response[rpcv1.SearchResponse], error) {
    // Extract auth context
    orgID := interceptor.GetOrganizationID(ctx)
    employeeID := interceptor.GetEmployeeID(ctx)
    
    // Use TenantPool (read-only, no transaction needed)
    results, err := s.logic.SearchMessages(ctx, s.tenantPool, orgID, employeeID, req.Msg.Query)
    if err != nil {
        return nil, connect.NewError(connect.CodeInternal, err)
    }
    
    return connect.NewResponse(&rpcv1.SearchResponse{
        Results: convertToProto(results),
    }), nil
}
```

### 4.2 Cross-Domain Dependencies

**SearchLogic depends on**:
- `chat.ChannelLogic.CheckChannelAccess(ctx, tx, employeeID, channelID) bool`
- `organization.EmployeeLogic.IsActive(ctx, tx, orgID, employeeID) bool`

**Initialization** (in `backend/cmd/server.go`):
```go
// 1. Initialize logic layers first
chatLogic := chat.NewChatLogic(queries, ...)
orgLogic := organization.NewOrganizationLogic(queries, ...)

linguaDetector := lingua.NewLanguageDetectorBuilder().
    FromLanguages(...).Build()

searchLogic := search.NewSearchLogic(queries, chatLogic, orgLogic, linguaDetector)

// 2. Wrap with connect layers
searchConnect := search.NewSearchServiceConnect(searchLogic, adminPool, tenantPool)

// 3. Register RPC handler
mux.Handle(rpcv1connect.NewSearchServiceHandler(searchConnect, interceptors...))
```

---

## 5. Permission Filtering Strategy

### 5.1 Channel Access Control

**Problem**: Users should only see messages from channels they have access to

**Solution**: Post-query filtering using existing ChannelLogic

```go
func (l *SearchLogic) filterByChannelAccess(
    ctx context.Context,
    tx database.DBTX,
    employeeID dbuuid.UUID,
    results []MessageResult,
) []MessageResult {
    // 1. Extract unique channel IDs
    channelIDs := extractChannelIDs(results)
    
    // 2. Batch check permissions
    accessibleChannels := make(map[dbuuid.UUID]bool)
    for _, channelID := range channelIDs {
        hasAccess := l.channelLogic.CheckChannelAccess(ctx, tx, employeeID, channelID)
        accessibleChannels[channelID] = hasAccess
    }
    
    // 3. Filter results
    filtered := make([]MessageResult, 0, len(results))
    for _, result := range results {
        if accessibleChannels[result.ChannelID] {
            filtered = append(filtered, result)
        }
    }
    
    return filtered
}
```

**Performance**:
- Batch permission checks (not N+1 queries)
- Caches results for same channel
- Acceptable overhead: <50ms for 20 results

---

## 6. Frontend Implementation

### 6.1 Global Search Bar Component

**Location**: `frontend/apps/web/src/app/workspace/components/GlobalSearchBar.tsx`

**Integration**:
```tsx
// workspace/layout.tsx
import { GlobalSearchBar } from './components/GlobalSearchBar';

export default function WorkspaceLayout({ children }) {
  return (
    <Box>
      <AppBar>
        <Toolbar>
          <Logo />
          <GlobalSearchBar />  {/* Add here */}
          <UserMenu />
        </Toolbar>
      </AppBar>
      {children}
    </Box>
  );
}
```

**Component Design**:
```tsx
// GlobalSearchBar.tsx
import { Autocomplete, TextField } from '@mui/material';
import { useDebounce } from 'use-debounce';

export function GlobalSearchBar() {
  const [query, setQuery] = useState('');
  const [debouncedQuery] = useDebounce(query, 300);
  const [options, setOptions] = useState([]);
  
  useEffect(() => {
    if (debouncedQuery.length >= 2) {
      searchAPI.autocomplete(debouncedQuery).then(setOptions);
    }
  }, [debouncedQuery]);
  
  return (
    <Autocomplete
      freeSolo
      options={options}
      onInputChange={(e, value) => setQuery(value)}
      renderInput={(params) => (
        <TextField {...params} placeholder="Search..." />
      )}
      renderOption={(props, option) => (
        <SearchResultItem {...props} result={option} />
      )}
    />
  );
}
```

**Keyboard Shortcut**: Cmd+K / Ctrl+K to focus search bar

### 6.2 Search Results Page

**Route**: `/workspace/search?q=budget&category=messages`

**Layout**:
```
┌────────────────────────────────────────┐
│ Search: "budget"                  [X]  │
├────────────────────────────────────────┤
│ [All] [Users] [Departments] [Channels] │
│ [Messages] ← Active Tab                │
├────────────────────────────────────────┤
│ 📝 #finance • 2 hours ago              │
│ Q4 <b>budget</b> discussion needed     │
│ We should finalize the <b>budget</b>   │
│ John Smith                             │
├────────────────────────────────────────┤
│ 📝 #operations • 1 day ago             │
│ Updated <b>budget</b> spreadsheet      │
│ Jane Doe                               │
└────────────────────────────────────────┘
```

**Component Structure**:
- `page.tsx`: Main search page with category tabs
- `SearchResultsList.tsx`: Results list component
- `SearchResultItem.tsx`: Individual result card (polymorphic by entity type)

---

## 7. Performance Optimization

### 7.1 Query Performance

**Indexes**:
```sql
-- FTS indexes
CREATE INDEX idx_message_content_fts ON chat.message USING GIN(content_tsv);

-- Composite for filtered search
CREATE INDEX idx_message_org_lang_fts ON chat.message(organization_id, language) 
    INCLUDE (content_tsv);

-- Trigram indexes for short content
CREATE INDEX idx_employee_name_trgm ON organization.employee USING GIN(given_name gin_trgm_ops);
```

**Query Optimization**:
- Use `plainto_tsquery()` for simple user queries (handles special chars)
- Use `websearch_to_tsquery()` for advanced syntax ("exact phrase", -exclude)
- Limit results to 20 per category (pagination if needed)

**Expected Performance**:
- Message FTS search: <500ms (1M messages)
- Name trigram search: <100ms (10K users)
- Combined (parallel): <1s total

### 7.2 Indexing Performance

**Trigger Overhead**:
- tsvector generation: ~2-5ms per message
- GIN index update: ~3-5ms per message
- Total: ~5-10ms overhead on INSERT/UPDATE

**Acceptable**: User message posting is already ~50-100ms (DB write + notifications)

---

## 8. Testing Strategy

### 8.1 Language Detection Tests

```go
func TestLanguageDetection(t *testing.T) {
    detector := initDetector()
    
    tests := []struct {
        input    string
        expected string
    }{
        {"Hello world", "en"},
        {"Hola mundo", "es"},
        {"你好世界", "zh"},
        {"こんにちは", "ja"},
        // ... all 9 languages
    }
    
    for _, tt := range tests {
        result := detectLanguage(detector, tt.input)
        assert.Equal(t, tt.expected, result)
    }
}
```

### 8.2 FTS Integration Tests

```go
func TestMessageSearch(t *testing.T) {
    // Setup: Insert messages in multiple languages
    insertMessage(t, "Budget meeting tomorrow", "en")
    insertMessage(t, "Reunión de presupuesto mañana", "es")
    
    // Test: English search
    results := searchMessages(t, "budget", "en")
    assert.Len(t, results, 2) // Should find both (fallback to all languages)
    
    // Verify highlighting
    assert.Contains(t, results[0].Snippet, "<b>Budget</b>")
}
```

### 8.3 Permission Tests

```go
func TestSearchPermissions(t *testing.T) {
    // Setup: User A creates private channel with message
    channelID := createPrivateChannel(t, userA)
    insertMessage(t, channelID, "Secret budget")
    
    // Test: User B searches for "budget"
    results := searchMessages(t, userB, "budget")
    
    // Assert: User B should NOT see private channel message
    assert.Len(t, results, 0)
}
```

---

## 9. Deployment & Infrastructure

### 9.1 PostgreSQL Extension Installation

**Required Extensions**:
1. **pg_trgm**: Already installed ✅
2. **unaccent**: Likely already installed ✅
3. **zhparser**: NEEDS INSTALLATION for Chinese
4. **pg_bigm**: NEEDS INSTALLATION for Japanese

**Installation in StackGres/Kubernetes**:

```yaml
# k8s/base/postgres/stackgres-cluster.yaml
apiVersion: stackgres.io/v1
kind: SGCluster
metadata:
  name: techoffice-postgres
spec:
  postgres:
    extensions:
      - name: pg_trgm
      - name: unaccent
      - name: zhparser       # Add this
        version: "2.2"
      - name: pg_bigm         # Add this
        version: "1.2"
```

**Database Migration**:
```sql
-- Run in migration
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS zhparser;
CREATE EXTENSION IF NOT EXISTS pg_bigm;
```

### 9.2 Rollout Plan

**Phase 1: Development Environment**
1. Install extensions in dev Postgres
2. Run migrations (add columns, indexes, triggers)
3. Deploy backend with lingua-go
4. Test all 9 languages manually

**Phase 2: Staging Validation**
1. Load test with 1M messages
2. Verify <2s p95 latency
3. Test concurrent searches (1000 users)

**Phase 3: Production Rollout**
1. Install extensions during maintenance window
2. Run migrations (no downtime - adds columns, not modifies)
3. Deploy backend
4. Deploy frontend
5. Monitor performance and errors

---

## 10. Alternatives Considered & Rejected

### 10.1 Elasticsearch / OpenSearch

**Rejected**: Violates NFR-001 (no separate search infrastructure)

**Pros**:
- Advanced relevance algorithms
- Rich query DSL
- Faceted search, aggregations
- Optimized for search workloads

**Cons**:
- Operational complexity (new service to manage)
- Data synchronization lag and consistency issues
- Additional infrastructure cost
- Network latency to external service
- Multi-tenant isolation complexity

### 10.2 Materialized View for Unified Search

**Rejected**: Adds complexity without clear benefit

**Pros**:
- Centralized search view
- Could denormalize data

**Cons**:
- Refresh lag (not real-time)
- Refresh job maintenance
- Duplicate storage
- Complex refresh triggers

**Decision**: Query source tables directly with FTS indexes

### 10.3 Client-Side Search

**Rejected**: Not scalable for 1M messages

**Pros**:
- Instant results
- No backend changes

**Cons**:
- Must load all data to client (impractical)
- No server-side permission enforcement
- Poor performance on large datasets
- High bandwidth usage

---

## 11. Open Questions & Decisions

### 11.1 Resolved

✅ **Search technology**: PostgreSQL FTS for messages, pg_trgm for names  
✅ **Language detection**: lingua-go library  
✅ **Indexing strategy**: Trigger-managed single tsvector  
✅ **Permission filtering**: Post-query with ChannelLogic  
✅ **Real-time updates**: Triggers (no batch jobs)  
✅ **Multi-tenant isolation**: organization_id filtering  

### 11.2 For Phase 1 (Design)

🔧 **Japanese tokenization**: Decide between pg_bigm vs pgroonga  
🔧 **Hindi support**: Validate `simple` config performance  
🔧 **Highlight parameters**: Tune ts_headline MaxWords, MinWords  
🔧 **Index size estimation**: Calculate disk space for 1M messages  
🔧 **Concurrent search limits**: Define rate limiting strategy  

---

## 12. Technology Choices Summary

| Component | Technology | Justification |
|-----------|------------|---------------|
| **Message Search** | PostgreSQL FTS | Native, language-aware, better than pg_trgm for long content |
| **Name Search** | pg_trgm | Excellent for fuzzy matching on short fields |
| **Language Detection** | lingua-go | Accurate, fast, pure Go |
| **Chinese Support** | zhparser extension | Industry standard for Mandarin |
| **Japanese Support** | pg_bigm or pgroonga | TBD in Phase 1 design |
| **Index Strategy** | Single tsvector + trigger | Flexible, performant, maintainable |
| **Permission Filter** | Application-level | Reuses existing logic, observable |
| **Frontend Search** | MUI Autocomplete | Consistent with existing UI |
| **Search Results** | Dedicated page + tabs | Clear UX, extensible |

---

## 13. Success Criteria

**Functional**:
✅ Search works accurately for all 9 languages  
✅ Fuzzy matching on short fields (names, emails, departments, channels)  
✅ Full-text search on messages with highlighted snippets  
✅ Permission filtering (private channels respected)  
✅ Real-time indexing (deleted messages removed immediately via triggers)  

**Performance**:
✅ <2s p95 latency for search queries  
✅ <5% system overhead from search operations  
✅ Support 1000 concurrent users  

**Operational**:
✅ No external dependencies (PostgreSQL-native)  
✅ Observable (structured logging with slog)  
✅ Maintainable (clear service boundaries, two-layer architecture)  

---

**Research Status**: ✅ **COMPLETE** - Ready for Phase 1 (Design & Contracts)

**Next Steps**:
1. Proceed to Phase 1: Design data model and RPC contracts
2. Create sqlc queries for search operations
3. Design search service architecture
4. Create protobuf definitions for Search RPC
