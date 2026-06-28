-- Employee Import sqlc Queries
-- These queries will be added to backend/database/scripts/iam.query.sql
-- They support bulk employee import operations with multi-tenant isolation

-- ===============================================
-- Duplicate Detection Queries
-- ===============================================

-- name: CheckDuplicateEmailsBatch :many
-- Check if emails already exist in an organization
-- Used in preview step to detect duplicates before import
-- Performance: Uses idx_iam_identity_org_email index
SELECT 
    email,
    id as identity_id,
    email_verified,
    updated_at
FROM iam.identity
WHERE organization_id = $1
  AND email = ANY($2::text[])
ORDER BY email;

-- name: CheckSingleEmailExists :one
-- Check if a single email exists (for inline validation)
SELECT COUNT(*) as count
FROM iam.identity
WHERE organization_id = $1
  AND email = $2;

-- ===============================================
-- Batch Insert Queries (COPY Protocol)
-- ===============================================

-- name: CreateIdentityBatch :copyfrom
-- Batch insert identities for import using COPY protocol
-- High performance: ~1000 inserts/sec
-- All identities created with email_verified = false
INSERT INTO iam.identity (
    id,
    organization_id,
    email,
    identity_type,
    email_verified
) VALUES (
    $1, $2, $3, $4, $5
);

-- name: CreateIdentityRoleBatch :copyfrom
-- Batch insert identity roles for import using COPY protocol
-- Assigns 'employee' role to all imported identities
INSERT INTO iam.identity_role (
    id,
    organization_id,
    identity_id,
    role
) VALUES (
    $1, $2, $3, $4
);

-- ===============================================
-- Verification Queries
-- ===============================================

-- name: GetIdentityByID :one
-- Retrieve identity by ID for verification after import
-- Used to confirm identity creation succeeded
SELECT 
    id,
    organization_id,
    email,
    identity_type,
    email_verified,
    updated_at
FROM iam.identity
WHERE id = $1 
  AND organization_id = $2;

-- name: GetIdentitiesByIDs :many
-- Retrieve multiple identities by IDs (for batch verification)
SELECT 
    id,
    organization_id,
    email,
    identity_type,
    email_verified,
    updated_at
FROM iam.identity
WHERE organization_id = $1
  AND id = ANY($2::uuid[])
ORDER BY email;

-- name: GetIdentityRolesByIdentityIDs :many
-- Retrieve identity roles for verification
SELECT 
    id,
    organization_id,
    identity_id,
    role,
    updated_at
FROM iam.identity_role
WHERE organization_id = $1
  AND identity_id = ANY($2::uuid[])
ORDER BY identity_id;

-- ===============================================
-- Count Queries (for statistics)
-- ===============================================

-- name: CountIdentitiesByOrganization :one
-- Count total identities in organization (for dashboard stats)
SELECT COUNT(*) as count
FROM iam.identity
WHERE organization_id = $1;

-- name: CountEmployeesByOrganization :one
-- Count employees in organization (excludes service accounts)
SELECT COUNT(*) as count
FROM iam.identity i
INNER JOIN iam.identity_role ir ON i.id = ir.identity_id
WHERE i.organization_id = $1
  AND i.identity_type = 'human'
  AND ir.role = 'employee';

-- ===============================================
-- Usage Examples (Not part of sqlc, for documentation)
-- ===============================================

/*
Example 1: Check for duplicate emails during preview

    emails := []string{
        "user1@example.com",
        "user2@example.com",
        "user3@example.com",
    }
    
    duplicates, err := queries.CheckDuplicateEmailsBatch(ctx, db.CheckDuplicateEmailsBatchParams{
        OrganizationID: orgID,
        Emails: emails,
    })
    
    // duplicates contains existing identities with matching emails
    duplicateMap := make(map[string]uuid.UUID)
    for _, dup := range duplicates {
        duplicateMap[dup.Email] = dup.IdentityID
    }

Example 2: Batch insert identities in transaction

    tx, err := db.Begin(ctx)
    defer tx.Rollback()
    
    qtx := queries.WithTx(tx)
    
    // Prepare batch data
    identityRows := []db.CreateIdentityBatchParams{
        {
            ID: uuid.New(),
            OrganizationID: orgID,
            Email: "user1@example.com",
            IdentityType: "human",
            EmailVerified: false,
        },
        {
            ID: uuid.New(),
            OrganizationID: orgID,
            Email: "user2@example.com",
            IdentityType: "human",
            EmailVerified: false,
        },
    }
    
    // Execute batch insert
    err = qtx.CreateIdentityBatch(ctx, identityRows)
    if err != nil {
        return err
    }
    
    // Prepare role data
    roleRows := []db.CreateIdentityRoleBatchParams{
        {
            ID: uuid.New(),
            OrganizationID: orgID,
            IdentityID: identityRows[0].ID,
            Role: "employee",
        },
        {
            ID: uuid.New(),
            OrganizationID: orgID,
            IdentityID: identityRows[1].ID,
            Role: "employee",
        },
    }
    
    // Execute role batch insert
    err = qtx.CreateIdentityRoleBatch(ctx, roleRows)
    if err != nil {
        return err
    }
    
    // Create Zitadel users
    for i, row := range identityRows {
        err = zitadelClient.CreateUser(ctx, 
            row.ID, 
            orgID, 
            row.Email, 
            "", // no password
            employees[i].GivenName, 
            employees[i].FamilyName,
        )
        if err != nil {
            return err // Triggers rollback
        }
    }
    
    // Commit transaction
    err = tx.Commit()
    return err

Example 3: Verify import results

    identityIDs := []uuid.UUID{id1, id2, id3}
    
    identities, err := queries.GetIdentitiesByIDs(ctx, db.GetIdentitiesByIDsParams{
        OrganizationID: orgID,
        IDs: identityIDs,
    })
    
    roles, err := queries.GetIdentityRolesByIdentityIDs(ctx, db.GetIdentityRolesByIdentityIDsParams{
        OrganizationID: orgID,
        IdentityIDs: identityIDs,
    })
    
    // Verify all identities and roles created successfully
    if len(identities) != len(identityIDs) {
        return errors.New("some identities not created")
    }
    if len(roles) != len(identityIDs) {
        return errors.New("some roles not assigned")
    }
*/
