# Architecture Refactor: Domain-Owned Upload Flow

**Date**: 2025-11-12  
**Refactor Type**: Full refactor to domain-owned upload pattern  
**Rationale**: Eliminate circular dependency, improve security, align with constitutional cross-domain integration principles

---

## Problem Statement

### Circular Dependency Issue
The original design created a circular dependency:
1. **Chat → File**: ChatService needs to verify file belongs to channel before returning download URL
2. **File → Chat**: FileService needs to verify channel membership for access control

This violates **Constitution Principle IV** (Cross-Domain Integration) which prohibits circular dependencies.

### Security Gap
Client-controlled upload context allowed manipulation:
- Client could set `context_id` to any channel (even private ones they don't have access to)
- Client could set `access_scope="public"` for private channel files
- Server had no way to verify context ownership at upload time

---

## Solution: Domain-Owned Upload Flow

### Core Concept
**Each domain service owns its file upload RPCs and calls FileLogic (not FileService RPC)**

### Architecture Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                             │
│  (Frontend calls domain-specific upload RPCs)                    │
└────────────┬──────────────────────────────────┬─────────────────┘
             │                                    │
             │ ChatService.RequestChannelFileUpload
             │                                    │ DocsService.RequestDepartmentFileUpload
             ▼                                    ▼
┌────────────────────────┐              ┌──────────────────────────┐
│  ChatService (Connect) │              │ DocsService (Connect)    │
│  ─────────────────────│              │ ────────────────────────│
│  - Extract auth        │              │ - Extract auth           │
│  - Verify channel      │              │ - Verify department      │
│    membership          │              │    membership            │
│  - Derive access_scope │              │ - Derive access_scope    │
│    from channel        │              │    from department       │
│  - Call FileLogic      │──────┐       │ - Call FileLogic         │──────┐
└────────────────────────┘      │       └──────────────────────────┘      │
                                │                                          │
                                │                                          │
                                ▼                                          │
                      ┌──────────────────────────┐                        │
                      │   FileLogic (shared)     │◄───────────────────────┘
                      │   ───────────────────── │
                      │   - GenerateUploadURL()  │
                      │   - ConfirmUpload()      │
                      │   - CreateAccessRule()   │
                      │   (NO auth checks here)  │
                      └────────────┬─────────────┘
                                   │
                                   ▼
                         ┌──────────────────┐
                         │  Database + R2   │
                         └──────────────────┘
```

### Key Changes

#### 1. Remove from FileService
- ❌ `RequestUploadUrl` RPC (was client-facing, security gap)
- ❌ `ConfirmUpload` RPC (was client-facing, security gap)
- ✅ Keep: `ValidateFile`, `SetFileAccessRule`, `CheckFileAccess`, `SearchFiles`, PDF/indexing RPCs

#### 2. Add to Domain Services
- ✅ `ChatService.RequestChannelFileUpload` - Chat attachments
- ✅ `ChatService.ConfirmChannelFileUpload` - Finalize chat upload
- ✅ (Future) `DocsService.RequestDepartmentFileUpload` - Department documents
- ✅ (Future) `ProjectService.RequestProjectFileUpload` - Project attachments
- ✅ Keep: `FileService.RequestUploadUrl` for avatar uploads ONLY (no context, public scope)

#### 3. FileLogic Internal Methods
Convert to logic layer methods (not RPC):
```go
// backend/internal/files/file_logic.go
type FileLogic interface {
    GenerateUploadURL(ctx context.Context, tx database.DBTX, params GenerateUploadParams) (*UploadURLResult, error)
    ConfirmUpload(ctx context.Context, tx database.DBTX, params ConfirmUploadParams) (*FileMetadata, error)
    CreateAccessRule(ctx context.Context, tx database.DBTX, params CreateAccessRuleParams) error
}

type GenerateUploadParams struct {
    OrganizationID dbuuid.UUID
    EmployeeID     dbuuid.UUID
    Filename       string
    MimeType       string
    SizeBytes      int64
    UploadContext  string // "chat", "avatar", "docs"
}

type ConfirmUploadParams struct {
    OrganizationID dbuuid.UUID
    EmployeeID     dbuuid.UUID
    FileID         dbuuid.UUID
}

type CreateAccessRuleParams struct {
    OrganizationID dbuuid.UUID
    FileID         dbuuid.UUID
    ContextType    string // "chat_channel", "department_docs", etc.
    ContextID      dbuuid.UUID
    AccessScope    string // "public", "private", "department"
}
```

---

## Example: Chat File Upload Flow

### 1. Client Initiates Upload
```typescript
// frontend/packages/apis/src/chat.ts
export async function requestChannelFileUpload(params: {
  channelId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<UploadURLResponse> {
  return await rpcCall(async () => {
    const resp = await chatClient.requestChannelFileUpload({
      channelId: params.channelId,
      filename: params.filename,
      mimeType: params.mimeType,
      sizeBytes: BigInt(params.sizeBytes),
    });
    return {
      fileId: resp.fileId,
      uploadUrl: resp.uploadUrl,
      expiresAt: timestampToDate(resp.expiresAt),
    } as UploadURLResponse;
  });
}
```

### 2. ChatService Verifies Context & Calls FileLogic
```go
// backend/internal/chat/chat_service.go
func (s *ChatServiceServer) RequestChannelFileUpload(
    ctx context.Context,
    req *connect.Request[rpcv1.RequestChannelFileUploadRequest],
) (*connect.Response[rpcv1.RequestChannelFileUploadResponse], error) {
    orgID := interceptor.OrgIDFromContext(ctx)
    employeeID := interceptor.EmployeeIDFromContext(ctx)
    
    var result *files.UploadURLResult
    err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
        // 1. Verify channel exists and employee is member
        channel, err := s.chatLogic.GetChannel(ctx, tx, dbuuid.Parse(orgID), dbuuid.Parse(req.Msg.ChannelId))
        if err != nil {
            return err
        }
        
        isMember, err := s.chatLogic.IsChannelMember(ctx, tx, dbuuid.Parse(orgID), dbuuid.Parse(req.Msg.ChannelId), dbuuid.Parse(employeeID))
        if err != nil {
            return err
        }
        if !isMember {
            return connect.NewError(connect.CodePermissionDenied, errors.New("not a channel member"))
        }
        
        // 2. Derive access scope from channel privacy
        accessScope := "public"
        if channel.IsPrivate {
            accessScope = "private"
        }
        
        // 3. Call FileLogic to generate upload URL
        result, err = s.fileLogic.GenerateUploadURL(ctx, tx, files.GenerateUploadParams{
            OrganizationID: dbuuid.Parse(orgID),
            EmployeeID:     dbuuid.Parse(employeeID),
            Filename:       req.Msg.Filename,
            MimeType:       req.Msg.MimeType,
            SizeBytes:      req.Msg.SizeBytes,
            UploadContext:  "chat",
        })
        if err != nil {
            return err
        }
        
        // 4. Create access rule linking file to channel
        err = s.fileLogic.CreateAccessRule(ctx, tx, files.CreateAccessRuleParams{
            OrganizationID: dbuuid.Parse(orgID),
            FileID:         result.FileID,
            ContextType:    "chat_channel",
            ContextID:      dbuuid.Parse(req.Msg.ChannelId),
            AccessScope:    accessScope, // Server-derived, not client-controlled
        })
        return err
    })
    
    if err != nil {
        return nil, err
    }
    
    return connect.NewResponse(&rpcv1.RequestChannelFileUploadResponse{
        FileId:    result.FileID.String(),
        UploadUrl: result.UploadURL,
        ExpiresAt: timestamppb.New(result.ExpiresAt),
    }), nil
}
```

### 3. Client Uploads to R2, Then Confirms
```typescript
// Upload binary to presigned URL
await fetch(uploadUrl, {
  method: 'PUT',
  body: fileBlob,
  headers: { 'Content-Type': mimeType },
});

// Confirm upload
await confirmChannelFileUpload({
  channelId: channelId,
  fileId: fileId,
});
```

### 4. ChatService Confirms & Triggers Workflows
```go
func (s *ChatServiceServer) ConfirmChannelFileUpload(
    ctx context.Context,
    req *connect.Request[rpcv1.ConfirmChannelFileUploadRequest],
) (*connect.Response[rpcv1.ConfirmChannelFileUploadResponse], error) {
    orgID := interceptor.OrgIDFromContext(ctx)
    employeeID := interceptor.EmployeeIDFromContext(ctx)
    
    var metadata *files.FileMetadata
    err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
        // Verify channel membership again
        isMember, err := s.chatLogic.IsChannelMember(ctx, tx, dbuuid.Parse(orgID), dbuuid.Parse(req.Msg.ChannelId), dbuuid.Parse(employeeID))
        if err != nil || !isMember {
            return connect.NewError(connect.CodePermissionDenied, errors.New("not a channel member"))
        }
        
        // Confirm upload with FileLogic
        metadata, err = s.fileLogic.ConfirmUpload(ctx, tx, files.ConfirmUploadParams{
            OrganizationID: dbuuid.Parse(orgID),
            EmployeeID:     dbuuid.Parse(employeeID),
            FileID:         dbuuid.Parse(req.Msg.FileId),
        })
        return err
    })
    
    if err != nil {
        return nil, err
    }
    
    // Trigger async workflows (validation, PDF conversion, indexing)
    // These run in background workers with AdminPool
    
    return connect.NewResponse(&rpcv1.ConfirmChannelFileUploadResponse{
        File: convertToProto(metadata),
    }), nil
}
```

---

## Benefits

### 1. Security
✅ Server verifies context ownership (channel membership, department access, etc.) BEFORE generating upload URL
✅ Access scope derived from context properties (channel.is_private), not client-controlled
✅ No way for client to upload files to unauthorized contexts

### 2. Architecture
✅ Eliminates circular dependency (Chat doesn't call FileService, calls FileLogic)
✅ Clear ownership model: domain services own their upload flows
✅ FileLogic becomes shared utility, no business logic about contexts

### 3. Maintainability
✅ Domain-specific upload logic lives in domain service (easier to find and maintain)
✅ File validation/conversion/indexing remains centralized in FileService
✅ Clear separation: upload = domain-owned, processing = file-owned

---

## Migration Impact

### Proto Changes
- Remove from `files.proto`: RequestUploadUrl, ConfirmUpload (for context-based uploads)
- Add to `chat.proto`: RequestChannelFileUpload, ConfirmChannelFileUpload
- Keep in `files.proto`: RequestUploadUrl for avatar ONLY (add comment explaining avatar-specific use)

### Backend Changes
- Convert FileService upload handlers to FileLogic methods
- Add ChatService upload handlers calling FileLogic
- Update dependency injection in `cmd/server.go`

### Frontend Changes
- Update `packages/apis/src/files.ts` to remove context-based upload wrappers
- Add `packages/apis/src/chat.ts` upload wrappers for channel files
- Update FileAttachment component to call chat API for attachments

### Testing Changes
- Add integration tests for ChatService upload flow
- Update file upload tests to use domain-specific RPCs
- Test access control enforcement at upload time

---

## Timeline

**Before Implementation**: ✅ Architectural refactor (this document)
**Phase 1**: Update all design documents (plan.md, research.md, data-model.md, contracts/, tasks.md)
**Phase 2**: Implement FileLogic methods
**Phase 3**: Implement ChatService upload RPCs
**Phase 4**: Update frontend to use new APIs
**Phase 5**: Integration testing
**Phase 6**: Remove old FileService upload RPCs

---

## Future Extensions

### Other Domains
Same pattern applies to future upload contexts:
- **DocsService.RequestDepartmentFileUpload** - Department shared docs
- **ProjectService.RequestProjectFileUpload** - Project attachments
- **CalendarService.RequestEventFileUpload** - Meeting attachments
- **SupportService.RequestTicketFileUpload** - Support ticket attachments

### Avatar Uploads
Keep simplified flow in FileService:
- `FileService.RequestUploadUrl(upload_context="avatar")` - No channel/project context
- Access scope always "public" (organization-wide)
- No context verification needed (avatar belongs to employee)
