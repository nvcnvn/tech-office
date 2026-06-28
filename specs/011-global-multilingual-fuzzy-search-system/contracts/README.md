# Search Feature Contracts

## Domain-Owned Search Architecture

This feature does NOT create a centralized SearchService. Instead, search methods are added to existing domain services to maintain proper separation of concerns and avoid cross-schema SQL queries.

## Proto Definitions

### Organization Service Search (`organization-search.proto`)
Contains message definitions to be **ADDED** to `/backend/rpc/v1/organization.proto`:

**Methods to add to OrganizationService**:
- `SearchEmployees(SearchEmployeesRequest) → SearchEmployeesResponse`
- `SearchDepartments(SearchDepartmentsRequest) → SearchDepartmentsResponse`
- `AutocompleteEmployees(AutocompleteEmployeesRequest) → AutocompleteEmployeesResponse`
- `AutocompleteDepartments(AutocompleteDepartmentsRequest) → AutocompleteDepartmentsResponse`

### Chat Service Search (`chat-search.proto`)
Contains message definitions to be **ADDED** to `/backend/rpc/v1/chat.proto`:

**Methods to add to ChatService**:
- `SearchChannels(SearchChannelsRequest) → SearchChannelsResponse`
- `SearchMessages(SearchMessagesRequest) → SearchMessagesResponse`
- `AutocompleteChannels(AutocompleteChannelsRequest) → AutocompleteChannelsResponse`

## SQL Queries

### Organization Queries (`search.query.sql` - lines for `organization.query.sql`)
Employee and department search queries belong in `/backend/database/scripts/organization.query.sql`:
- `SearchEmployees`
- `SearchDepartments`
- `AutocompleteEmployees`
- `AutocompleteDepartments`

### Chat Queries (`search.query.sql` - lines for `chat.query.sql`)
Channel and message search queries belong in `/backend/database/scripts/chat.query.sql`:
- `SearchChannels`
- `SearchMessages`
- `AutocompleteChannels`

## Implementation Notes

### Backend
- Modify `internal/organization/logic.go` to add 4 search methods
- Modify `internal/organization/connect.go` to add 4 RPC handlers
- Modify `internal/chat/logic.go` to add 3 search methods
- Modify `internal/chat/connect.go` to add 3 RPC handlers
- NO new service files created

### Frontend
- Modify `packages/apis/src/organization.ts` to add organization search wrappers
- Modify `packages/apis/src/chat.ts` to add chat search wrappers
- Create `packages/apis/src/search.ts` as aggregation module with `searchAll()` helper
- `searchAll()` calls multiple domain services in parallel (Promise.all)

## Constitutional Compliance

✅ **No Cross-Schema Access**: Each service queries ONLY its own schema  
✅ **Domain Encapsulation**: Each domain owns its search logic  
✅ **Scalability**: New domains add search without modifying other services  
✅ **Frontend Aggregation**: External aggregation via RPC (not internal service calls)

## Deprecated Files

- `search.proto` - This centralized search service approach was replaced with domain-owned search
