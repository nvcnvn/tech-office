# Tasks: Global Multilingual Fuzzy Search System

**Feature**: 011-global-multilingual-fuzzy-search-system  
**Input**: Design documents from `/Users/nvcnvn/Codes/tech-office/specs/011-global-multilingual-fuzzy-search-system/`  
**Prerequisites**: plan.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

---

## Execution Flow
This task list follows the TDD workflow with post-verification testing (Constitution v5.0.0):
1. Setup: Database schema with FTS + pg_trgm, extensions, dependencies
2. Core: Domain-owned search methods (Logic + Connect layers)
3. Verification: Manual testing with quickstart.md scenarios ⚠️ REQUIRED GATE
4. Tests: Add tests ONLY after manual verification confirms correct behavior
5. Polish: Performance tuning, documentation

**Key Design Decision**: Simplified approach using PGroonga:
- **PGroonga** for chat messages (automatic multilingual support, no language detection needed)
- **pg_trgm** for short fields (names, emails) where fuzzy matching excels
- **No language detection**: PGroonga handles all languages automatically
- **Domain-owned search**: Extend existing services, no new search service

---

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- File paths are absolute for clarity

---

## Phase 3.1: Database Schema & Extensions Setup

### PostgreSQL Extensions
- [X] T001 Install PostgreSQL extensions in `backend/docker/9999-init.sql`:
  - `CREATE EXTENSION IF NOT EXISTS pg_trgm;` (already present)
  - `CREATE EXTENSION IF NOT EXISTS unaccent;`
  - `CREATE EXTENSION IF NOT EXISTS pgroonga;` (automatic multilingual FTS)
  - Note: PGroonga handles all languages automatically without separate tokenizers

### Schema Changes - chat.message (PGroonga)
- [X] T002 Create PGroonga index on `chat.message` in `backend/database/scripts/schema.sql`:
  ```sql
  -- PGroonga index for multilingual full-text search
  CREATE INDEX IF NOT EXISTS idx_message_pgroonga 
      ON chat.message 
      USING pgroonga (content);
  ```
  - No language detection column needed (PGroonga handles automatically)
  - No tsvector column needed (PGroonga manages its own index)
  - No trigger function needed (PGroonga updates automatically)

### Schema Changes - Short Fields (pg_trgm)
- [X] T006 [P] Create trigram indexes on `organization.employee` in `backend/database/scripts/schema.sql`:
  ```sql
  CREATE INDEX CONCURRENTLY idx_employee_given_name_trgm 
    ON organization.employee USING GIN(given_name gin_trgm_ops);
  
  CREATE INDEX CONCURRENTLY idx_employee_family_name_trgm 
    ON organization.employee USING GIN(family_name gin_trgm_ops);
  
  CREATE INDEX CONCURRENTLY idx_employee_email_trgm 
    ON organization.employee USING GIN(email gin_trgm_ops);
  ```

- [X] T007 [P] Create trigram index on `organization.department` in `backend/database/scripts/schema.sql`:
  ```sql
  CREATE INDEX CONCURRENTLY idx_department_name_trgm 
    ON organization.department USING GIN(name gin_trgm_ops);
  ```

- [X] T008 [P] Create trigram index on `chat.channel` in `backend/database/scripts/schema.sql`:
  ```sql
  CREATE INDEX CONCURRENTLY idx_channel_name_trgm 
    ON chat.channel USING GIN(display_name gin_trgm_ops);
  ```

### Database Migration
- [X] T009 Run Atlas migration (depends on T002-T008):
  ```bash
  source .env && cd backend && ./scripts/atlas/01_migration_create.sh "add-multilingual-search-fts-and-trigram" && ./scripts/atlas/02_migrate_apply.sh
  ```

---

## Phase 3.2: Backend Dependencies & Code Generation

### Go Dependencies
- [X] T010 ~~Add lingua-go dependency~~ (NOT NEEDED - PGroonga handles language detection automatically)

### sqlc Queries - Organization Domain
- [X] T011 Add employee search queries to `backend/database/scripts/organization.query.sql`:
  - `SearchEmployees` (pg_trgm fuzzy match on email + names with cursor pagination)
  - `AutocompleteEmployees` (prefix match, limit 10)
  - Use `sqlc.narg('cursor')::UUID` for nullable cursor parameter
  - Filter by `organization_id` and `is_active = true`

- [X] T012 Add department search queries to `backend/database/scripts/organization.query.sql`:
  - `SearchDepartments` (pg_trgm fuzzy match on name + description with cursor pagination)
  - `AutocompleteDepartments` (prefix match, limit 10)
  - Use `sqlc.narg('cursor')::UUID` for nullable cursor parameter
  - Filter by `organization_id`

### sqlc Queries - Chat Domain
- [X] T013 Add channel search queries to `backend/database/scripts/chat.query.sql`:
  - `SearchChannels` (pg_trgm fuzzy match with permission filtering: public OR member)
  - `AutocompleteChannels` (prefix match with permission filtering, limit 10)
  - Use `sqlc.narg('cursor')::UUID` for nullable cursor parameter
  - Filter by `organization_id`, `is_archived = false`, and permission check

- [X] T014 Add message search queries to `backend/database/scripts/chat.query.sql`:
  - `SearchMessages` (PGroonga FTS with `pgroonga_score()` for relevance, `pgroonga_snippet_html()` for snippets)
  - Include JOIN to `chat.channel` for permission check and channel metadata
  - Use `&@~` operator for PGroonga full-text search
  - Use `sqlc.narg('cursor')::UUID` for nullable cursor parameter
  - Filter by `organization_id`, `is_deleted = false`, and permission check
  - Return: content, author, channel context, relevance score, highlighted snippet

### sqlc Code Generation
- [X] T015 Generate sqlc code (depends on T011-T014):
  ```bash
  cd backend && sqlc generate
  ```
  - Validates SQL syntax and generates type-safe Go code
  - Outputs: `backend/database/organization.query.sql.go` and `backend/database/chat.query.sql.go`
  - Commit generated files

---

## Phase 3.3: Protocol Buffer Contracts

### Proto Definitions - Organization Search
- [X] T016 Add search methods to `backend/rpc/v1/organization.proto`:
  - Method: `SearchEmployees(SearchEmployeesRequest) → SearchEmployeesResponse`
  - Method: `AutocompleteEmployees(AutocompleteEmployeesRequest) → AutocompleteEmployeesResponse`
  - Method: `SearchDepartments(SearchDepartmentsRequest) → SearchDepartmentsResponse`
  - Method: `AutocompleteDepartments(AutocompleteDepartmentsRequest) → AutocompleteDepartmentsResponse`
  - Copy message definitions from `contracts/organization-search.proto`
  - Add access control: `option (rpc.v1.access_control) = { requires_authentication: true };`

### Proto Definitions - Chat Search
- [X] T017 Add search methods to `backend/rpc/v1/chat.proto`:
  - Method: `SearchChannels(SearchChannelsRequest) → SearchChannelsResponse`
  - Method: `AutocompleteChannels(AutocompleteChannelsRequest) → AutocompleteChannelsResponse`
  - Method: `SearchMessages(SearchMessagesRequest) → SearchMessagesResponse`
  - Copy message definitions from `contracts/chat-search.proto`
  - Add access control: `option (rpc.v1.access_control) = { requires_authentication: true };`
  - Note: SearchMessagesResponse includes highlighted snippet from `pgroonga_snippet_html()`

### Protobuf Code Generation
- [X] T018 Generate protobuf code (depends on T016-T017):
  ```bash
  cd backend && buf generate
  ```
  - Generates Go and TypeScript code from proto definitions
  - Outputs: `backend/rpc/v1/*.pb.go` and `frontend/packages/rpc/rpc/v1/*_pb.ts`
  - Commit generated files

---

## Phase 3.4: Backend Implementation - Language Detection

### Lingua-go Detector Setup
- [X] T019 Create lingua-go detector singleton in `backend/internal/organization/language_detector.go`:
  - Initialize `lingua.NewLanguageDetectorBuilder()` with 9 supported languages
  - Function: `DetectLanguage(text string) string` returns ISO 639-1 code
  - Export singleton instance for reuse across packages
  - Add logging: `slog.Debug("language detected", "language", code, "textLength", len(text))`

---

## Phase 3.5: Backend Implementation - Organization Search (Logic Layer)

### Organization Logic Extensions
- [X] T020 Extend OrganizationLogic in `backend/internal/organization/logic.go`:
  - Add `SearchEmployees(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, queryText string, limit int32, cursor dbuuid.NullUUID) ([]*EmployeeSearchResult, dbuuid.UUID, error)`
  - Add `AutocompleteEmployees(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, prefix string, limit int32) ([]*EmployeeAutocompleteSuggestion, error)`
  - Add `SearchDepartments(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, queryText string, limit int32, cursor dbuuid.NullUUID) ([]*DepartmentSearchResult, dbuuid.UUID, error)`
  - Add `AutocompleteDepartments(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, prefix string, limit int32) ([]*DepartmentAutocompleteSuggestion, error)`
  - Use `sqlc.narg()` pattern for cursor: pass `cursor` directly to sqlc query
  - Return next cursor: if results < limit, return zero UUID; else return last result ID
  - Add structured logging with `slog.InfoContext(ctx, "searching employees", "orgID", orgID, "query", queryText)`

---

## Phase 3.6: Backend Implementation - Chat Search (Logic Layer)

### Chat Logic Extensions
- [X] T021 Extend ChatLogic in `backend/internal/chat/logic.go`:
  - Add `SearchChannels(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, employeeID dbuuid.UUID, queryText string, limit int32, cursor dbuuid.NullUUID) ([]*ChannelSearchResult, dbuuid.UUID, error)`
  - Add `AutocompleteChannels(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, employeeID dbuuid.UUID, prefix string, limit int32) ([]*ChannelAutocompleteSuggestion, error)`
  - Add `SearchMessages(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, employeeID dbuuid.UUID, queryText string, limit int32, cursor dbuuid.NullUUID) ([]*MessageSearchResult, dbuuid.UUID, error)`
  - Pass `employeeID` to sqlc queries for permission filtering
  - Use `sqlc.narg()` pattern for cursor
  - Return next cursor logic same as organization search
  - Add structured logging for FTS query performance

---

## Phase 3.7: Backend Implementation - Message Creation with Language Detection

### Integrate Language Detection
- [X] T022 Modify `CreateMessage` and `ReplyToMessage` in `backend/internal/chat/logic.go`:
  - Import language detector from `internal/organization/language_detector.go`
  - Detect language: `lang := organization.DetectLanguage(messageText)`
  - Add `language` field to `CreateMessage` sqlc params
  - Add logging: `slog.DebugContext(ctx, "detected language", "language", lang, "contentLength", len(messageText))`
  - Trigger will automatically populate `content_tsv` based on language

---

## Phase 3.8: Backend Implementation - Connect Layer

### Organization Connect Extensions
- [X] T023 Extend OrganizationServiceConnect in `backend/internal/organization/connect.go`:
  - Implement `SearchEmployees` RPC handler:
    - Extract `orgID` from auth context
    - Parse cursor string to `dbuuid.NullUUID` using `dbuuid.Parse()` (handle empty string → NULL)
    - Use TenantPool (read-only, can pass pool as DBTX without transaction)
    - Call `logic.SearchEmployees(ctx, tenantPool, orgID, req.QueryText, req.Limit, cursor)`
    - Convert results to protobuf `SearchEmployeesResponse`
    - Format next cursor as UUID string (if not zero UUID)
  - Implement `AutocompleteEmployees` RPC handler (similar pattern)
  - Implement `SearchDepartments` RPC handler (similar pattern)
  - Implement `AutocompleteDepartments` RPC handler (similar pattern)
  - Add error translation to `connect.Error`

### Chat Connect Extensions
- [X] T024 Extend ChatServiceConnect in `backend/internal/chat/connect.go`:
  - Implement `SearchChannels` RPC handler:
    - Extract `orgID` and `employeeID` from auth context
    - Parse cursor string to `dbuuid.NullUUID`
    - Use TenantPool (read-only, pass pool as DBTX)
    - Call `logic.SearchChannels(ctx, tenantPool, orgID, employeeID, req.QueryText, req.Limit, cursor)`
    - Convert results to protobuf `SearchChannelsResponse`
  - Implement `AutocompleteChannels` RPC handler (similar pattern)
  - Implement `SearchMessages` RPC handler:
    - Measure query duration for observability
    - Add `query_duration_ms` to response
    - Log: `slog.InfoContext(ctx, "message search completed", "duration_ms", duration, "resultCount", len(results))`

---

## Phase 3.9: Frontend - Package Updates & Code Generation

### Frontend RPC Package
- [X] T025 Re-export generated types from `frontend/packages/rpc/index.ts`:
  - Export search request/response types from `rpc/v1/organization_pb.ts`
  - Export search request/response types from `rpc/v1/chat_pb.ts`

- [X] T026 Build frontend RPC package (depends on T025):
  ```bash
  cd frontend && pnpm -r build
  ```

---

## Phase 3.10: Frontend - API Wrapper Layer

### TypeScript Types
- [X] T027 [P] Create search TypeScript types in `frontend/packages/apis/src/types/search.ts`:
  - Define custom interfaces (NOT protobuf types):
    * `EmployeeSearchResult`, `DepartmentSearchResult`, `ChannelSearchResult`, `MessageSearchResult`
    * `EmployeeSuggestion`, `DepartmentSuggestion`, `ChannelSuggestion`
  - Use JavaScript native types: `Date` (not `Timestamp`), `string` (not protobuf string)
  - Export: `type SearchCategory = 'employees' | 'departments' | 'channels' | 'messages';`

### API Wrappers - Organization
- [X] T028 Add search wrappers to `frontend/packages/apis/src/organization.ts`:
  - `searchEmployees(queryText: string, limit?: number, cursor?: string): Promise<EmployeeSearchResponse>`
  - `autocompleteEmployees(prefix: string, limit?: number): Promise<EmployeeAutocompleteSuggestion[]>`
  - `searchDepartments(queryText: string, limit?: number, cursor?: string): Promise<DepartmentSearchResponse>`
  - `autocompleteDepartments(prefix: string, limit?: number): Promise<DepartmentAutocompleteSuggestion[]>`
  - Use `rpcCall` wrapper from `packages/apis/src/rpc-client.ts`
  - Convert protobuf Timestamp to Date using `proto-utils.ts`

### API Wrappers - Chat
- [X] T029 Add search wrappers to `frontend/packages/apis/src/chat.ts`:
  - `searchChannels(queryText: string, limit?: number, cursor?: string): Promise<ChannelSearchResponse>`
  - `autocompleteChannels(prefix: string, limit?: number): Promise<ChannelAutocompleteSuggestion[]>`
  - `searchMessages(queryText: string, limit?: number, cursor?: string): Promise<MessageSearchResponse>`
  - Note: Message search returns highlighted snippet from backend FTS

### Federated Search
- [X] T030 Create federated search in `frontend/packages/apis/src/search.ts`:
  - `searchAll(queryText: string, options?: SearchOptions): Promise<FederatedSearchResults>`
  - Uses `Promise.all` to call organization and chat search methods in parallel
  - Returns aggregated results grouped by entity type (users, departments, channels, messages)
  - Options: filter by entity types, limit per category
  - Handle partial failures gracefully (one domain failing shouldn't break all)

---

## Phase 3.11: Frontend - UI Components

### Global Search Bar
- [X] T031 Create GlobalSearchBar in `frontend/apps/web/src/components/GlobalSearchBar.tsx`:
  - Material-UI Autocomplete component with async options
  - Debounced input (300ms) to avoid excessive API calls
  - Calls `searchAll()` from `packages/apis/src/search.ts`
  - Dropdown preview: max 5 results per category
  - Groups results by entity type with icons
  - Click result: navigate to entity detail page
  - "View all results" footer: navigate to full search page
  - Keyboard navigation (arrow keys, enter, Cmd+K to focus)

- [X] T032 Integrate GlobalSearchBar into `frontend/apps/web/src/app/workspace/layout.tsx`:
  - Add search bar to app bar/header between workspace name and user menu
  - Mobile responsive: collapse to search icon

### Search Results Page
- [X] T033 Create search results page in `frontend/apps/web/src/app/workspace/search/page.tsx`:
  - Extract query from URL params: `const query = searchParams.get('q');`
  - Call `searchAll(query)` from APIs package
  - Display loading states for each category
  - Use `'use client'` directive
  - Auth guard: `useRequireAuth()` hook
  - Layout: Category tabs (Users, Departments, Channels, Messages, All)

- [X] T034 [P] Create CategoryTabs in `frontend/apps/web/src/app/workspace/search/components/CategoryTabs.tsx`:
  - Props: `activeCategory`, `onCategoryChange`, `resultCounts`
  - Use MUI Tabs component
  - Show result counts as badges

- [X] T035 [P] Create SearchResults in `frontend/apps/web/src/app/workspace/search/components/SearchResults.tsx`:
  - Props: `category`, `results`, `loading`
  - Render category-specific result lists
  - Handle empty states: "No results found"

### Result Card Components
- [X] T036 [P] Create EmployeeSearchResult in `frontend/apps/web/src/app/workspace/search/components/EmployeeSearchResult.tsx`:
  - Display: Avatar, name, email, relevance score badge
  - Action: Click navigates to employee profile
  - Compact design: Single line with truncation

- [X] T037 [P] Create DepartmentSearchResult in `frontend/apps/web/src/app/workspace/search/components/DepartmentSearchResult.tsx`:
  - Display: Department icon, name, description snippet, member count
  - Action: Click navigates to department page

- [X] T038 [P] Create ChannelSearchResult in `frontend/apps/web/src/app/workspace/search/components/ChannelSearchResult.tsx`:
  - Display: Channel icon (public/private), name, description snippet
  - Badge: Private channel indicator if applicable
  - Action: Click navigates to channel

- [X] T039 [P] Create MessageSearchResult in `frontend/apps/web/src/app/workspace/search/components/MessageSearchResult.tsx`:
  - Display: Highlighted snippet from FTS (dangerouslySetInnerHTML with sanitization)
  - Display: Sender avatar, timestamp, channel name
  - Action: Click navigates to message in channel context
  - Security: Sanitize HTML in highlighted snippet

### Documentation
- [ ] T040 Create README in `frontend/apps/web/src/app/workspace/search/README.md`:
  - Feature overview (federated search, domain-owned APIs)
  - Component structure
  - API usage examples
  - Category filtering behavior
  - Keyboard shortcuts (Cmd+K, Enter, Escape)

---

## Phase 3.12: Manual Verification ⚠️ REQUIRED BEFORE TESTS
**Human developer MUST verify behavior is correct before adding tests**
<!-- Constitution Principle II: Post-Verification Testing -->

### Backend Verification
- [ ] T041 Manual test employee search:
  ```bash
  curl -X POST http://localhost:18080/rpc.v1.OrganizationService/SearchEmployees \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"query_text": "john", "limit": 50}'
  ```
  - Verify fuzzy matching works (typos, partial matches)
  - Verify relevance scores
  - Verify only active employees returned
  - Verify organization_id isolation

- [ ] T042 Manual test department search:
  ```bash
  curl -X POST http://localhost:18080/rpc.v1.OrganizationService/SearchDepartments \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"query_text": "eng", "limit": 50}'
  ```

- [ ] T043 Manual test channel search with permission filtering:
  ```bash
  curl -X POST http://localhost:18080/rpc.v1.ChatService/SearchChannels \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"query_text": "general", "limit": 50}'
  ```
  - Verify private channels only if member

- [ ] T044 Manual test message FTS search:
  ```bash
  curl -X POST http://localhost:18080/rpc.v1.ChatService/SearchMessages \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"query_text": "budget", "limit": 50}'
  ```
  - Verify FTS ranking (relevant messages first)
  - Verify highlighted snippets from `ts_headline()`
  - Verify channel permission filtering

- [ ] T045 Manual test multilingual search (Japanese):
  ```bash
  curl -X POST http://localhost:18080/rpc.v1.ChatService/SearchMessages \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"query_text": "営業", "limit": 50}'
  ```
  - Verify CJK characters handled correctly
  - Verify FTS with language-specific config

- [ ] T046 Manual test language detection:
  - Create messages in different languages via API
  - Query database: `SELECT id, language FROM chat.message ORDER BY created_at DESC LIMIT 10;`
  - Verify `language` column populated correctly
  - Check logs: `slog.DebugContext` shows detected language

- [ ] T047 Manual test cursor pagination:
  - Search with large result set
  - Use `next_cursor` from response in subsequent request
  - Verify no duplicate results
  - Verify correct ordering

### Frontend Verification
- [ ] T048 Manual test global search bar:
  - Type "eng" and verify dropdown preview with results across categories
  - Verify debouncing (no requests until 300ms after typing stops)
  - Verify results grouped by entity type
  - Click result and verify navigation
  - Press Enter and verify navigation to full search page

- [ ] T049 Manual test autocomplete:
  - Type "@joh" in GlobalSearchBar
  - Verify employee suggestions appear
  - Verify limit 10 suggestions

- [ ] T050 Run quickstart.md test scenarios:
  - Scenario 1: Federated search - all categories
  - Scenario 2: Entity-specific search (messages only)
  - Scenario 3: Multilingual search (Japanese)
  - Scenario 4: Fuzzy matching (typo tolerance)
  - Scenario 5: Permission filtering (private channels)
  - Scenario 6: Autocomplete performance
  - Scenario 7: FTS relevance ranking
  - Scenario 8: Highlighted snippets display

- [ ] T051 Document verified behavior in test plan:
  - Create `backend/internal/organization/TESTPLAN.md`
  - List all verified scenarios with expected behavior
  - Note edge cases discovered during verification
  - Document expected performance metrics (P95 latency)
  - Capture screenshots for UI components

---

## Phase 3.13: Tests (After Verification)
**Add tests ONLY after T041-T051 confirm correct behavior**
<!-- Constitution Principle II: Tests added after human verification -->

### Backend Unit Tests - Organization
- [ ] T052 [P] Unit tests in `backend/internal/organization/logic_test.go`:
  - `TestSearchEmployees_Success`
  - `TestSearchEmployees_EmptyResults`
  - `TestSearchEmployees_CursorPagination`
  - `TestSearchDepartments_Success`
  - `TestAutocompleteEmployees_Success`
  - Mock sqlc queries with testify/mock
  - Verify cursor handling (NULL vs UUID)

### Backend Unit Tests - Chat
- [ ] T053 [P] Unit tests in `backend/internal/chat/logic_test.go`:
  - `TestSearchChannels_Success`
  - `TestSearchChannels_PermissionFiltering`
  - `TestSearchMessages_FTS_Success`
  - `TestSearchMessages_MultilingualQuery`
  - `TestAutocompleteChannels_Success`
  - Mock sqlc queries
  - Verify permission checks

### Backend Integration Tests - Organization
- [ ] T054 [P] Integration tests in `backend/internal/organization/integration_test.go`:
  - `TestSearchEmployees_Integration` (with real database)
  - `TestSearchDepartments_Integration`
  - Seed test data with known search strings
  - Verify fuzzy matching thresholds
  - Verify trigram indexes used (EXPLAIN ANALYZE)

### Backend Integration Tests - Chat
- [ ] T055 [P] Integration tests in `backend/internal/chat/integration_test.go`:
  - `TestSearchMessages_Integration_FTS` (with real database)
  - `TestSearchChannels_Integration_Permissions`
  - Seed multilingual messages
  - Verify FTS ranking with `ts_rank()`
  - Verify permission isolation
  - Verify highlighted snippets from `ts_headline()`

### Backend Integration Tests - Language Detection
- [ ] T056 [P] Integration tests in `backend/internal/chat/integration_test.go`:
  - `TestLanguageDetection_MultipleLangs`
  - Create messages in 9 languages
  - Verify correct language code stored
  - Verify tsvector populated with correct FTS config
  - Verify trigger execution

### Frontend Component Tests
- [ ] T057 [P] Component tests in `frontend/apps/web/src/components/GlobalSearchBar.test.tsx`:
  - `test('renders search input')`
  - `test('debounces search input')`
  - `test('displays dropdown preview')`
  - `test('handles click on result')`
  - Mock API calls from `packages/apis`
  - Use React Testing Library

### Frontend API Wrapper Tests
- [ ] T058 [P] Tests in `frontend/packages/apis/src/organization.test.ts`:
  - `test('searchEmployees converts response')`
  - `test('autocompleteEmployees handles errors')`
  - Mock RPC client

- [ ] T059 [P] Tests in `frontend/packages/apis/src/chat.test.ts`:
  - `test('searchMessages converts response with highlighted snippet')`
  - `test('searchChannels handles pagination')`

### Contract Tests
- [ ] T060 [P] Contract test in `backend/integration/search_contract_test.go`:
  - `TestSearchEmployees_Contract` (validates API contract matches proto)
  - `TestSearchMessages_Contract`
  - Verify response schema matches proto definitions
  - Verify error codes match documentation
  - Verify highlighted snippet format

---

## Phase 3.14: Performance & Polish

### Performance Testing
- [ ] T061 Performance test in `backend/internal/chat/performance_test.go`:
  - Benchmark message FTS search on 100K messages
  - Target: <500ms p95 latency
  - Verify GIN index usage with EXPLAIN ANALYZE
  - Test concurrent searches (1000 users)
  - Compare FTS vs pg_trgm performance on messages

- [ ] T062 Performance test for employee search:
  - Benchmark on 10K employees
  - Target: <100ms p95 latency
  - Verify trigram index usage

### Index Tuning
- [ ] T063 Analyze slow queries and tune indexes:
  - Check PostgreSQL logs for slow queries (>100ms)
  - Add composite indexes for common search patterns
  - Consider partial indexes for active/non-deleted entities
  - Update schema.sql and run migration

### Logging & Observability
- [ ] T064 Add comprehensive logging:
  - Log search query, org_id, employee_id, duration
  - Log result count and relevance scores
  - Log language detection results
  - Log FTS query performance
  - Use `slog.InfoContext` for search operations
  - Use `slog.DebugContext` for detailed debug info

### Documentation
- [ ] T065 [P] Update API docs in `backend/docs/api-search.md`:
  - Document all search endpoints
  - Include request/response examples
  - Document fuzzy matching behavior (pg_trgm)
  - Document FTS behavior (language-specific configs)
  - Document pagination with cursors
  - Document permission filtering rules

- [ ] T066 [P] Update frontend docs in `frontend/apps/web/docs/search.md`:
  - Document GlobalSearchBar usage
  - Document federated search behavior
  - Include screenshots
  - Document keyboard shortcuts

- [ ] T067 [P] Add performance metrics doc in `specs/011-global-multilingual-fuzzy-search-system/performance.md`:
  - Document benchmark results
  - Document index sizes (FTS vs pg_trgm)
  - Document query latencies by category
  - Compare pg_trgm vs FTS for different content lengths

### Code Quality
- [ ] T068 Remove duplication:
  - Extract common cursor pagination logic
  - Extract common error handling
  - Extract common logging patterns

- [ ] T069 Final linting and formatting:
  ```bash
  cd backend && go fmt ./... && go vet ./...
  cd frontend && pnpm lint --fix
  ```

---

## Dependencies

**Critical Path**:
1. Schema setup (T001-T009) blocks everything
2. Code generation (T010-T018) blocks implementation
3. Language detection (T019) blocks message creation (T022)
4. Backend implementation (T020-T024) blocks frontend
5. Frontend implementation (T025-T040) blocks UI verification
6. Manual verification (T041-T051) ⚠️ GATE blocks tests
7. Tests (T052-T060) block polish
8. Polish (T061-T069) is final phase

**Parallel Opportunities**:
- T006, T007, T008 (different tables)
- T011, T012, T013, T014 (different files)
- T016, T017 (different proto files)
- T020, T021 (different logic files)
- T023, T024 (different connect files)
- T027, T028, T029, T030 (different API files)
- T036-T039 (different component files)
- T041-T047 (backend verification) parallel with T048-T050 (frontend verification)
- All test tasks (T052-T060) after verification

---

## Parallel Execution Examples

### Schema Changes
```bash
# Launch T006, T007, T008 together:
Task: "Create trigram indexes on organization.employee"
Task: "Create trigram index on organization.department"
Task: "Create trigram index on chat.channel"
```

### sqlc Queries
```bash
# Launch T011-T014 together:
Task: "Add employee search queries to organization.query.sql"
Task: "Add department search queries to organization.query.sql"
Task: "Add channel search queries to chat.query.sql"
Task: "Add message search queries to chat.query.sql"
```

### Backend Implementation
```bash
# Launch T020, T021 together:
Task: "Extend OrganizationLogic with search methods"
Task: "Extend ChatLogic with search methods"

# Then launch T023, T024 together:
Task: "Extend OrganizationServiceConnect"
Task: "Extend ChatServiceConnect"
```

### Frontend API Wrappers
```bash
# Launch T027-T030 together:
Task: "Create search TypeScript types"
Task: "Add search wrappers to organization.ts"
Task: "Add search wrappers to chat.ts"
Task: "Create federated search in search.ts"
```

### Tests (After Verification)
```bash
# Launch all test tasks together:
Task: "Unit tests in organization/logic_test.go"
Task: "Unit tests in chat/logic_test.go"
Task: "Integration tests in organization/integration_test.go"
Task: "Integration tests in chat/integration_test.go"
Task: "Language detection integration tests"
Task: "Component tests in GlobalSearchBar.test.tsx"
Task: "API wrapper tests in organization.test.ts"
Task: "API wrapper tests in chat.test.ts"
Task: "Contract tests in search_contract_test.go"
```

---

## Notes

### Constitution Compliance
- ✅ **Multi-Tenancy**: All queries filter by `organization_id`
- ✅ **Two-Layer Architecture**: Logic layer (pure business logic) + Connect layer (RPC handlers)
- ✅ **Connection Pools**: TenantPool for user operations (read-only search)
- ✅ **Cross-Domain Integration**: Direct logic layer calls for permissions
- ✅ **Context Propagation**: User-scope context for all search operations
- ✅ **Post-Verification Testing**: Tests added only after manual verification (T041-T051 before T052-T060)
- ⚠️ **Cross-Schema SQL**: Justified for read-only search aggregation (see plan.md Complexity Tracking)

### Cross-Stack Constant Synchronization
Language codes synchronized across layers:
- **Database**: CHECK constraint on `chat.message.language` (T002)
- **Backend**: Constants in `internal/organization/language_detector.go` (T019)
- **Frontend**: TypeScript types in `packages/apis/src/types.ts` (T027)
- **Validation**: Integration tests verify alignment (T056)

### Nullable UUID Parameters (Constitution Principle IX)
All cursor parameters use nullable UUID pattern:
- **SQL**: `sqlc.narg('cursor')::UUID` allows NULL vs zero UUID distinction
- **Go**: `dbuuid.NullUUID` type for optional parameters
- **Logic**: Check `cursor.Valid` before using `cursor.UUID`
- **Critical**: Avoids zero UUID being interpreted as non-NULL filter

### Hybrid Search Approach
- **PostgreSQL FTS** for chat messages:
  - Better for medium/long content
  - Language-aware tokenization and stemming
  - Relevance ranking with `ts_rank()`
  - Highlighted snippets with `ts_headline()`
- **pg_trgm** for short fields:
  - Names, emails, department names, channel names
  - Fuzzy matching excels at handling typos
  - Faster for short strings

---

## Validation Checklist

- [x] All contracts have implementations (T016-T017 → T020-T024)
- [x] All entities have schema changes (T002-T008)
- [x] Manual verification phase present before tests (T041-T051 before T052-T060)
- [x] All implementations have tests (T052-T060)
- [x] Parallel tasks independent (different files)
- [x] Each task specifies exact file path
- [x] No task modifies same file as another [P] task
- [x] String constant synchronization (language codes: T002, T019, T027, T056)
- [x] Nullable UUID parameters documented (cursor pagination)
- [x] Cross-domain dependencies documented (ChatLogic for permissions)
- [x] Hybrid search approach (FTS + pg_trgm) justified

---

**Total Tasks**: 69  
**Estimated Completion**: 5-7 days (with parallel execution)  
**Constitution Version**: v5.0.0  
**Status**: ✅ Ready for execution

---

*Based on Constitution v5.0.0 - See `.specify/memory/constitution.md`*  
*Feature Spec: `specs/011-global-multilingual-fuzzy-search-system/spec.md`*
