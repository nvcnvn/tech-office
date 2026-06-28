# Quickstart: Global Multilingual Fuzzy Search System

**Date**: 2025-11-01  
**Purpose**: Manual test scenarios and acceptance validation

---

## Prerequisites

### Environment Setup
- PostgreSQL 16+ with Citus extension
- `pg_trgm` extension enabled
- Backend service running (`localhost:18080`)
- Frontend dev server running (`localhost:13000`)
- Test organization with sample data

### Test Data Preparation

```sql
-- Create test organization
INSERT INTO public.organization (id, company_name, subdomain, project_id, app_id, status)
VALUES (
    '01933e8a-8b2e-7000-a000-000000000001',
    'ACME Corp',
    'acme',
    '01933e8a-8b2e-7000-a000-000000000002',
    '01933e8a-8b2e-7000-a000-000000000003',
    'active'
);

-- Create test users
INSERT INTO iam.identity (id, organization_id, email, identity_type) VALUES
    ('01933e8a-8b2e-7000-a000-000000000101', '01933e8a-8b2e-7000-a000-000000000001', 'john.smith@acme.com', 'human'),
    ('01933e8a-8b2e-7000-a000-000000000102', '01933e8a-8b2e-7000-a000-000000000001', 'maria.garcia@acme.com', 'human'),
    ('01933e8a-8b2e-7000-a000-000000000103', '01933e8a-8b2e-7000-a000-000000000001', '田中太郎@acme.com', 'human');

INSERT INTO organization.employee (id, organization_id, given_name, family_name, is_active) VALUES
    ('01933e8a-8b2e-7000-a000-000000000101', '01933e8a-8b2e-7000-a000-000000000001', 'John', 'Smith', true),
    ('01933e8a-8b2e-7000-a000-000000000102', '01933e8a-8b2e-7000-a000-000000000001', 'Maria', 'Garcia', true),
    ('01933e8a-8b2e-7000-a000-000000000103', '01933e8a-8b2e-7000-a000-000000000001', '太郎', '田中', true);

-- Create test departments
INSERT INTO organization.department (id, organization_id, name, description) VALUES
    ('01933e8a-8b2e-7000-a000-000000000201', '01933e8a-8b2e-7000-a000-000000000001', 'Engineering', 'Software development team'),
    ('01933e8a-8b2e-7000-a000-000000000202', '01933e8a-8b2e-7000-a000-000000000001', 'Marketing', 'Marketing and sales team'),
    ('01933e8a-8b2e-7000-a000-000000000203', '01933e8a-8b2e-7000-a000-000000000001', '営業部', 'Sales department in Japan');

-- Create test channels
INSERT INTO chat.channel (id, organization_id, title_slug, display_name, description, is_private, created_by_employee_id) VALUES
    ('01933e8a-8b2e-7000-a000-000000000301', '01933e8a-8b2e-7000-a000-000000000001', 'general', 'General', 'General discussion', false, '01933e8a-8b2e-7000-a000-000000000101'),
    ('01933e8a-8b2e-7000-a000-000000000302', '01933e8a-8b2e-7000-a000-000000000001', 'engineering-team', 'Engineering Team', 'Private engineering channel', true, '01933e8a-8b2e-7000-a000-000000000101');

-- Add channel membership (for permission testing)
INSERT INTO chat.channel_membership (id, organization_id, channel_id, employee_id, is_admin) VALUES
    ('01933e8a-8b2e-7000-a000-000000000401', '01933e8a-8b2e-7000-a000-000000000001', '01933e8a-8b2e-7000-a000-000000000302', '01933e8a-8b2e-7000-a000-000000000101', true),
    ('01933e8a-8b2e-7000-a000-000000000402', '01933e8a-8b2e-7000-a000-000000000001', '01933e8a-8b2e-7000-a000-000000000302', '01933e8a-8b2e-7000-a000-000000000103', false);

-- Create test messages
INSERT INTO chat.message (id, organization_id, channel_id, content, author_employee_id) VALUES
    ('01933e8a-8b2e-7000-a000-000000000501', '01933e8a-8b2e-7000-a000-000000000001', '01933e8a-8b2e-7000-a000-000000000301', 'We need to discuss Q4 budget planning for marketing initiatives', '01933e8a-8b2e-7000-a000-000000000102'),
    ('01933e8a-8b2e-7000-a000-000000000502', '01933e8a-8b2e-7000-a000-a000-000000000001', '01933e8a-8b2e-7000-a000-000000000302', 'Code review needed for the authentication module', '01933e8a-8b2e-7000-a000-000000000101'),
    ('01933e8a-8b2e-7000-a000-000000000503', '01933e8a-8b2e-7000-a000-000000000001', '01933e8a-8b2e-7000-a000-000000000301', '営業部の四半期目標について相談したいです', '01933e8a-8b2e-7000-a000-000000000103');

-- No refresh needed! Trigram indexes work immediately on source tables.
```

---

## Test Scenarios

### Scenario 1: Federated Search - All Categories

**Use Case**: User searches for "eng" expecting results across users, departments, and channels. Frontend calls domain-owned search methods in parallel.

**Architecture**: Domain-owned search
- **OrganizationService**: SearchEmployees, SearchDepartments
- **ChatService**: SearchChannels, SearchMessages
- **Frontend**: Promise.all aggregation

**Steps**:
1. Log in as John Smith (`john.smith@acme.com`)
2. Type "eng" in global search bar
3. Frontend calls OrganizationService.SearchEmployees, OrganizationService.SearchDepartments, ChatService.SearchChannels, ChatService.SearchMessages in parallel (Promise.all)
4. Observe results

**Expected Results**:
- **Users**: None (no users with "eng" in name/email)
- **Departments**: "Engineering" department
- **Channels**: "Engineering Team" channel (if John has access)
- **Messages**: "Code review needed for the authentication module" (contains "eng")

**Acceptance Criteria**:
- ✅ Results appear within 2 seconds
- ✅ Results grouped by entity type
- ✅ Relevance ranking: exact match > partial match
- ✅ All entity types displayed

**Manual Verification**:
```bash
# Test domain-owned search endpoints

# OrganizationService - Search employees
curl -X POST http://localhost:18080/rpc.v1.OrganizationService/SearchEmployees \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text": "eng", "limit": 50}'

# OrganizationService - Search departments
curl -X POST http://localhost:18080/rpc.v1.OrganizationService/SearchDepartments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text": "eng", "limit": 50}'

# ChatService - Search channels
curl -X POST http://localhost:18080/rpc.v1.ChatService/SearchChannels \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text": "eng", "limit": 50}'

# ChatService - Search messages
curl -X POST http://localhost:18080/rpc.v1.ChatService/SearchMessages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text": "eng", "limit": 50}'
```

---

### Scenario 2: Entity-Specific Search (Messages Only)

**Use Case**: User searches for "Q4" in messages only.

**Steps**:
1. Log in as Maria Garcia
2. Type "Q4" in search
3. Frontend calls ChatService.SearchMessages API only (not other entities)
4. Observe results

**Expected Results**:
- **Messages only**: "We need to discuss Q4 budget planning for marketing initiatives"
- **No users, departments, or channels** (frontend didn't call those APIs)

**Acceptance Criteria**:
- ✅ Only message results shown
- ✅ Message preview includes context (sender, channel, timestamp)
- ✅ Clicking result navigates to message in channel

**Manual Verification**:
```bash
# ChatService - Search messages only
curl -X POST http://localhost:18080/rpc.v1.ChatService/SearchMessages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text": "Q4", "limit": 50}'
```

---

### Scenario 3: Multilingual Search (Japanese)

**Use Case**: User searches using Japanese characters.

**Steps**:
1. Log in as 田中太郎
2. Type "営業" (sales) in global search
3. Observe results

**Expected Results**:
- **Departments**: "営業部" (Sales Department)
- **Messages**: "営業部の四半期目標について相談したいです"
- **Users**: "田中太郎" (if name contains matching characters)

**Acceptance Criteria**:
- ✅ CJK characters handled correctly
- ✅ Results display Japanese text without garbling
- ✅ Relevance ranking works for non-Latin scripts

**Manual Verification**:
```bash
# OrganizationService - Search departments with Japanese
curl -X POST http://localhost:18080/rpc.v1.OrganizationService/SearchDepartments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text": "営業", "limit": 50}'

# ChatService - Search messages with Japanese
curl -X POST http://localhost:18080/rpc.v1.ChatService/SearchMessages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text": "営業", "limit": 50}'
```

---

### Scenario 4: Fuzzy Matching (Typo Tolerance)

**Use Case**: User types "jhon" (typo) instead of "john".

**Steps**:
1. Log in as admin user
2. Type "jhon" in global search
3. Observe results

**Expected Results**:
- **Users**: "John Smith" (fuzzy match via trigram similarity)
- **Relevance score**: Lower than exact match but still returned

**Acceptance Criteria**:
- ✅ Results include "John Smith" despite typo
- ✅ Fuzzy match ranked lower than exact matches
- ✅ No error or "no results" message

**Manual Verification**:
```bash
# OrganizationService - Test fuzzy matching with typo
curl -X POST http://localhost:18080/rpc.v1.OrganizationService/SearchEmployees \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text": "jhon", "limit": 50}'
```

---

### Scenario 5: Permission Filtering (Private Channel)

**Use Case**: User without access to private channel should not see results from it.

**Steps**:
1. Log in as Maria Garcia (NOT a member of "Engineering Team" private channel)
2. Search for "authentication module"
3. Observe results

**Expected Results**:
- **Messages**: NO results (message is in private channel)
- Maria Garcia should NOT see: "Code review needed for the authentication module"

**Acceptance Criteria**:
- ✅ Private channel messages hidden from non-members
- ✅ No error message (silent filtering)
- ✅ Other public results still displayed

**Contrast Test**:
1. Log in as John Smith (member of private channel)
2. Search for "authentication module"
3. **Expected**: Message appears in results

**Manual Verification**:
```bash
# ChatService - As Maria (no access to private channel)
curl -X POST http://localhost:18080/rpc.v1.ChatService/SearchMessages \
  -H "Authorization: Bearer $MARIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text": "authentication", "limit": 50}'

# ChatService - As John (has access to private channel)
curl -X POST http://localhost:18080/rpc.v1.ChatService/SearchMessages \
  -H "Authorization: Bearer $JOHN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text": "authentication", "limit": 50}'
```

---

### Scenario 6: Autocomplete for User Selection

**Use Case**: User is adding member to channel, types "mar" for autocomplete.

**Steps**:
1. Open "Add member to channel" form
2. Type "mar" in member selection input
3. Observe autocomplete suggestions

**Expected Results**:
- **Users**: "Maria Garcia"
- **Suggestions limited to**: Users only (no departments/channels)
- **Ranking**: Shortest match first ("Maria" before longer names)

**Acceptance Criteria**:
- ✅ Suggestions appear instantly (<500ms)
- ✅ Max 10 suggestions
- ✅ Only users returned (no departments)
- ✅ Clicking suggestion populates form field

**Manual Verification**:
```bash
# OrganizationService - Autocomplete employees
curl -X POST http://localhost:18080/rpc.v1.OrganizationService/AutocompleteEmployees \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "mar", "limit": 10}'
```

---

### Scenario 7: Deleted Entity Real-Time Removal

**Use Case**: Deleted entities should NOT appear in search immediately (real-time).

**Steps**:
1. Search for "Marketing" department (should appear)
2. Soft-delete "Marketing" department (DELETE or set tombstone flag)
3. Search for "Marketing" again immediately

**Expected Results**:
- **Before deletion**: "Marketing" department appears
- **After deletion**: "Marketing" department does NOT appear immediately
- **No staleness**: Real-time results (no 5-minute delay)

**Acceptance Criteria**:
- ✅ Deleted entity removed from search immediately
- ✅ No refresh lag or background job delay
- ✅ No stale results

**Manual Verification**:
```sql
-- Simulate deletion
DELETE FROM organization.department 
WHERE id = '01933e8a-8b2e-7000-a000-000000000202';

-- Search immediately (should not appear)
```

```bash
# OrganizationService - Search departments (should not appear after deletion)
curl -X POST http://localhost:18080/rpc.v1.OrganizationService/SearchDepartments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text": "Marketing", "limit": 50}'
```

---

### Scenario 8: Multi-Tenant Isolation

**Use Case**: User from Org A should NOT see results from Org B.

**Steps**:
1. Create second test organization (Org B) with similar data
2. Log in as user from Org A
3. Search for entity that exists in Org B (same name)
4. Observe results

**Expected Results**:
- **Results**: Only entities from Org A
- **No leakage**: No results from Org B despite same name

**Acceptance Criteria**:
- ✅ Complete tenant isolation
- ✅ organization_id filter always applied
- ✅ No cross-tenant data leakage

**Manual Verification**:
```sql
-- Create Org B with duplicate data
INSERT INTO public.organization VALUES (...);
INSERT INTO organization.employee VALUES (...); -- Same name as Org A user

-- No refresh needed - queries filter by organization_id automatically

-- Search as Org A user (should NOT see Org B results)
```

---

### Scenario 9: Performance Under Load

**Use Case**: System handles 1000 concurrent searches without degradation.

**Steps**:
1. Use load testing tool (e.g., `hey`, `ab`, `k6`)
2. Simulate 1000 concurrent users performing searches
3. Measure P95 latency

**Expected Results**:
- **P50 latency**: <500ms
- **P95 latency**: <2 seconds
- **Error rate**: <1%
- **System impact**: <5% increase in overall latency

**Acceptance Criteria**:
- ✅ P95 latency meets target
- ✅ No timeout errors
- ✅ Database connection pool stable
- ✅ No significant impact on other services

**Manual Verification**:
```bash
# Load test OrganizationService.SearchEmployees with 1000 requests, 100 concurrent
hey -n 1000 -c 100 -m POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text":"engineering","limit":50}' \
  http://localhost:18080/rpc.v1.OrganizationService/SearchEmployees
```

---

### Scenario 10: Empty Query Handling

**Use Case**: User submits empty or whitespace-only query.

**Steps**:
1. Type spaces or empty string in search bar
2. Submit search

**Expected Results**:
- **Option A**: Show recent/popular items
- **Option B**: Show "start typing to search" message
- **Option C**: No results, clear message

**Acceptance Criteria**:
- ✅ No error or crash
- ✅ Graceful handling
- ✅ Clear user feedback

**Manual Verification**:
```bash
# OrganizationService - Test empty query handling
curl -X POST http://localhost:18080/rpc.v1.OrganizationService/SearchEmployees \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query_text":"   ","limit":50}'
```

---

## Validation Checklist

### Functional Requirements
- [ ] FR-001: Global search bar visible on all workspace pages
- [ ] FR-002: Accepts input in any language/script (Latin, CJK, Cyrillic)
- [ ] FR-003: Real-time suggestions as user types
- [ ] FR-004: Unified search across all categories
- [ ] FR-005: Category filtering works (Users, Departments, Channels, Messages)
- [ ] FR-006: Short-form content searchable (users, departments, channels)
- [ ] FR-007: Long-form content searchable (messages)
- [ ] FR-009: Autocomplete works for form inputs
- [ ] FR-010: Fuzzy matching handles typos
- [ ] FR-011: Multilingual full-text search works
- [ ] FR-012: Relevance ranking correct (exact > prefix > fuzzy)
- [ ] FR-013: Results show context (sender, timestamp for messages)
- [ ] FR-014: Permission filtering enforced
- [ ] FR-019: Deleted entities removed within 5 minutes

### Non-Functional Requirements
- [ ] NFR-001: No external search infrastructure required
- [ ] Performance: P95 latency <2 seconds
- [ ] Scalability: Handles 1000 concurrent users
- [ ] Security: Multi-tenant isolation verified
- [ ] Observability: Search queries logged with metrics

### Edge Cases
- [ ] Empty/whitespace queries handled gracefully
- [ ] Very long queries (>200 chars) handled
- [ ] Special characters and emojis work
- [ ] Mixed-language queries work
- [ ] Permission changes reflected within 5 minutes

---

## Performance Monitoring

### Metrics to Track
```sql
-- Query performance by domain service
-- (Add structured logging in OrganizationService and ChatService)
SELECT 
    service_name, -- 'OrganizationService' or 'ChatService'
    method_name, -- 'SearchEmployees', 'SearchDepartments', etc.
    avg(query_duration_ms) as avg_latency_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY query_duration_ms) as p95_latency_ms,
    count(*) as query_count
FROM search_logs
WHERE timestamp > now() - interval '1 hour'
GROUP BY service_name, method_name
ORDER BY query_count DESC;

-- Trigram index size monitoring
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE indexname LIKE '%_search_trgm'
ORDER BY schemaname, tablename;

-- Table sizes with indexes
SELECT 
    schemaname || '.' || tablename as table_name,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size
FROM pg_tables
WHERE schemaname IN ('organization', 'chat')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Alerts to Configure
- 🚨 P95 latency >2 seconds per domain service method
- 🚨 Search error rate >5%
- 🚨 Trigram index size growth >10% per day
- 🚨 Database connection pool exhaustion

---

## Troubleshooting

### Issue: Slow queries
**Diagnosis**:
```sql
EXPLAIN ANALYZE SELECT ... FROM search.search_index WHERE ...;
```

**Solutions**:
- Check index usage (`Seq Scan` = bad, `Bitmap Index Scan` = good)
- Increase `shared_buffers` if index doesn't fit in memory
- Tune `pg_trgm.similarity_threshold`

### Issue: Stale results
**Not applicable**: Direct table search provides real-time results. No materialized view to refresh.

### Issue: Permission filtering not working
**Diagnosis**:
Test permission logic for private channels:
```sql
-- Check channel membership
SELECT * FROM chat.channel_membership 
WHERE channel_id = '...' AND employee_id = '...';

-- Verify channel is_private flag
SELECT id, display_name, is_private 
FROM chat.channel 
WHERE id = '...';
```

**Solutions**:
- Verify channel membership records exist in `chat.channel_membership`
- Check `is_private` flag on channels
- Review permission filtering logic in SQL queries (EXISTS clause)
- Test with different user tokens (member vs non-member)

---

## Success Criteria Summary

✅ **Functional**: All search scenarios pass  
✅ **Performance**: P95 latency <2 seconds, 1000 concurrent users  
✅ **Security**: Multi-tenant isolation, permission filtering verified  
✅ **Multilingual**: CJK and Latin scripts work correctly  
✅ **Fuzzy**: Typo tolerance demonstrated  
✅ **Observability**: Metrics logged, alerts configured  

---

## Next Steps After Validation

1. **Production Deployment**:
   - Run database migration to add trigram indexes
   - Deploy backend services with new search methods (OrganizationService, ChatService)
   - Deploy frontend with search UI
   - Monitor performance for 1 week

2. **Iteration**:
   - Collect user feedback on search relevance
   - Tune `pg_trgm.similarity_threshold` based on false positive/negative rates
   - Monitor trigram index sizes and consider table partitioning if needed
   - Add more entity types (projects, documents) to domain services as needed

3. **Future Enhancements**:
   - Real-time indexing (trigger-based)
   - Personalized ranking
   - Search analytics dashboard
   - Saved searches
