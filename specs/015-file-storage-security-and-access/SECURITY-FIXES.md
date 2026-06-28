# Security Fixes: File Access Control Integration

**Date**: 2025-11-12  
**Feature**: 015 - File Storage Security and Access Improvement

## Critical Security Gap Identified

The original plan focused on NEW security features (validation, search, PDF conversion) but **did not explicitly address protecting EXISTING file operations** from the Feature 014 file service. This created a major vulnerability where any employee could access ANY file if they knew or guessed the file ID.

---

## Vulnerable Methods (Before Fix)

### ❌ GetDownloadUrl
**Vulnerability**: Any employee can get presigned download URL for ANY file
```go
// BEFORE (VULNERABLE)
func (s *FileService) GetDownloadUrl(ctx context.Context, req *connect.Request[v1.GetDownloadUrlRequest]) (*connect.Response[v1.GetDownloadUrlResponse], error) {
    // No access control check!
    presignedURL := s.r2Client.GeneratePresignedURL(fileID) 
    return &v1.GetDownloadUrlResponse{DownloadUrl: presignedURL}, nil
}
```

**Attack**: Employee guesses or discovers file_id from network traffic, calls GetDownloadUrl, downloads sensitive HR documents

---

### ❌ GetFileMetadata
**Vulnerability**: Any employee can see metadata (filename, size, uploader) for ANY file
```go
// BEFORE (VULNERABLE)
func (s *FileService) GetFileMetadata(ctx context.Context, req *connect.Request[v1.GetFileMetadataRequest]) (*connect.Response[v1.GetFileMetadataResponse], error) {
    // No access control check!
    file := s.queries.GetFileMetadata(ctx, fileID)
    return &v1.GetFileMetadataResponse{File: file}, nil
}
```

**Attack**: Employee iterates through file IDs, harvests filenames like "confidential_salary_report.xlsx", knows who uploaded what

---

### ❌ GetFileMetadataBatch  
**Vulnerability**: Batch version allows scraping metadata for 100 files per request
```go
// BEFORE (VULNERABLE)
func (s *FileService) GetFileMetadataBatch(ctx context.Context, req *connect.Request[v1.GetFileMetadataBatchRequest]) (*connect.Response[v1.GetFileMetadataBatchResponse], error) {
    // No access control check!
    files := s.queries.GetFileMetadataBatch(ctx, fileIDs)
    return &v1.GetFileMetadataBatchResponse{Files: files}, nil
}
```

**Attack**: Employee scripts batch requests with sequential UUIDs, harvests 1000s of file metadata records in minutes

---

### ❌ ConfirmUpload
**Vulnerability**: Files uploaded without access rules can be accessed by anyone in organization
```go
// BEFORE (INCOMPLETE)
func (s *FileService) ConfirmUpload(ctx context.Context, req *connect.Request[v1.ConfirmUploadRequest]) (*connect.Response[v1.ConfirmUploadResponse], error) {
    file := s.queries.InsertFileMetadata(ctx, metadata)
    // Missing: Create file_access_rule!
    return &v1.ConfirmUploadResponse{File: file}, nil
}
```

**Attack**: Race condition - file exists in DB but no access rule, any employee can access during window

---

## Security Fixes Applied

### ✅ GetDownloadUrl - Access Control Added
```go
// AFTER (SECURE)
func (s *FileService) GetDownloadUrl(ctx context.Context, req *connect.Request[v1.GetDownloadUrlRequest]) (*connect.Response[v1.GetDownloadUrlResponse], error) {
    orgID := interceptor.OrgIDFromContext(ctx)
    employeeID := interceptor.EmployeeIDFromContext(ctx)
    
    err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
        // CHECK ACCESS FIRST
        accessResult, err := s.AccessLogic.CheckFileAccess(ctx, tx, orgID, employeeID, fileID)
        if err != nil {
            return err
        }
        if !accessResult.HasAccess {
            return connect.NewError(connect.CodePermissionDenied, 
                fmt.Errorf("You don't have permission to access this file: %s", accessResult.DenialReason))
        }
        
        // Only generate URL if access granted
        presignedURL = s.r2Client.GeneratePresignedURL(fileID)
        return nil
    })
    
    return &v1.GetDownloadUrlResponse{DownloadUrl: presignedURL}, nil
}
```

**Protection**: 
- ✅ Verifies employee is member of file's context (channel, project, department)
- ✅ Respects access_scope (public, private, department)
- ✅ Always allows file uploader
- ✅ Logs denied access attempts for security monitoring

---

### ✅ GetFileMetadata - Access Control Added
```go
// AFTER (SECURE)
func (s *FileService) GetFileMetadata(ctx context.Context, req *connect.Request[v1.GetFileMetadataRequest]) (*connect.Response[v1.GetFileMetadataResponse], error) {
    orgID := interceptor.OrgIDFromContext(ctx)
    employeeID := interceptor.EmployeeIDFromContext(ctx)
    
    err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
        // CHECK ACCESS FIRST
        accessResult, err := s.AccessLogic.CheckFileAccess(ctx, tx, orgID, employeeID, fileID)
        if err != nil {
            return err
        }
        if !accessResult.HasAccess {
            // Return generic error - don't reveal file existence
            return connect.NewError(connect.CodePermissionDenied, 
                errors.New("File not found or access denied"))
        }
        
        file = s.queries.GetFileMetadata(ctx, tx, orgID, fileID)
        return nil
    })
    
    return &v1.GetFileMetadataResponse{File: file}, nil
}
```

**Protection**:
- ✅ Prevents metadata leakage (filename, size, uploader info)
- ✅ Generic error message prevents file existence probing
- ✅ Same access check as download

---

### ✅ GetFileMetadataBatch - Silent Filtering
```go
// AFTER (SECURE)
func (s *FileService) GetFileMetadataBatch(ctx context.Context, req *connect.Request[v1.GetFileMetadataBatchRequest]) (*connect.Response[v1.GetFileMetadataBatchResponse], error) {
    orgID := interceptor.OrgIDFromContext(ctx)
    employeeID := interceptor.EmployeeIDFromContext(ctx)
    
    var allowedFiles []*v1.FileMetadata
    var deniedCount int
    
    err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
        for _, fileID := range req.Msg.FileIds {
            // CHECK ACCESS FOR EACH FILE
            accessResult, err := s.AccessLogic.CheckFileAccess(ctx, tx, orgID, employeeID, fileID)
            if err != nil {
                continue // Skip files with errors
            }
            if !accessResult.HasAccess {
                deniedCount++
                continue // SILENTLY SKIP unauthorized files
            }
            
            // Only include accessible files
            file, err := s.queries.GetFileMetadata(ctx, tx, orgID, fileID)
            if err == nil {
                allowedFiles = append(allowedFiles, file)
            }
        }
        return nil
    })
    
    slog.InfoContext(ctx, "GetFileMetadataBatch",
        "requested_count", len(req.Msg.FileIds),
        "allowed_count", len(allowedFiles),
        "denied_count", deniedCount)
    
    return &v1.GetFileMetadataBatchResponse{Files: allowedFiles}, nil
}
```

**Protection**:
- ✅ Checks access for EACH file individually
- ✅ Silently excludes unauthorized files (no error returned)
- ✅ Prevents bulk metadata scraping attacks
- ✅ Privacy: Don't reveal which files exist but are denied (prevents reconnaissance)
- ✅ Logs filtered counts for security monitoring

---

### ✅ ConfirmUpload - Atomic Access Rule Creation
```go
// AFTER (SECURE)
func (s *FileService) ConfirmUpload(ctx context.Context, req *connect.Request[v1.ConfirmUploadRequest]) (*connect.Response[v1.ConfirmUploadResponse], error) {
    orgID := interceptor.OrgIDFromContext(ctx)
    employeeID := interceptor.EmployeeIDFromContext(ctx)
    
    var file *v1.FileMetadata
    
    err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
        // Insert file metadata
        file, err = s.queries.InsertFileMetadata(ctx, tx, metadata)
        if err != nil {
            return err
        }
        
        // CREATE ACCESS RULE ATOMICALLY
        contextType, contextID := parseUploadContext(metadata.UploadContext)
        accessScope := determineDefaultScope(contextType) // chat=private, docs=department
        
        _, err = s.AccessLogic.SetFileAccessRule(ctx, tx, orgID, file.Id, contextType, contextID, accessScope)
        if err != nil {
            return err // Transaction rolls back
        }
        
        return nil
    })
    
    return &v1.ConfirmUploadResponse{File: file}, nil
}
```

**Protection**:
- ✅ Creates access rule in SAME transaction as metadata insert (atomicity)
- ✅ No race condition window where file exists without access control
- ✅ Default access scope based on upload context (secure by default)
- ✅ Transaction rollback if access rule creation fails

---

## Updated Tasks in tasks.md

Added new tasks T037a-T037d to implement these security fixes:

- **T037a**: Update GetDownloadUrl with access control check
- **T037b**: Update GetFileMetadata with access control check  
- **T037c**: Update GetFileMetadataBatch with per-file access checks and silent filtering
- **T037d**: Update ConfirmUpload to create access rule atomically

---

## Updated Integration Tests

Enhanced `files_access_control_test.go` (T053) with additional test scenarios:

- **Scenario 4**: Carol attempts download via GetDownloadUrl → CodePermissionDenied
- **Scenario 5**: Carol calls GetFileMetadata → CodePermissionDenied (no metadata leak)
- **Scenario 6**: Carol calls GetFileMetadataBatch with mixed files → only allowed files returned
- **Scenario 7**: Channel becomes public → Carol can now access file (dynamic permissions)
- **Scenario 8**: Carol tries GetFileMetadataBatch with 100 guessed IDs → empty/partial results (scraping attack blocked)

---

## Proto Documentation

Added security comments to `backend/rpc/v1/files.proto`:

```proto
// GetDownloadUrl generates presigned URL for file download from R2
// SECURITY: Must check file_access_rule before generating URL (Feature 015)

// GetFileMetadata retrieves file information without generating download URL
// SECURITY: Must check file_access_rule before returning metadata (Feature 015)

// GetFileMetadataBatch retrieves multiple file metadata in a single request
// SECURITY: Must check file_access_rule for EACH file, silently filter unauthorized (Feature 015)
// Privacy: Don't return errors for unauthorized files (prevents file existence probing)

// ConfirmUpload records file metadata after successful R2 upload
// SECURITY: Must create file_access_rule atomically with metadata insert (Feature 015)
```

---

## Attack Mitigation Summary

| Attack Vector | Before Fix | After Fix |
|--------------|------------|-----------|
| Direct download via guessed file_id | ❌ Succeeds | ✅ Blocked with CodePermissionDenied |
| Metadata scraping via GetFileMetadataBatch | ❌ Returns all metadata | ✅ Silently filters unauthorized files |
| File existence probing | ❌ Error reveals file exists | ✅ Generic error, no info leak |
| Race condition on upload | ❌ File accessible before access rule | ✅ Atomic transaction, no window |
| Cross-channel file access | ❌ Any employee can access | ✅ Respects channel membership |

---

## Constitutional Compliance

These fixes align with Tech Office Constitution v5.7.0:

- **Principle I**: Multi-tenant isolation with organization_id filters
- **Principle III**: Access logic in logic layer, verification in connect layer
- **Principle IV**: Cross-domain integration (chat.ChannelLogic for membership checks)
- **Principle V**: Observability with structured logging of denied access attempts

---

## Migration Impact

**Existing installations upgrading to Feature 015**:

1. **Data migration required**: Existing files need access rules created retroactively
2. **Migration script** should:
   - Query all files without access rules
   - Create default access rules based on upload_context
   - Default to `access_scope=private` for safety
3. **Breaking change**: Apps calling GetDownloadUrl/GetFileMetadata will start receiving permission errors
4. **Communication**: Notify users that file access is now context-based

---

## Related Security Documentation

See also: **[UPLOAD-SECURITY.md](./UPLOAD-SECURITY.md)** for upload flow security:
- Context verification at RequestUploadUrl (prevents uploading to unauthorized contexts)
- Access scope derivation from context properties (prevents client manipulation)
- Upload hijacking prevention (verify uploader identity)

---

## References

- Constitution v5.7.0 Principle I (Multi-Tenancy)
- Constitution v5.7.0 Principle III (Two-Layer Architecture)
- Constitution v5.7.0 Principle IV (Cross-Domain Integration)
- OWASP: Insecure Direct Object References (IDOR)
- OWASP: Information Exposure Through Metadata
- OWASP: Broken Access Control (A01:2021)
