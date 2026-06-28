# Fix: Docs URL Structure and GetDocument RPC

**Issue**: Frontend was using UUID-based URLs (`?doc=<uuid>`) and sending malformed GetDocument RPC requests, causing backend error: "identifier (id or slug) is required"

**Root Cause**: 
1. Frontend API wrapper was not properly constructing protobuf `oneof` fields
2. Frontend navigation was using UUIDs instead of slugs for document URLs

## Changes Made

### 1. Frontend API Wrapper Fix
**File**: `frontend/packages/apis/src/docs.ts`

**Problem**: The `getDocument()` function was sending a flat object with `id` and `slug` properties, but the protobuf definition requires a `oneof` field structure.

**Proto Definition**:
```protobuf
message GetDocumentRequest {
  oneof identifier {
    string id = 1;
    string slug = 2;
  }
  bool include_content = 3;
}
```

**Before**:
```typescript
const request = {
  includeContent: params.includeContent ?? true,
};
if (params.id) {
  request.id = params.id;
} else if (params.slug) {
  request.slug = params.slug;
}
```

**After**:
```typescript
const request: any = {
  includeContent: params.includeContent ?? true,
};

// Set identifier oneof field properly
if (params.id) {
  request.identifier = { case: 'id', value: params.id };
} else if (params.slug) {
  request.identifier = { case: 'slug', value: params.slug };
}
```

### 2. Frontend Navigation Fix
**File**: `frontend/apps/web/src/app/workspace/docs/components/DocumentTree.tsx`

**Changes**:
- Updated `handleDocClick` to use `router.push(\`/workspace/docs?slug=${doc.slug}\`)` instead of UUID
- Updated `handleDocCreated` to prefer slug-based URLs when available, with ID fallback
- Added `useQueryClient` import to access cached document data

**Before**:
```typescript
router.push(`/workspace/docs?doc=${doc.id}`);
```

**After**:
```typescript
router.push(`/workspace/docs?slug=${doc.slug}`);
```

## How It Works

### Backend Flow:
1. Client sends GetDocument request with identifier oneof field
2. Backend checks the oneof discriminator:
   - `case 'id'`: Parse UUID and fetch by ID
   - `case 'slug'`: Resolve slug (including redirects) then fetch document
   - `default`: Return error "identifier (id or slug) is required"

### Frontend Flow:
1. User clicks document in tree → navigate to `/workspace/docs?slug=<slug>`
2. DocumentView component reads `slug` from URL query params
3. API wrapper constructs proper oneof request: `{ identifier: { case: 'slug', value: slug } }`
4. Backend successfully resolves and returns document

## Benefits

1. **Permanent URLs**: Slug-based URLs remain valid even if document is moved in hierarchy
2. **User-Friendly**: Slugs are readable (e.g., `?slug=architecture-decisions-abc123` vs `?doc=019b3a24-62fb-70c3-8826-1f157f407f8a`)
3. **Proper Protobuf**: Oneof fields are correctly structured for ConnectRPC/protobuf serialization
4. **Redirect Support**: Backend can redirect old slugs to current document (via `slug_history` table)

## Testing

To test the fix:

1. **Frontend**: Navigate to a document in the docs page
   - URL should use `?slug=...` format
   - Document should load without errors

2. **Backend**: Check server logs
   - Should see "GetDocument RPC called" with no errors
   - Should not see "identifier (id or slug) is required" error

3. **Manual RPC Test**: Use the test script in `backend/tmp/test_slug_fix.go`
   - Update token and slug values
   - Run: `go run backend/tmp/test_slug_fix.go`
   - Both ID and slug fetches should succeed

## Spec Compliance

This fix aligns with the spec in `data-model.md`:
> **slug** TEXT NOT NULL - Format: {title-slug}-{base62-uuid}
> Permanent slug for URL-based access. Never changes even if title is renamed.
> Old slugs redirect via slug_history table.

The frontend now correctly uses slug-based URLs as intended by the original design.

## Related Files

- `backend/internal/docs/connect.go` (GetDocument handler implementation)
- `backend/rpc/v1/document.proto` (Proto definition with oneof)
- `frontend/packages/apis/src/docs.ts` (API wrapper)
- `frontend/apps/web/src/app/workspace/docs/components/DocumentTree.tsx` (Navigation)
- `frontend/apps/web/src/app/workspace/docs/page.tsx` (URL query param handling)

## Next Steps

- ✅ Fix API wrapper oneof construction
- ✅ Update navigation to use slugs
- ⏭️ Consider enhancing breadcrumb navigation to use slugs (currently uses ID fallback since full ancestor data not available)
