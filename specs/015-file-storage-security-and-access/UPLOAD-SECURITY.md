# Upload Security: Context Verification & Access Scope Derivation

**Date**: 2025-11-12  
**Feature**: 015 - File Storage Security and Access Improvement

## Security Problem: Client-Controlled Access Scope

### ❌ Original Vulnerable Design

**Problem**: Client could manipulate file access by controlling:
1. Which context (channel) the file belongs to
2. The access scope (public/private) for the file

**Attack Scenario**:
```typescript
// VULNERABLE: Malicious frontend code
async function uploadFileToPrivateChannel() {
  // Step 1: Get upload URL for private channel
  const uploadReq = await fileClient.requestUploadUrl({
    filename: "secret_doc.pdf",
    upload_context: "chat",
    context_id: "private-channel-uuid"  // Private channel
  });
  
  // Step 2: Upload file to R2
  await fetch(uploadReq.upload_url, { method: 'PUT', body: fileData });
  
  // Step 3: Confirm upload with MANIPULATED context
  await fileClient.confirmUpload({
    file_id: uploadReq.file_id,
    // Malicious client sends public channel ID instead!
    context_id: "public-channel-uuid",
    access_scope: "public"  // Or client directly sets scope
  });
  
  // Result: File uploaded to private channel but accessible to everyone
}
```

**Impact**: 
- Data leak: Private channel files become public
- Access control bypass: Users upload to contexts they shouldn't have access to
- Compliance violation: Sensitive data exposed without audit trail

---

## ✅ Secure Design: Server-Side Context Verification

### Phase 1: RequestUploadUrl - Verify Upload Permission

**Backend MUST verify employee can upload to the specified context**

```go
// backend/internal/files/connect.go
func (s *FileService) RequestUploadUrl(ctx context.Context, req *connect.Request[v1.RequestUploadUrlRequest]) (*connect.Response[v1.RequestUploadUrlResponse], error) {
    orgID := interceptor.OrgIDFromContext(ctx)
    employeeID := interceptor.EmployeeIDFromContext(ctx)
    
    uploadContext := req.Msg.UploadContext
    contextID := req.Msg.ContextId  // NEW REQUIRED FIELD
    
    // SECURITY CHECK: Verify employee has access to this context
    err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
        hasAccess := false
        
        switch uploadContext {
        case "chat":
            // Verify employee is member of the channel
            hasAccess, err = s.ChatLogic.IsChannelMember(ctx, tx, orgID, employeeID, contextID)
            if err != nil {
                return err
            }
            
        case "docs":
            // Verify employee is member of the department
            hasAccess, err = s.DepartmentLogic.IsDepartmentMember(ctx, tx, orgID, employeeID, contextID)
            if err != nil {
                return err
            }
            
        case "avatar":
            // Verify uploading to own profile
            hasAccess = (contextID == employeeID.String())
            
        default:
            return connect.NewError(connect.CodeInvalidArgument, 
                fmt.Errorf("Unsupported upload context: %s", uploadContext))
        }
        
        if !hasAccess {
            slog.WarnContext(ctx, "Upload blocked: User not member of context",
                "employee_id", employeeID,
                "upload_context", uploadContext,
                "context_id", contextID)
            
            return connect.NewError(connect.CodePermissionDenied,
                errors.New("You cannot upload files to this context"))
        }
        
        return nil
    })
    
    if err != nil {
        return nil, err
    }
    
    // Only generate presigned URL after verification passes
    presignedURL := s.r2Client.GeneratePresignedPutURL(...)
    
    // Store context_id in temporary upload tracking (for ConfirmUpload validation)
    fileMetadataTemp := database.InsertPendingUploadParams{
        ID:            fileID,
        OrganizationID: orgID,
        UploadedBy:    employeeID,
        UploadContext: uploadContext,
        ContextID:     contextID,  // Store for later validation
        ...
    }
    
    return &v1.RequestUploadUrlResponse{
        FileId:    fileID.String(),
        UploadUrl: presignedURL,
        ExpiresAt: timestamppb.New(time.Now().Add(15 * time.Minute)),
    }, nil
}
```

**Protection**:
- ✅ Blocks upload to private channels user is not member of
- ✅ Blocks upload to departments user doesn't belong to
- ✅ Blocks impersonation (uploading to other user's avatar)
- ✅ Logs blocked upload attempts for security monitoring

---

### Phase 2: ConfirmUpload - Derive Access Scope from Context

**Backend MUST derive access_scope from context properties, NEVER trust client**

```go
// backend/internal/files/connect.go
func (s *FileService) ConfirmUpload(ctx context.Context, req *connect.Request[v1.ConfirmUploadRequest]) (*connect.Response[v1.ConfirmUploadResponse], error) {
    orgID := interceptor.OrgIDFromContext(ctx)
    employeeID := interceptor.EmployeeIDFromContext(ctx)
    fileID := req.Msg.FileId
    
    var file *v1.FileMetadata
    
    err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
        // 1. Retrieve pending upload metadata (includes verified context_id)
        pendingUpload, err := s.queries.GetPendingUpload(ctx, tx, orgID, fileID)
        if err != nil {
            return connect.NewError(connect.CodeNotFound, 
                errors.New("Upload not found or expired"))
        }
        
        // 2. Verify upload still belongs to this employee (prevent hijacking)
        if pendingUpload.UploadedBy != employeeID {
            slog.WarnContext(ctx, "Upload hijack attempt blocked",
                "file_id", fileID,
                "expected_uploader", pendingUpload.UploadedBy,
                "actual_uploader", employeeID)
            
            return connect.NewError(connect.CodePermissionDenied,
                errors.New("You are not the original uploader"))
        }
        
        // 3. Insert file metadata
        file, err = s.queries.InsertFileMetadata(ctx, tx, database.InsertFileMetadataParams{
            ID:            fileID,
            OrganizationID: orgID,
            UploadContext: pendingUpload.UploadContext,
            UploadedBy:    employeeID,
            ...
        })
        if err != nil {
            return err
        }
        
        // 4. DERIVE access_scope from context properties (SERVER-SIDE)
        contextType, accessScope, err := s.deriveAccessScope(ctx, tx, orgID, 
            pendingUpload.UploadContext, pendingUpload.ContextID)
        if err != nil {
            return err
        }
        
        // 5. Create file_access_rule with derived scope
        _, err = s.AccessLogic.SetFileAccessRule(ctx, tx, orgID, fileID, 
            contextType, pendingUpload.ContextID, accessScope)
        if err != nil {
            return err
        }
        
        slog.InfoContext(ctx, "File upload confirmed with access rule",
            "file_id", fileID,
            "upload_context", pendingUpload.UploadContext,
            "context_id", pendingUpload.ContextID,
            "access_scope", accessScope)
        
        return nil
    })
    
    return &v1.ConfirmUploadResponse{File: file}, nil
}

// deriveAccessScope queries context properties to determine correct access scope
func (s *FileService) deriveAccessScope(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, uploadContext string, contextID dbuuid.UUID) (contextType string, accessScope string, err error) {
    switch uploadContext {
    case "chat":
        // Query channel to check if private
        channel, err := s.queries.GetChannel(ctx, tx, orgID, contextID)
        if err != nil {
            return "", "", err
        }
        
        contextType = "chat_channel"
        if channel.IsPrivate {
            accessScope = "private"  // Only channel members can access
        } else {
            accessScope = "public"   // All organization members can access
        }
        
    case "docs":
        // Department documents default to department-scoped
        contextType = "department_docs"
        accessScope = "department"  // Only department members can access
        
    case "avatar":
        // User avatar is private (only uploader can access)
        contextType = "user_avatar"
        accessScope = "private"
        
    default:
        return "", "", fmt.Errorf("unsupported upload context: %s", uploadContext)
    }
    
    return contextType, accessScope, nil
}
```

**Protection**:
- ✅ Client CANNOT manipulate access_scope (derived from DB query)
- ✅ Access scope reflects actual context properties (channel.is_private)
- ✅ Context verification happens TWICE (RequestUploadUrl + ConfirmUpload)
- ✅ Upload hijacking prevented (verify uploader matches)
- ✅ Atomic transaction (metadata + access rule or full rollback)

---

## Security Guarantees

### 1. Upload Permission Enforcement
```
❌ Carol (non-member) tries: RequestUploadUrl(context_id="private-channel-alice-bob")
✅ Backend checks: chat.channel_membership WHERE channel_id=... AND employee_id=carol
✅ Result: 0 rows → CodePermissionDenied "You cannot upload files to this context"
```

### 2. Access Scope Derivation (Not Client-Controlled)
```
✅ Alice uploads to private channel "engineering"
✅ Backend queries: SELECT is_private FROM chat.channel WHERE id='engineering'
✅ Result: is_private=true → access_scope="private"
✅ Frontend CANNOT override this value
```

### 3. Dynamic Channel Visibility Changes
```
Scenario: Channel changes from private to public
- File uploaded when channel was private: access_scope="private"
- Channel becomes public: is_private=false
- Access check at download time:
  ✅ Queries CURRENT channel.is_private (not stored access_scope)
  ✅ Now ALL org members can download (channel is public)
  ✅ access_scope record is informational, not enforcement mechanism
```

**IMPORTANT**: Access enforcement uses CURRENT context properties, not stored `access_scope` value. The `access_scope` column is metadata for auditing, not the enforcement mechanism.

---

## Proto Contract Changes

### Before (Vulnerable)
```proto
message RequestUploadUrlRequest {
  string filename = 1;
  int64 size_bytes = 2;
  string mime_type = 3;
  string upload_context = 4;  // Only context type, no specific ID
}

message ConfirmUploadRequest {
  string file_id = 1;
  // No context_id → Backend can't verify
  // Client could manipulate context in ConfirmUpload
}
```

### After (Secure)
```proto
message RequestUploadUrlRequest {
  string filename = 1;
  int64 size_bytes = 2;
  string mime_type = 3;
  string upload_context = 4;
  string context_id = 5;      // REQUIRED: Specific channel/project/dept ID
                              // Backend verifies membership before allowing upload
}

message ConfirmUploadRequest {
  string file_id = 1;
  // context_id stored in pending upload record (server-side)
  // Backend retrieves and validates, client cannot manipulate
}
```

---

## Attack Mitigation Summary

| Attack Vector | Before Fix | After Fix |
|--------------|------------|-----------|
| Upload to unauthorized context | ❌ Succeeds | ✅ Blocked at RequestUploadUrl with CodePermissionDenied |
| Client sets access_scope="public" for private channel file | ❌ Succeeds | ✅ Backend derives scope from channel.is_private |
| Client changes context_id between RequestUploadUrl and ConfirmUpload | ❌ Possible | ✅ Blocked - context_id stored server-side, verified |
| Upload hijacking (complete other user's upload) | ❌ Possible | ✅ Blocked - ConfirmUpload verifies uploader matches |
| File uploaded without access rule | ❌ Race condition | ✅ Atomic transaction ensures rule created |

---

## Implementation Tasks Updated

**New Task T036a**: Update RequestUploadUrl with context verification  
**Updated Task T037d**: Update ConfirmUpload with access scope derivation

**Proto Changes**: Added `context_id` field to `RequestUploadUrlRequest`

**Database Changes**: 
- Add `context_id` column to pending upload tracking table (temporary storage)
- Add queries to retrieve channel properties (`GetChannelProperties`)

---

## Testing Requirements

### Integration Tests (T053 - Enhanced)

**Scenario 1a**: Carol tries to upload to private channel she's not member of
```go
func TestUpload_UnauthorizedContext(t *testing.T) {
    orgID, _, carolToken := GetRandomTestIdentityAndKey(iam.IdentityRoleEmployee)
    
    // Create private channel with only Alice and Bob
    channelID := createPrivateChannel(aliceToken, "engineering", []string{aliceID, bobID})
    
    // Carol tries to upload
    client := rpcv1connect.NewFileServiceClient(http.DefaultClient, "http://localhost:18080")
    req := connect.NewRequest(&rpcv1.RequestUploadUrlRequest{
        Filename:      "secret.pdf",
        SizeBytes:     1024,
        MimeType:      "application/pdf",
        UploadContext: "chat",
        ContextId:     channelID.String(),  // Channel Carol is NOT member of
    })
    req.Header().Set("Authorization", "Bearer "+carolToken)
    
    _, err := client.RequestUploadUrl(context.Background(), req)
    
    // Assert: Request blocked
    require.Error(t, err)
    assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
    assert.Contains(t, err.Error(), "cannot upload files to this context")
}
```

**Scenario 1b**: Access scope derived from channel.is_private
```go
func TestUpload_AccessScopeDerived(t *testing.T) {
    // Upload to private channel
    privateFileID := uploadFile(aliceToken, privateChannelID, "private.pdf")
    
    // Verify access_scope="private"
    accessRule := queryAccessRule(orgID, privateFileID)
    assert.Equal(t, "private", accessRule.AccessScope)
    
    // Upload to public channel
    publicFileID := uploadFile(aliceToken, publicChannelID, "public.pdf")
    
    // Verify access_scope="public" (derived from channel.is_private=false)
    accessRule = queryAccessRule(orgID, publicFileID)
    assert.Equal(t, "public", accessRule.AccessScope)
}
```

---

## References

- OWASP: Insecure Direct Object References (IDOR)
- OWASP: Broken Access Control (A01:2021)
- Constitution v5.7.0 Principle III (Business Logic in Logic Layer)
- Constitution v5.7.0 Principle IV (Cross-Domain Integration for membership checks)
