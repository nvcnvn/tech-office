# Quickstart: Org-Managed User Accounts with Passkey-Based Login

## Prerequisites
- Backend running locally (`go run ./cmd`)
- PostgreSQL with migrations applied
- At least one organization created with an Owner user

## Scenario 1: Admin Creates a Single Worker Account

### Steps
1. **Login as Owner** → call `Login` with owner email/password → get `access_token`
2. **Create worker account** → call `CreateOrgAccount` with:
   - `login_identifier`: "W001"
   - `display_name`: "Factory Worker One"
   - `given_name`: "Worker"
   - `family_name`: "One"
3. **Verify response** contains:
   - `id`: non-empty UUID
   - `login_identifier`: "W001"
   - `temporary_pin`: 6-digit string
4. **Note the temporary PIN** (not retrievable after this)

### Expected
- `iam.user` record created with `email=NULL`, `is_org_managed=true`
- `iam.identity` record created with `login_identifier='W001'`
- `organization.employee` record created
- `iam.credential` record created with `state='temporary'`, `credential_type='pin'`
- `iam.employee_role` record created with default 'employee' role

---

## Scenario 2: Worker Logs In with Temporary PIN

### Steps
1. **Call LoginWithPIN** with:
   - `organization_subdomain`: org subdomain
   - `login_identifier`: "W001"
   - `pin`: the temporary PIN from Scenario 1
2. **Verify response**:
   - `pin_change_required`: `true`
   - `pin_change_token`: non-empty string
   - `access_token`: empty (not issued until PIN is changed)

### Expected
- Worker is authenticated but not fully logged in
- Client must call SetPIN before proceeding

---

## Scenario 3: Worker Sets New PIN

### Steps
1. **Call SetPIN** with:
   - `new_pin`: "482916" (6 numeric digits, not matching DOB or phone)
   - `pin_change_token`: from Scenario 2
2. **Verify response**:
   - `access_token`: non-empty JWT
   - `expires_at`: future timestamp

### Expected
- Credential state changed from 'temporary' to 'active' with new hash
- Valid JWT issued with org context
- Session created in `iam.session`

---

## Scenario 4: Worker Logs In with Personal PIN

### Steps
1. **Call LoginWithPIN** with:
   - `organization_subdomain`: org subdomain
   - `login_identifier`: "W001"
   - `pin`: "482916"
2. **Verify response**:
   - `pin_change_required`: `false`
   - `access_token`: non-empty JWT
   - `expires_at`: future timestamp

### Expected
- Standard JWT issued, structurally identical to email-based user tokens
- JWT `sub` = shared ID, `org_id` = org UUID
- Worker can call any authorized endpoint with this token

---

## Scenario 5: Failed PIN Attempts and Lockout

### Steps
1. **Call LoginWithPIN 3 times** with wrong PIN → all return `UNAUTHENTICATED`
2. **Call LoginWithPIN** with wrong PIN (4th attempt):
   - Error: `RESOURCE_EXHAUSTED` with lockout duration (1 minute)
3. **Wait 1 minute**, try wrong PIN again (5th attempt):
   - Error: `RESOURCE_EXHAUSTED` with lockout duration (5 minutes)
4. **Continue until 6th failure**:
   - Error: `RESOURCE_EXHAUSTED` with message indicating admin reset required

### Expected
- `iam.account_lockout` record tracks progressive tiers
- After tier 4: even correct PIN is rejected until admin unlocks

---

## Scenario 6: Admin Unlocks Worker Account

### Steps
1. **Login as Owner** → `Login`
2. **Call UnlockOrgAccount** with:
   - `id`: worker's ID
   - `reset_pin`: `true`
3. **Verify response** contains `temporary_pin`

### Expected
- Lockout record reset to tier 0
- Old PIN credential revoked, new temporary PIN created
- Worker must go through PIN change flow again

---

## Scenario 7: Batch Import Workers

### Steps
1. **Login as Owner** → `Login`
2. **Call BatchCreateOrgAccounts** with 3 workers:
   - W002/Worker Two, W003/Worker Three, W004/Worker Four
3. **Verify response**:
   - `success_count`: 3
   - Each result has `success: true`, `temporary_pin` set
4. **Call BatchCreateOrgAccounts** again with duplicate W002:
   - `failure_count`: 1
   - Result for W002: `success: false`, error about duplicate

### Expected
- All accounts created atomically on success
- Entire batch rejected if any row fails validation
- One-time PINs in response body are the only retrieval opportunity

---

## Scenario 8: Email-Based User Unaffected

### Steps
1. **Login as existing email user** → `Login` with email/password
2. **Call any API** (e.g., `ListEmployees`)
3. **Verify**: works exactly as before

### Expected
- No regression for email-based authentication
- All existing sessions and tokens remain valid
- Interceptor permission resolution unchanged

---

## Scenario 9: PIN Complexity Validation

### Steps
1. Worker calls **SetPIN** with:
   - `new_pin`: "123" → rejected (not 6 digits)
   - `new_pin`: "abcdef" → rejected (not numeric)
   - `new_pin`: worker's DOB digits (e.g., "199005" if DOB is 1990-05-XX) → rejected
   - `new_pin`: "482916" → accepted

### Expected
- Each rejection returns `INVALID_ARGUMENT` with descriptive message
- Only 6-digit numeric PINs not matching known personal data pass validation

---

## Scenario 10: Permission Check for manageOrgAccounts

### Steps
1. **Login as Employee** (no `iam.manageOrgAccounts` permission)
2. **Call CreateOrgAccount** → `PERMISSION_DENIED`
3. **Login as Owner** (has `iam.manageOrgAccounts` by default)
4. **Call CreateOrgAccount** → succeeds

### Expected
- Proto `access_control` enforces permission check via interceptor
- Only users with `iam.manageOrgAccounts` can manage worker accounts
