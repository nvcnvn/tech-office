# Tasks: Complete User Sign-In Flow with Zitadel Integration

**Feature**: `002-continue-user-signin`  
**Input**: Design documents from `/Users/nvcnvn/Codes/tech-office/specs/002-continue-user-signin/`  
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/, quickstart.md

## Execution Flow (main)
```
✅ 1. Loaded plan.md from feature directory
   → Tech stack: Next.js 15 (App Router), TypeScript 5.x, @zitadel/react, Material-UI v5
   → Libraries: pnpm workspace, React Testing Library, Vitest
   → Structure: frontend/apps/web (web app structure)
✅ 2. Loaded optional design documents:
   → research.md: Zitadel OIDC integration patterns, token storage strategy, OAuth callback flow
   → data-model.md: Client-side data structures (no DB changes - frontend-only feature)
   → contracts/auth-flow.md: OAuth 2.0 Authorization Code flow with PKCE specification
   → contracts/components.md: Component hierarchy and behavior contracts
   → contracts/typescript-interfaces.md: TypeScript interface definitions
   → quickstart.md: 7 test scenarios for manual verification
✅ 3. Generated tasks by category:
   → Setup: Dependencies, environment configuration (T001-T003)
   → Core: Auth library, providers, components (T004-T016)
   → Integration: Middleware, route protection (T017)
   → Verification: Manual testing tasks (T018-T025) - REQUIRED gate
   → Tests: Unit, component, integration tests (T026-T034) - after verification
   → Polish: Performance, docs, security review (T035-T040)
✅ 4. Applied task rules:
   → Different files = marked [P] for parallel execution
   → Same file = sequential (no [P] marker)
   → Implementation before verification, verification before tests
✅ 5. Tasks numbered sequentially T001-T040
✅ 6. Dependency graph validated
✅ 7. Parallel execution examples included
✅ 8. Validated task completeness:
   → ✅ All contracts have implementations (auth-flow → T005, T011, T013; components → T008-T016; interfaces → T004)
   → ✅ All entities have models (N/A - client-side only, no DB entities)
   → ✅ All endpoints implemented (N/A - reuses existing GetOrganizationBySubdomain RPC)
   → ✅ Manual verification tasks present (T018-T025)
   → ✅ Tests present after verification (T026-T034)
✅ 9. Return: SUCCESS (tasks ready for execution)
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths for each task

## Path Conventions
- Web app: `frontend/apps/web/src/`
- Backend: `backend/` (no backend changes needed for this feature)
- Paths shown below are relative to workspace root: `/Users/nvcnvn/Codes/tech-office`

---

## Phase 3.1: Setup

- [X] **T001** [P] Verify @zitadel/react v1.1.0 is installed in `frontend/apps/web/package.json`
- [X] **T002** [P] Configure environment variables in `frontend/apps/web/.env.local`:
  - NEXT_PUBLIC_ZITADEL_ISSUER=https://techofficeinstance-elao17.us1.zitadel.cloud
- [ ] **T003** [P] Verify Zitadel application configuration in Zitadel Console (manual checklist)

## Phase 3.2: Core Implementation
**Implementation-first: Build core functionality before tests**
<!-- Constitution reminder: see constitution.md v3.0.0 - Tests added after human verification of correct behavior -->


- [X] **T004** [P] Create TypeScript interfaces in `frontend/apps/web/src/lib/auth/types.ts`
- [X] **T005** [P] Create token storage service in `frontend/apps/web/src/lib/auth/storage.ts`
- [X] **T006** [P] Create Zitadel configuration in `frontend/apps/web/src/lib/auth/zitadel.ts`
- [X] **T007** [P] Create auth error definitions in `frontend/apps/web/src/lib/auth/errors.ts`
- [X] **T008** Create AuthProvider context in `frontend/apps/web/src/lib/auth/auth-context.tsx`
- [X] **T009** Wrap application with AuthProvider in `frontend/apps/web/src/app/layout.tsx`
- [X] **T010** Update SignInPage in `frontend/apps/web/src/app/signin/page.tsx`
- [X] **T010** Update SignInPage in `frontend/apps/web/src/app/signin/page.tsx`
- [X] **T011** Create LoginForm component in `frontend/apps/web/src/app/signin/components/LoginForm.tsx`
- [X] **T012** Create scope builder utility in `frontend/apps/web/src/lib/auth/scope.ts`
- [X] **T013** Create callback page at `frontend/apps/web/src/app/callback/page.tsx`
- [X] **T014** [P] Create loading component in `frontend/apps/web/src/app/callback/loading.tsx`
- [X] **T015** Create dashboard page at `frontend/apps/web/src/app/dashboard/page.tsx`
- [X] **T016** [P] Create UserProfile component in `frontend/apps/web/src/app/dashboard/components/UserProfile.tsx`

## Phase 3.3: Integration
- [X] **T017** Update authentication middleware in `frontend/apps/web/src/middleware.ts`

## Phase 3.4: Manual Verification ⚠️ REQUIRED BEFORE TESTS
**Human developer MUST verify behavior is correct before adding tests**

- [ ] **T018** Manual test: Happy path signin flow (Follow quickstart.md Scenario 1)
- [ ] **T019** Manual test: Authenticated user redirect (Follow quickstart.md Scenario 2)
- [ ] **T020** Manual test: Organization lookup errors (Follow quickstart.md Scenario 3)
- [ ] **T021** Manual test: Token refresh flow (Follow quickstart.md Scenario 4)
- [ ] **T022** Manual test: Callback error handling (Follow quickstart.md Scenario 5)
- [ ] **T023** Manual test: Logout flow (Follow quickstart.md Scenario 6)
- [ ] **T024** Manual test: Multi-tab behavior (Follow quickstart.md Scenario 7)
- [ ] **T025** Document verified behavior in `specs/002-continue-user-signin/VERIFIED.md`

---

## Phase 3.5: Tests (After Verification)
**Add tests ONLY after T018-T025 confirm correct behavior**

- [ ] **T026** [P] Component test: LoginForm in `frontend/apps/web/src/app/signin/components/__tests__/LoginForm.test.tsx`
- [ ] **T027** [P] Component test: CallbackPage in `frontend/apps/web/src/app/callback/__tests__/page.test.tsx`
- [ ] **T028** [P] Component test: DashboardPage in `frontend/apps/web/src/app/dashboard/__tests__/page.test.tsx`
- [ ] **T029** [P] Unit test: Token storage in `frontend/apps/web/src/lib/auth/__tests__/storage.test.ts`
- [ ] **T030** [P] Unit test: Scope builder in `frontend/apps/web/src/lib/auth/__tests__/scope.test.ts`
- [ ] **T031** [P] Unit test: Error definitions in `frontend/apps/web/src/lib/auth/__tests__/errors.test.ts`
- [ ] **T032** Integration test: Full auth flow in `frontend/apps/web/src/__tests__/integration/auth-flow.test.tsx`
- [ ] **T033** Integration test: Token refresh in `frontend/apps/web/src/__tests__/integration/token-refresh.test.tsx`
- [ ] **T034** E2E test: User signin journey using Playwright in `frontend/apps/web/e2e/signin.spec.ts`

## Phase 3.6: Polish
- [ ] **T035** Add error logging service in `frontend/apps/web/src/lib/auth/logging.ts`
- [ ] **T036** [P] Add JSDoc comments to all auth utilities (types.ts, zitadel.ts, storage.ts, scope.ts, errors.ts)
- [ ] **T037** [P] Update feature documentation in `specs/002-continue-user-signin/README.md`
- [ ] **T038** Performance test: Token validation speed (target <10ms)
- [ ] **T039** Security review: Token storage and XSS protection
- [ ] **T040** Final smoke test: Complete user journey

---

## Dependencies

**Setup Phase** (T001-T003):
- All tasks can run in parallel [P]

**Core Implementation Phase** (T004-T017):
- T004-T007 can run in parallel [P] (different files)
- T008 depends on T006 (needs zitadelAuth)
- T009 depends on T008 (needs AuthProvider)
- T010-T011 sequential (T010 imports LoginForm)
- T012 depends on T004 (needs types)
- T013-T016 can run in parallel [P] (different files)
- T017 independent (middleware update)

**Integration Phase** (T017):
- T017 depends on T005 (token storage interface)

**Verification Phase** (T018-T025):
- T018-T024 sequential (manual testing steps)
- T025 documents all verification results
- All implementation (T001-T017) must complete before T018

**Tests Phase** (T026-T034):
- T026-T031 can run in parallel [P] (different test files)
- T032-T034 sequential (integration tests build on each other)
- Verification (T018-T025) must complete before any tests

**Polish Phase** (T035-T040):
- T035-T040 can run in parallel [P] (different concerns)
- Tests (T026-T034) should complete before polish

---

## Parallel Execution Examples

### Setup Phase
```bash
Task T001: "Verify @zitadel/react is installed"
Task T002: "Configure environment variables in .env.local"
Task T003: "Verify Zitadel application configuration"
```

### Core Auth Phase
```bash
Task T004: "Create TypeScript interfaces in lib/auth/types.ts"
Task T005: "Create token storage service in lib/auth/storage.ts"
Task T006: "Create Zitadel configuration service in lib/auth/zitadel.ts"
Task T007: "Create auth error definitions in lib/auth/errors.ts"
```

### Test Phase
```bash
Task T026: "Component test: LoginForm"
Task T027: "Component test: CallbackPage"
Task T028: "Component test: DashboardPage"
Task T029: "Unit test: Token storage"
Task T030: "Unit test: Scope builder"
Task T031: "Unit test: Error definitions"
```

### Polish Phase
```bash
Task T035: "Add error logging service"
Task T036: "Add JSDoc comments to auth utilities"
Task T037: "Update feature documentation"
Task T038: "Performance test: Token validation"
Task T039: "Security review: Token storage"
Task T040: "Final smoke test"
```

---

## Notes

- **[P] marker**: Tasks marked [P] can run in parallel (different files, no dependencies)
- **Verification gate**: T018-T025 are MANDATORY before writing any tests
- **Constitution compliance**: Tests added AFTER manual verification confirms correct behavior
- **Frontend-only**: No backend changes, no database migrations, no proto/SQL codegen needed
- **MUI components**: Use Material-UI components consistently with existing app design
- **Testing tools**: React Testing Library, Vitest for unit/component tests, Playwright for E2E
- **Commit strategy**: Commit after each task or logical group of tasks
- **Security**: localStorage acceptable for MVP, plan migration to HttpOnly cookies for production

---

## Validation Checklist

- [x] All contracts have corresponding implementations (T010, T011, T013, T015)
- [x] All interfaces defined in contracts/typescript-interfaces.md have implementation tasks (T004)
- [x] Manual verification phase present before tests (T018-T025)
- [x] All implementations have corresponding tests after verification (T026-T034)
- [x] Parallel tasks are truly independent (different files)
- [x] Each task specifies exact file path
- [x] No task modifies same file as another [P] task
- [x] OAuth flow contract fully implemented (T005, T011, T013)
- [x] Component contracts fully implemented (T008, T010, T011, T013, T015)
- [x] Error handling contracts fully implemented (T007, T011, T013)
- [x] Organization-specific scope implemented (T012)
- [x] Token storage strategy implemented (T006)
- [x] Middleware authentication check implemented (T017)
- [x] All quickstart scenarios covered in manual verification (T018-T024)

---

## Task Generation Rules Applied

1. **From Contracts**:
   - auth-flow.md → T005 (Zitadel config), T013 (callback handler)
   - components.md → T008 (AuthProvider), T010 (SignInPage), T011 (LoginForm), T013 (CallbackPage), T015 (DashboardPage)
   - typescript-interfaces.md → T004 (type definitions)

2. **From Data Model**:
   - No new entities (reuses existing organization schema)
   - Client-side types only (AuthTokens, UserProfile) → T004

3. **From User Stories** (spec.md):
   - Primary story → T018 (happy path verification)
   - Edge cases → T019-T022 (error scenarios, token refresh, logout)
   - Cross-tab sync → T024 (multi-tab behavior)

4. **From Research**:
   - Section 1 (Zitadel Integration) → T005
   - Section 2 (Token Storage) → T006
   - Section 3 (Callback Flow) → T013
   - Section 4 (Org-Specific Scope) → T012
   - Section 6 (Middleware) → T017
   - Section 7 (Error Handling) → T007, T035

5. **Ordering Applied**:
   - Setup (T001-T003) → Core (T004-T016) → Integration (T017) → Verification (T018-T025) → Tests (T026-T034) → Polish (T035-T040)

---

**Ready for implementation**: All 40 tasks are specific, actionable, and follow the constitution's test-after-verification approach.

**Frontend-Only Feature**:
- ✅ No backend changes required
- ✅ Uses existing RPC `GetOrganizationBySubdomain`
- ✅ No SQL schema changes
- ✅ No protocol buffer changes
- ✅ No generated code tasks (sqlc/buf generate not needed)

**Constitutional Compliance**:
- ✅ Implementation before tests (Phase 3.2-3.6 before 3.8)
- ✅ Manual verification gate (Phase 3.7)
- ✅ Tests document verified behavior (Phase 3.8)
- ✅ No premature optimization (simple token storage)

**Risk Areas**:
- Token storage security (localStorage) - Acceptable for MVP, documented for future migration to HttpOnly cookies
- Client-side token validation only - Server validates on API calls
- Cross-tab synchronization - localStorage events handle this automatically

**Success Criteria**:
- [ ] All 30 tasks complete
- [ ] Manual verification scenarios pass (T014-T021)
- [ ] Automated tests pass with >80% coverage (T022-T028)
- [ ] Performance targets met (T029)
- [ ] Documentation updated (T030)
- [ ] Full auth flow working: signin → Zitadel → callback → dashboard
