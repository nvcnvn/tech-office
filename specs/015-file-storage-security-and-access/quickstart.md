# Quickstart Test Guide: File Storage Security and Access Improvement

**Feature**: File Storage Security and Access Improvement  
**Date**: 2025-11-12  
**Purpose**: Validate feature implementation through manual and integration tests

## Prerequisites

### Environment Setup

```bash
# Start local development environment
cd backend
docker compose up -d

# Apply database migrations
./scripts/migrate.sh

# Start backend server
go run cmd/main.go

# Start frontend (separate terminal)
cd frontend/apps/web
pnpm dev
```

### Test Data Setup

```bash
# Create test organization and employees
psql -U postgres -d tech_office_db << EOF
-- Test organization
INSERT INTO public.organization (id, company_name, subdomain, project_id, app_id, status)
VALUES ('01234567-89ab-cdef-0123-456789abcdef', 'Test Corp', 'test', 
        gen_random_uuid(), gen_random_uuid(), 'active');

-- Test employees (Alice: owner, Bob: employee, Carol: employee)
INSERT INTO iam.identity (id, organization_id, email, identity_type)
VALUES 
    ('alice-uuid', '01234567-89ab-cdef-0123-456789abcdef', 'alice@test.com', 'human'),
    ('bob-uuid', '01234567-89ab-cdef-0123-456789abcdef', 'bob@test.com', 'human'),
    ('carol-uuid', '01234567-89ab-cdef-0123-456789abcdef', 'carol@test.com', 'human');

INSERT INTO iam.identity_role (id, organization_id, identity_id, role)
VALUES 
    (uuidv7(), '01234567-89ab-cdef-0123-456789abcdef', 'alice-uuid', 'owner'),
    (uuidv7(), '01234567-89ab-cdef-0123-456789abcdef', 'bob-uuid', 'employee'),
    (uuidv7(), '01234567-89ab-cdef-0123-456789abcdef', 'carol-uuid', 'employee');

INSERT INTO organization.employee (id, organization_id, given_name, family_name, is_active)
VALUES 
    ('alice-uuid', '01234567-89ab-cdef-0123-456789abcdef', 'Alice', 'Admin', true),
    ('bob-uuid', '01234567-89ab-cdef-0123-456789abcdef', 'Bob', 'Builder', true),
    ('carol-uuid', '01234567-89ab-cdef-0123-456789abcdef', 'Carol', 'Coder', true);

-- Test chat channel (private)
INSERT INTO chat.channel (id, organization_id, title_slug, display_name, channel_type, is_private, created_by_employee_id)
VALUES ('channel-uuid', '01234567-89ab-cdef-0123-456789abcdef', 'engineering', 'Engineering Team', 'chat', true, 'alice-uuid');

-- Channel memberships (Alice and Bob are members, Carol is NOT)
INSERT INTO chat.channel_membership (id, organization_id, channel_id, employee_id, notification_preference)
VALUES 
    (uuidv7(), '01234567-89ab-cdef-0123-456789abcdef', 'channel-uuid', 'alice-uuid', 'all'),
    (uuidv7(), '01234567-89ab-cdef-0123-456789abcdef', 'channel-uuid', 'bob-uuid', 'all');
EOF
```

---

## Test Scenarios

### Scenario 1: File Upload with Type Validation

**User Story**: As an employee, when I upload a file, the system validates that the file type matches what I claim it is.

**Test Steps**:

1. **Upload a valid DOCX file**:
   ```bash
   # Create test DOCX file (valid Office Open XML)
   echo -e "PK\x03\x04" > test.docx  # Valid ZIP magic bytes (DOCX is a ZIP)
   
   # Upload via frontend
   # - Login as Alice
   # - Navigate to Engineering Team channel
   # - Attach test.docx file
   # - Submit message with attachment
   ```

   **Expected Result**:
   - ✅ File uploads successfully
   - ✅ Validation status: `verified`
   - ✅ No warning badge displayed
   - ✅ File appears in channel message

2. **Upload a renamed PNG as PDF (type mismatch)**:
   ```bash
   # Create PNG file but name it as PDF
   echo -e "\x89PNG\r\n\x1a\n" > malicious.pdf  # PNG magic bytes
   
   # Upload via frontend
   # - Login as Alice
   # - Attach malicious.pdf to channel message
   ```

   **Expected Result**:
   - ✅ File uploads successfully (WARN policy, not blocked)
   - ✅ Validation status: `warning`
   - ⚠️ Warning badge displayed on file attachment
   - ℹ️ Tooltip shows: "File type mismatch: declared application/pdf, detected image/png"
   - ✅ File still downloadable

3. **Upload a corrupted file**:
   ```bash
   # Create file with random bytes
   dd if=/dev/urandom of=corrupted.xlsx bs=1K count=1
   
   # Upload via frontend
   ```

   **Expected Result**:
   - ✅ File uploads successfully
   - ✅ Validation status: `failed`
   - ⚠️ Warning badge displayed
   - ℹ️ Tooltip shows: "Unable to verify file type"

**Validation via Backend**:
```bash
# Query validation results
psql -U postgres -d tech_office_db << EOF
SELECT 
    original_filename,
    mime_type,
    detected_mime_type,
    validation_status,
    validation_message
FROM files.file_metadata
WHERE organization_id = '01234567-89ab-cdef-0123-456789abcdef'
ORDER BY updated_at DESC
LIMIT 10;
EOF
```

**Integration Test** (`backend/integration/files_validation_test.go`):
```go
func TestFileValidation_TypeMismatch(t *testing.T) {
    // Get test identity
    orgID, employeeID, token := GetRandomTestIdentityAndKey(iam.IdentityRoleEmployee)
    
    // Upload PNG file claiming to be PDF
    pngBytes := []byte("\x89PNG\r\n\x1a\n...")
    uploadResp := uploadFile(token, "malicious.pdf", "application/pdf", pngBytes)
    
    // Validate file
    client := rpcv1connect.NewFileServiceClient(http.DefaultClient, "http://localhost:18080")
    req := connect.NewRequest(&rpcv1.ValidateFileRequest{
        FileId: uploadResp.FileId,
    })
    req.Header().Set("Authorization", "Bearer "+token)
    
    resp, err := client.ValidateFile(context.Background(), req)
    require.NoError(t, err)
    
    // Assertions
    assert.Equal(t, rpcv1.ValidationStatus_VALIDATION_STATUS_WARNING, resp.Msg.ValidationResult.Status)
    assert.Contains(t, resp.Msg.ValidationResult.Message, "type mismatch")
    assert.Equal(t, "application/pdf", resp.Msg.ValidationResult.DeclaredMimeType)
    assert.Equal(t, "image/png", resp.Msg.ValidationResult.DetectedMimeType)
}
```

---

### Scenario 2: Context-Based Access Control

**User Story**: As an employee, I can only access files uploaded to contexts (channels, projects) where I am a member.

**Test Steps**:

1. **Alice uploads file to private channel**:
   ```bash
   # Login as Alice
   # Upload report.pdf to Engineering Team channel (private)
   # File ID: file-1-uuid
   ```

   **Expected Result**:
   - ✅ File uploaded successfully
   - ✅ Access rule created: context_type=chat_channel, context_id=channel-uuid, access_scope=private

2. **Bob (member) accesses the file**:
   ```bash
   # Login as Bob
   # Navigate to Engineering Team channel
   # Click on report.pdf attachment
   ```

   **Expected Result**:
   - ✅ File preview opens successfully
   - ✅ Download button works
   - ✅ No permission error

3. **Carol (non-member) tries to access the file**:
   ```bash
   # Login as Carol
   # Try to access file via direct link: /files/file-1-uuid/preview
   ```

   **Expected Result**:
   - ❌ Access denied error
   - ℹ️ Error message: "You don't have permission to access this file"
   - ❌ Download button disabled
   - ❌ Preview not shown

4. **Channel becomes public**:
   ```bash
   # Login as Alice (owner)
   # Change Engineering Team channel to public
   ```

   **Expected Result**:
   - ✅ Access rule updated: access_scope=public
   - ✅ Carol can now access report.pdf
   - ✅ All organization members can access

5. **Carol leaves organization**:
   ```bash
   # Admin deletes Carol's employee record
   psql -U postgres -d tech_office_db << EOF
   UPDATE organization.employee 
   SET is_active = false 
   WHERE id = 'carol-uuid' AND organization_id = '01234567-89ab-cdef-0123-456789abcdef';
   EOF
   ```

   **Expected Result**:
   - ❌ Carol can no longer access any files in organization
   - ✅ Carol's uploaded files remain accessible to other members

**Validation via Backend**:
```bash
# Check access rules
psql -U postgres -d tech_office_db << EOF
SELECT 
    fm.original_filename,
    far.context_type,
    far.access_scope,
    fm.uploaded_by_employee_id
FROM files.file_metadata fm
INNER JOIN files.file_access_rule far ON (fm.organization_id, fm.id) = (far.organization_id, far.file_id)
WHERE fm.organization_id = '01234567-89ab-cdef-0123-456789abcdef';
EOF
```

**Integration Test** (`backend/integration/files_access_test.go`):
```go
func TestFileAccess_PrivateChannel(t *testing.T) {
    // Setup: Create private channel with Alice and Bob as members
    orgID, aliceID, aliceToken := GetRandomTestIdentityAndKey(iam.IdentityRoleEmployee)
    _, bobID, bobToken := GetTestIdentityInOrganization(orgID, iam.IdentityRoleEmployee)
    _, carolID, carolToken := GetTestIdentityInOrganization(orgID, iam.IdentityRoleEmployee)
    
    channelID := createPrivateChannel(aliceToken, "Engineering", []string{aliceID, bobID})
    
    // Alice uploads file to channel
    fileID := uploadFileToChannel(aliceToken, channelID, "report.pdf")
    
    // Bob (member) can access
    bobResp := checkAccess(bobToken, fileID)
    assert.True(t, bobResp.HasAccess)
    
    // Carol (non-member) cannot access
    carolResp := checkAccess(carolToken, fileID)
    assert.False(t, carolResp.HasAccess)
    assert.Contains(t, carolResp.DenialReason, "not a member")
}
```

---

### Scenario 3: File Search with Access Filtering

**User Story**: As an employee, I can search for files by name and content, and only see files I have access to.

**Test Steps**:

1. **Setup test files**:
   ```bash
   # Login as Alice
   # Upload to Engineering channel (private, Alice+Bob members):
   # - project_proposal.docx (content: "Q4 marketing campaign")
   # - budget.xlsx (content: "Engineering department budget 2024")
   
   # Upload to Public Announcements channel (public):
   # - company_handbook.pdf (content: "Employee handbook and policies")
   ```

2. **Alice searches for "engineering"**:
   ```bash
   # Login as Alice
   # Use global search bar: "engineering"
   # Switch to "Files" category tab
   ```

   **Expected Result**:
   - ✅ Returns: budget.xlsx (content match)
   - ✅ Shows excerpt: "...Engineering department budget..."
   - ✅ Shows context: "Engineering Team channel"
   - ✅ Relevance score sorted (content match higher than filename match)

3. **Bob searches for "marketing"**:
   ```bash
   # Login as Bob (member of Engineering channel)
   # Search: "marketing"
   ```

   **Expected Result**:
   - ✅ Returns: project_proposal.docx (content match)
   - ✅ Bob can access (he's a channel member)

4. **Carol searches for "marketing"**:
   ```bash
   # Login as Carol (NOT member of Engineering channel)
   # Search: "marketing"
   ```

   **Expected Result**:
   - ❌ Returns: 0 results
   - ℹ️ project_proposal.docx filtered out (Carol not in channel)

5. **Carol searches for "handbook"**:
   ```bash
   # Login as Carol
   # Search: "handbook"
   ```

   **Expected Result**:
   - ✅ Returns: company_handbook.pdf
   - ✅ Carol can access (public channel file)

**Validation via Backend**:
```bash
# Check indexed files
psql -U postgres -d tech_office_db << EOF
SELECT 
    fm.original_filename,
    fci.indexing_status,
    LENGTH(fci.extracted_text) AS text_length,
    fci.extraction_method,
    far.access_scope
FROM files.file_metadata fm
INNER JOIN files.file_content_index fci ON (fm.organization_id, fm.id) = (fci.organization_id, fci.file_id)
INNER JOIN files.file_access_rule far ON (fm.organization_id, fm.id) = (far.organization_id, far.file_id)
WHERE fm.organization_id = '01234567-89ab-cdef-0123-456789abcdef';
EOF

# Test PGroonga search directly
psql -U postgres -d tech_office_db << EOF
SELECT 
    fm.original_filename,
    pgroonga_score(fci.extracted_text) AS score
FROM files.file_metadata fm
INNER JOIN files.file_content_index fci ON (fm.organization_id, fm.id) = (fci.organization_id, fci.file_id)
WHERE fci.extracted_text &@~ 'engineering';
EOF
```

**Integration Test** (`backend/integration/files_search_test.go`):
```go
func TestFileSearch_AccessFiltering(t *testing.T) {
    // Setup organization with Alice, Bob, Carol
    orgID, aliceID, aliceToken := GetRandomTestIdentityAndKey(iam.IdentityRoleEmployee)
    _, bobID, bobToken := GetTestIdentityInOrganization(orgID, iam.IdentityRoleEmployee)
    _, carolID, carolToken := GetTestIdentityInOrganization(orgID, iam.IdentityRoleEmployee)
    
    // Create private channel with Alice and Bob
    privateChannelID := createPrivateChannel(aliceToken, "Engineering", []string{aliceID, bobID})
    
    // Alice uploads file to private channel
    fileID := uploadFileToChannel(aliceToken, privateChannelID, "secret.docx", "confidential engineering data")
    
    // Wait for indexing to complete
    waitForIndexingComplete(fileID)
    
    // Bob (member) can find file in search
    bobResults := searchFiles(bobToken, "engineering")
    assert.Contains(t, bobResults.FileIDs, fileID)
    
    // Carol (non-member) cannot find file in search
    carolResults := searchFiles(carolToken, "engineering")
    assert.NotContains(t, carolResults.FileIDs, fileID)
}
```

---

### Scenario 4: PDF Preview Conversion

**User Story**: As an employee, I can preview office documents as PDFs in my browser without downloading them.

**Test Steps**:

1. **Upload small DOCX file (<50MB)**:
   ```bash
   # Login as Alice
   # Upload report.docx (5MB) to Engineering channel
   ```

   **Expected Result**:
   - ✅ File uploads successfully
   - ⏳ PDF conversion starts automatically (async)
   - ✅ Conversion status: `pending` → `in_progress` → `completed`
   - ⏱️ Conversion completes within 30 seconds
   - ✅ PDF stored in R2: `org-{org_id}/conversions/{file_id}.pdf`

2. **Preview converted PDF**:
   ```bash
   # Click "Preview" button on report.docx attachment
   ```

   **Expected Result**:
   - ✅ PDF preview modal opens
   - ✅ PDF displays in browser (using PDFViewer component)
   - ✅ Page navigation works
   - ✅ Download button available
   - ✅ Access control still enforced (only Bob and Alice can preview)

3. **Upload large XLSX file (>50MB)**:
   ```bash
   # Upload large_dataset.xlsx (60MB)
   ```

   **Expected Result**:
   - ✅ File uploads successfully
   - ⚠️ PDF conversion skipped (size limit exceeded)
   - ℹ️ User sees message: "File too large for preview (max 50MB). Download to view."
   - ✅ Download button works normally

4. **Conversion failure handling**:
   ```bash
   # Upload corrupted.pptx (valid ZIP but corrupted PPTX structure)
   ```

   **Expected Result**:
   - ✅ File uploads successfully
   - ⏳ Conversion starts
   - ❌ Conversion fails after 30 seconds
   - ✅ Conversion status: `failed`
   - ℹ️ Preview button shows: "Preview unavailable. Download to view."
   - ✅ Download button still works
   - ✅ Error logged for ops investigation

**Validation via Backend**:
```bash
# Check conversion status
psql -U postgres -d tech_office_db << EOF
SELECT 
    fm.original_filename,
    fpc.conversion_status,
    fpc.conversion_error,
    fpc.conversion_duration_ms,
    fpc.pdf_size_bytes
FROM files.file_pdf_conversion fpc
INNER JOIN files.file_metadata fm ON (fpc.organization_id, fpc.original_file_id) = (fm.organization_id, fm.id)
WHERE fm.organization_id = '01234567-89ab-cdef-0123-456789abcdef';
EOF

# Check Gotenberg health
curl http://gotenberg:3000/health
```

**Integration Test** (`backend/integration/files_pdf_conversion_test.go`):
```go
func TestPDFConversion_OfficeDocs(t *testing.T) {
    // Upload DOCX file
    orgID, employeeID, token := GetRandomTestIdentityAndKey(iam.IdentityRoleEmployee)
    docxBytes := createTestDOCX("Hello World")
    fileID := uploadFile(token, "test.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docxBytes)
    
    // Wait for conversion (up to 60s)
    var conversionStatus string
    for i := 0; i < 60; i++ {
        status := getPDFConversionStatus(token, fileID)
        if status == "completed" || status == "failed" {
            conversionStatus = status
            break
        }
        time.Sleep(1 * time.Second)
    }
    
    // Assertions
    assert.Equal(t, "completed", conversionStatus)
    
    // Get PDF download URL
    pdfURL := getPDFDownloadURL(token, fileID)
    assert.NotEmpty(t, pdfURL)
    
    // Download and verify PDF
    pdfBytes := downloadFile(pdfURL)
    assert.True(t, bytes.HasPrefix(pdfBytes, []byte("%PDF-")))
}
```

---

### Scenario 5: File Deletion Cleanup

**User Story**: When a file is deleted, all related data (access rules, PDF conversions, search indexes) are also cleaned up.

**Test Steps**:

1. **Upload and process file**:
   ```bash
   # Login as Alice
   # Upload document.docx to Engineering channel
   # Wait for PDF conversion and indexing to complete
   ```

   **Before Deletion**:
   ```sql
   -- Verify all data exists
   SELECT COUNT(*) FROM files.file_metadata WHERE id = 'file-uuid';  -- 1
   SELECT COUNT(*) FROM files.file_access_rule WHERE file_id = 'file-uuid';  -- 1
   SELECT COUNT(*) FROM files.file_pdf_conversion WHERE original_file_id = 'file-uuid';  -- 1
   SELECT COUNT(*) FROM files.file_content_index WHERE file_id = 'file-uuid';  -- 1
   ```

2. **Delete file**:
   ```bash
   # Login as Alice (uploader)
   # Click "Delete" button on document.docx
   # Confirm deletion
   ```

   **Expected Result**:
   - ✅ File soft-deleted: `is_deleted = TRUE`
   - ✅ Cascade deletes triggered:
     * files.file_access_rule row deleted
     * files.file_pdf_conversion row deleted
     * files.file_content_index row deleted
   - ✅ R2 objects deleted (original file + converted PDF)
   - ✅ File no longer appears in search results
   - ✅ Direct access via link shows "File deleted" message

3. **Verify cleanup**:
   ```sql
   SELECT COUNT(*) FROM files.file_metadata WHERE id = 'file-uuid';  -- 1 (soft delete, not removed)
   SELECT COUNT(*) FROM files.file_access_rule WHERE file_id = 'file-uuid';  -- 0 (CASCADE)
   SELECT COUNT(*) FROM files.file_pdf_conversion WHERE original_file_id = 'file-uuid';  -- 0 (CASCADE)
   SELECT COUNT(*) FROM files.file_content_index WHERE file_id = 'file-uuid';  -- 0 (CASCADE)
   ```

**Integration Test** (`backend/integration/files_deletion_test.go`):
```go
func TestFileDeletion_CascadeCleanup(t *testing.T) {
    // Upload file with full processing
    orgID, employeeID, token := GetRandomTestIdentityAndKey(iam.IdentityRoleEmployee)
    fileID := uploadFile(token, "test.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", testDocxBytes)
    
    // Wait for processing
    waitForConversionComplete(fileID)
    waitForIndexingComplete(fileID)
    
    // Verify all data exists
    assert.True(t, fileMetadataExists(orgID, fileID))
    assert.True(t, accessRuleExists(orgID, fileID))
    assert.True(t, pdfConversionExists(orgID, fileID))
    assert.True(t, contentIndexExists(orgID, fileID))
    
    // Delete file
    deleteFile(token, fileID)
    
    // Verify cascade deletion
    assert.True(t, fileMetadataMarkedDeleted(orgID, fileID))
    assert.False(t, accessRuleExists(orgID, fileID))
    assert.False(t, pdfConversionExists(orgID, fileID))
    assert.False(t, contentIndexExists(orgID, fileID))
    
    // Verify R2 cleanup
    assert.False(t, r2ObjectExists(orgID, fileID))
}
```

---

## Performance Validation

### Load Testing

```bash
# Use k6 for load testing
k6 run - <<EOF
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  vus: 100,  // 100 concurrent users
  duration: '5m',
};

export default function () {
  // Upload file
  let formData = {
    file: http.file(open('test.docx'), 'test.docx'),
    context: 'chat_channel',
    context_id: 'channel-uuid',
  };
  
  let res = http.post('http://localhost:18080/files/upload', formData, {
    headers: { 'Authorization': 'Bearer ' + __ENV.TEST_TOKEN },
  });
  
  check(res, {
    'upload successful': (r) => r.status === 200,
    'upload < 500ms': (r) => r.timings.duration < 500,
  });
  
  sleep(1);
}
EOF
```

### Performance Benchmarks

| Operation | Target | Actual | Status |
|-----------|--------|--------|--------|
| File upload + validation | <500ms p95 | _TBD_ | ⏳ |
| File type validation | <100ms p95 | _TBD_ | ⏳ |
| Access control check | <50ms p95 | _TBD_ | ⏳ |
| Search query | <300ms p95 | _TBD_ | ⏳ |
| PDF conversion (5MB DOCX) | <30s | _TBD_ | ⏳ |
| Content indexing (5MB DOCX) | <15s | _TBD_ | ⏳ |

---

## Troubleshooting

### Common Issues

**Issue 1: PDF conversion stuck in "pending"**
```bash
# Check Gotenberg service health
kubectl get pods -l app=gotenberg
kubectl logs deployment/gotenberg

# Check Flows workflow status in database
psql -U postgres -d tech_office_db << EOF
SELECT id, workflow_name, status, error, updated_at
FROM flows.workflow_execution
WHERE workflow_name = 'file-processing-workflow'
  AND status IN ('running', 'failed')
ORDER BY updated_at DESC
LIMIT 10;
EOF

# Manually retry conversion
curl -X POST http://localhost:18080/api/v1/files/trigger-conversion \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"file_id": "stuck-file-uuid"}'
```

**Issue 2: Search not returning expected results**
```bash
# Check indexing status
psql -U postgres -d tech_office_db << EOF
SELECT 
    original_filename,
    indexing_status,
    indexing_error
FROM files.file_content_index fci
INNER JOIN files.file_metadata fm ON fci.file_id = fm.id
WHERE indexing_status != 'completed';
EOF

# Test PGroonga directly
psql -U postgres -d tech_office_db << EOF
SELECT * FROM files.file_content_index WHERE extracted_text &@~ 'your query';
EOF

# Rebuild PGroonga index if corrupted
psql -U postgres -d tech_office_db << EOF
REINDEX INDEX files.idx_file_content_pgroonga;
EOF
```

**Issue 3: Access denied unexpectedly**
```bash
# Check user's channel membership
psql -U postgres -d tech_office_db << EOF
SELECT 
    c.display_name,
    cm.employee_id
FROM chat.channel c
INNER JOIN chat.channel_membership cm ON c.id = cm.channel_id
WHERE cm.employee_id = 'user-uuid';
EOF

# Check file access rule
psql -U postgres -d tech_office_db << EOF
SELECT 
    fm.original_filename,
    far.context_type,
    far.context_id,
    far.access_scope
FROM files.file_access_rule far
INNER JOIN files.file_metadata fm ON far.file_id = fm.id
WHERE fm.id = 'file-uuid';
EOF
```

---

## Success Criteria Checklist

Feature implementation is complete when:

- [ ] All acceptance scenarios from spec.md pass
- [ ] All integration tests pass
- [ ] Performance targets met (SLOs)
- [ ] No P0/P1 bugs in production rollout
- [ ] Security review approved
- [ ] Documentation complete (API docs, user guide)
- [ ] Monitoring alerts configured
- [ ] Rollback plan tested

---

## Next Steps

1. ✅ Run automated integration tests: `cd backend && go test ./integration/files_*_test.go`
2. ✅ Execute manual test scenarios in dev environment
3. ✅ Performance validation with load testing
4. ✅ Security review (access control, validation bypass attempts)
5. ✅ Deploy to staging environment
6. ✅ Stakeholder demo and sign-off
7. ✅ Production deployment
8. ✅ Post-deployment monitoring

---

**Status**: ✅ Quickstart guide complete, ready for testing phase
