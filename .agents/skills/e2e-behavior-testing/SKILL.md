---
name: e2e-behavior-testing
description: Write end-to-end behavior tests that validate application features across the full stack. Use this skill when the user asks to create, plan, or improve E2E tests that exercise the system from the user's perspective — through the browser UI or through API calls. Covers shared scenario design, Playwright test structure, behavioral naming conventions, and the pattern for deriving both backend integration tests and frontend E2E tests from the same user stories.
---

This skill guides creation of **behavior-driven end-to-end tests** for the Tech Office application. E2E tests validate that the system works correctly from the user's perspective — they are the highest-confidence tests and the primary frontend testing strategy (per the project constitution: frontend uses manual testing + E2E tests only, NO unit/snapshot/component tests).

## Core Philosophy

### Shared Behavioral Scenarios

A single user story produces **two layers of verification** from the same behavioral scenario:

| Layer | Tool | Validates | Speed |
|-------|------|-----------|-------|
| **Backend Integration** | Go `testWorld` (localhost:18080) | API contracts, data integrity, permissions, multi-tenancy | Fast (~seconds) |
| **Frontend E2E** | Playwright (`@playwright/test`) | UI renders correct state, user interactions work, navigation flows | Slower (~seconds per action) |

Both layers share the same **scenario structure** — the "when..." / "it should..." naming pattern — so that reading either test suite tells the same behavioral story.

**Example: shared scenario for "project team management"**

```
Scenario: when a team is assembled on a private project
  ✓ initially only the owner can see the project
  ✓ all members can now see the private project
  ✓ the member list shows correct roles
  Scenario: when a member is removed from the project
    ✓ the removed member can no longer see the project
    ✓ the removed member cannot access project tasks
```

This scenario appears in:
- `backend/integration/workflow_project_team_test.go` → validates via RPC calls
- `e2e/project-team.spec.ts` → validates via browser interactions

### When to Write Which Layer

| Scenario Type | Backend Integration | Frontend E2E |
|--------------|:---:|:---:|
| CRUD operations, data correctness | ✅ | ○ (optional) |
| Permission / access control | ✅ | ✅ |
| Multi-tenancy isolation | ✅ | ○ (optional) |
| UI rendering, layout, responsiveness | — | ✅ |
| Navigation flows, route guards | — | ✅ |
| Form validation (client-side) | — | ✅ |
| Real-time updates (SSE, websocket) | ✅ | ✅ |
| Cross-feature workflows | ✅ | ✅ |
| Error messages shown to user | — | ✅ |

**Rule of thumb**: If the scenario is about *data correctness*, backend integration is sufficient. If it's about *what the user sees or does*, write a frontend E2E test. For *critical paths* (auth, permissions, workflows), write both.

---

## Shared Scenario Format

Before writing any test code, define scenarios in plain English. These scenarios are the **behavioral contract** — they drive both test layers.

```markdown
## Feature: Calendar Booking

### Scenario: when an employee books a meeting room
- the room appears as occupied in the calendar view
- other employees see the booking in the room's schedule
- the booker receives a confirmation notification

### Scenario: when booking conflicts with an existing reservation
- the booking is rejected with a clear error
- the original booking remains unchanged

### Scenario: when the booker cancels their reservation
- the room becomes available again
- attendees receive a cancellation notification
```

Each scenario line maps to:
- A `t.Run("the room appears as occupied in the calendar view", ...)` in Go
- A `test('the room appears as occupied in the calendar view', ...)` in Playwright

---

## Frontend E2E Test Structure (Playwright)

### Directory Layout

```
frontend/apps/web/e2e/
├── playwright.config.ts          # Playwright configuration
├── helpers/
│   ├── auth.ts                   # Login/session helpers
│   ├── fixtures.ts               # Custom test fixtures (page objects, test users)
│   └── api.ts                    # Direct API helpers for arrange steps
├── project-team.spec.ts          # E2E: project team management
├── task-lifecycle.spec.ts        # E2E: task creation → assignment → completion
├── calendar-booking.spec.ts      # E2E: calendar room booking flows
├── chat-messaging.spec.ts        # E2E: chat send/receive/file-attach
├── notification-flow.spec.ts     # E2E: notification delivery and interaction
├── document-collab.spec.ts       # E2E: document editing and versioning
└── auth-permission.spec.ts       # E2E: login, role-based access, route guards
```

Naming convention: `<domain>-<feature>.spec.ts` — mirrors backend's `<domain>_<feature>_test.go`.

### Playwright Configuration

```typescript
// frontend/apps/web/e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:13000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Start the dev server if not already running
  webServer: process.env.CI
    ? {
        command: 'pnpm --filter web dev',
        port: 3000,
        reuseExistingServer: true,
      }
    : undefined,
});
```

### Test Anatomy

```typescript
// e2e/project-team.spec.ts
import { test, expect } from '@playwright/test';
import { loginAs, createTestUsers } from './helpers/auth';
import { createProject, addMember } from './helpers/api';

test.describe('Project Team Management', () => {
  // Arrange: set up test data via API (NOT through UI — keep arrange fast)
  let owner: TestUser;
  let dev: TestUser;
  let projectId: string;

  test.beforeAll(async () => {
    const users = await createTestUsers(2);
    owner = users[0];
    dev = users[1];
    projectId = await createProject(owner, {
      name: 'Sprint Alpha',
      visibility: 'private',
    });
  });

  test.describe('when a team is assembled on a private project', () => {
    test('initially only the owner can see the project', async ({ page }) => {
      await loginAs(page, dev);
      await page.goto('/workspace/projects');
      await expect(page.getByText('Sprint Alpha')).not.toBeVisible();
    });

    test('all members can see the private project after being added', async ({ page }) => {
      // Arrange via API
      await addMember(owner, projectId, dev.id, 'member');

      // Act: dev navigates to projects
      await loginAs(page, dev);
      await page.goto('/workspace/projects');

      // Assert: project is visible
      await expect(page.getByText('Sprint Alpha')).toBeVisible();
    });
  });

  test.describe('when a member is removed from the project', () => {
    test('the removed member can no longer see the project', async ({ page }) => {
      // Arrange via API
      await removeMember(owner, projectId, dev.id);

      // Act
      await loginAs(page, dev);
      await page.goto('/workspace/projects');

      // Assert
      await expect(page.getByText('Sprint Alpha')).not.toBeVisible();
    });
  });
});
```

### Naming Conventions

| Level | Pattern | Example |
|-------|---------|---------|
| `test.describe` (outer) | `'Feature Domain'` | `'Project Team Management'` |
| `test.describe` (scenario) | `'when <action/precondition>'` | `'when a team is assembled on a private project'` |
| `test` (expectation) | `'<assertion in plain english>'` | `'initially only the owner can see the project'` |

The Playwright test output should mirror the Go integration test output:

```
Project Team Management
  when a team is assembled on a private project
    ✓ initially only the owner can see the project
    ✓ all members can see the private project after being added
  when a member is removed from the project
    ✓ the removed member can no longer see the project
```

---

## Rules

### 1. Arrange via API, Act via UI, Assert via UI

The most important rule for E2E test speed and reliability:

- **Arrange** (setup): Use direct API/RPC calls to create data. Do NOT click through the UI to set up preconditions — it's slow and fragile.
- **Act** (user action): Drive the browser UI as a real user would — click, type, navigate.
- **Assert** (verification): Check what the user sees — visible text, element states, URLs, toasts, etc.

```typescript
// ✅ Correct: arrange via API, act/assert via UI
test('assigned task appears in my task list', async ({ page }) => {
  // Arrange - fast, reliable API calls
  const task = await api.createTask(owner, projectId, 'Fix login bug');
  await api.assignTask(owner, task.id, dev.id);

  // Act - user navigates
  await loginAs(page, dev);
  await page.goto('/workspace/tasks');

  // Assert - check what user sees
  await expect(page.getByText('Fix login bug')).toBeVisible();
});

// ❌ Wrong: arranging through UI clicks (slow, fragile)
test('assigned task appears in my task list', async ({ page }) => {
  await loginAs(page, owner);
  await page.goto('/workspace/projects');
  await page.click('text=Sprint Alpha');
  await page.click('button:has-text("New Task")');
  await page.fill('[name="title"]', 'Fix login bug');
  // ... 20 more lines of UI setup ...
});
```

### 2. One `test.describe` per feature domain, one file per feature domain

Group related scenarios in a single file. Don't scatter related tests across multiple files.

### 3. Use custom fixtures for authentication and common setup

```typescript
// helpers/fixtures.ts
import { test as base } from '@playwright/test';

type TestFixtures = {
  ownerPage: Page;    // Pre-authenticated as org owner
  employeePage: Page; // Pre-authenticated as employee
};

export const test = base.extend<TestFixtures>({
  ownerPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: './e2e/.auth/owner.json',
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  employeePage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: './e2e/.auth/employee.json',
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});
```

### 4. Use stable selectors — prefer `getByRole`, `getByText`, `getByTestId`

```typescript
// ✅ Preferred: accessible selectors
await page.getByRole('button', { name: 'Create Project' }).click();
await page.getByText('Sprint Alpha').click();
await page.getByTestId('task-list-item').first().click();

// ❌ Avoid: brittle CSS selectors
await page.click('.MuiButton-root.css-1a2b3c');
await page.click('div > div > button:nth-child(3)');
```

### 5. Wait for application state, not arbitrary timeouts

```typescript
// ✅ Correct: wait for meaningful state
await expect(page.getByText('Project created')).toBeVisible();
await page.waitForURL('**/workspace/projects/*');
await expect(page.getByRole('table')).toContainText('Sprint Alpha');

// ❌ Wrong: arbitrary waits
await page.waitForTimeout(3000);
```

### 6. Test error states explicitly

```typescript
test.describe('when booking conflicts with an existing reservation', () => {
  test('the booking is rejected with a clear error', async ({ page }) => {
    await loginAs(page, employee);
    await page.goto(`/workspace/calendar/rooms/${roomId}/book`);
    await page.fill('[name="date"]', conflictingDate);
    await page.getByRole('button', { name: 'Book' }).click();

    await expect(page.getByRole('alert')).toContainText('time slot is already booked');
  });
});
```

### 7. Isolate tests — no shared mutable state between `test()` blocks

Each `test()` should be independently runnable. Use `test.beforeAll` or `test.beforeEach` for shared setup, and create fresh data for tests that mutate state.

### 8. Screenshot on failure for debugging (configured globally)

Configured in `playwright.config.ts` — no per-test screenshot code needed unless capturing specific visual states.

---

## API Helper Pattern

E2E tests need a thin API client for the "arrange" step. This client calls the same Connect RPC endpoints as the frontend, but without a browser.

```typescript
// helpers/api.ts
const API_BASE = process.env.E2E_API_URL || 'http://localhost:18080';

export async function apiCall<T>(
  user: TestUser,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${user.token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as T;
}

export async function createProject(
  user: TestUser,
  opts: { name: string; visibility?: string },
) {
  const resp = await apiCall<{ project: { id: string } }>(
    user,
    '/rpc.v1.CollaborationService/CreateProject',
    { name: opts.name, visibility: opts.visibility ?? 'public' },
  );
  return resp.project.id;
}

export async function createTask(user: TestUser, projectId: string, title: string) {
  return apiCall(user, '/rpc.v1.CollaborationService/CreateTask', {
    projectId,
    title,
  });
}
```

This mirrors the backend `testWorld` helpers — same verb-noun naming, same auth pattern.

---

## Auth Helper Pattern

```typescript
// helpers/auth.ts
const AUTH_API = process.env.E2E_API_URL || 'http://localhost:18080';

export interface TestUser {
  id: string;
  token: string;
  email: string;
  orgId: string;
}

/**
 * Create test users via the backend's dev-mode identity endpoints.
 * Uses the same mechanism as backend integration tests.
 */
export async function createTestUsers(count: number): Promise<TestUser[]> {
  // Call the backend's dev identity creation endpoint
  // This matches what testWorld.withEmployees() does internally
  const users: TestUser[] = [];
  for (let i = 0; i < count; i++) {
    const resp = await fetch(`${AUTH_API}/rpc.v1.IAMService/DevCreateIdentity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: i === 0 ? 'owner' : 'employee' }),
    });
    users.push(await resp.json());
  }
  return users;
}

/**
 * Login as a test user by setting auth cookies/storage.
 */
export async function loginAs(page: Page, user: TestUser): Promise<void> {
  // Set the auth token in the browser's storage
  // Adapt this to match the app's actual auth storage mechanism
  await page.goto('/');
  await page.evaluate((token) => {
    localStorage.setItem('auth_token', token);
  }, user.token);
}
```

---

## Deriving Test Scenarios from User Stories

When implementing a feature, the workflow is:

1. **Spec defines user stories** (in `specs/NNN-feature/spec.md`)
2. **Scenarios are derived** from user stories as "when.../it should..." stubs
3. **Backend integration tests** implement scenarios via RPC calls
4. **Frontend E2E tests** implement the *same scenarios* via browser interactions
5. Both test suites use **identical scenario names** for traceability

### Example: from spec to both test layers

**Spec user story:**
> As an employee, I can book a meeting room for a time slot so that I have a reserved space.

**Shared scenario:**
```
when an employee books a meeting room
  → the room appears as occupied in the calendar view
  → other employees see the booking in the room's schedule
  → the booker receives a confirmation notification
```

**Backend integration test** (`calendar_booking_test.go`):
```go
t.Run("when an employee books a meeting room", func(t *testing.T) {
    booking := w.bookRoom(employee, roomID, slot)

    t.Run("the room appears as occupied in the calendar view", func(t *testing.T) {
        events := w.getCalendarEvents(employee, roomID, slot.Date)
        found := findEvent(events, booking.ID)
        require.NotNil(t, found)
        assert.Equal(t, "booked", found.Status)
    })

    t.Run("other employees see the booking in the room's schedule", func(t *testing.T) {
        events := w.getCalendarEvents(otherEmployee, roomID, slot.Date)
        found := findEvent(events, booking.ID)
        require.NotNil(t, found)
    })

    t.Run("the booker receives a confirmation notification", func(t *testing.T) {
        notifs := w.listNotifications(employee)
        n := findNotification(notifs, "room_booked", booking.ID)
        require.NotNil(t, n)
    })
})
```

**Frontend E2E test** (`calendar-booking.spec.ts`):
```typescript
test.describe('when an employee books a meeting room', () => {
  test.beforeAll(async () => {
    booking = await api.bookRoom(employee, roomId, slot);
  });

  test('the room appears as occupied in the calendar view', async ({ page }) => {
    await loginAs(page, employee);
    await page.goto(`/workspace/calendar?date=${slot.date}`);
    const roomRow = page.getByTestId(`room-${roomId}`);
    await expect(roomRow.getByText(slot.time)).toHaveClass(/occupied/);
  });

  test('other employees see the booking in the room\'s schedule', async ({ page }) => {
    await loginAs(page, otherEmployee);
    await page.goto(`/workspace/calendar?date=${slot.date}`);
    const roomRow = page.getByTestId(`room-${roomId}`);
    await expect(roomRow.getByText(slot.time)).toHaveClass(/occupied/);
  });

  test('the booker receives a confirmation notification', async ({ page }) => {
    await loginAs(page, employee);
    await page.goto('/workspace');
    await page.getByTestId('notification-bell').click();
    await expect(page.getByText(/room.*booked/i)).toBeVisible();
  });
});
```

Note: **identical scenario names**, different verification methods.

---

## Cross-Feature Workflow Tests

The most valuable E2E tests exercise **cross-feature workflows** — real user journeys that span multiple domains. These are scenarios that backend integration CAN test (via API calls) but that E2E tests verify the full user experience.

```typescript
// e2e/workflow-task-to-notification.spec.ts
test.describe('Task Assignment Notification Flow', () => {
  test.describe('when a manager assigns a task to a developer', () => {
    test('the developer sees a notification bell indicator', async ({ page }) => {
      // Arrange via API
      await api.assignTask(manager, taskId, dev.id);

      // Act
      await loginAs(page, dev);
      await page.goto('/workspace');

      // Assert
      await expect(page.getByTestId('notification-badge')).toBeVisible();
    });

    test('clicking the notification navigates to the task', async ({ page }) => {
      await loginAs(page, dev);
      await page.goto('/workspace');
      await page.getByTestId('notification-bell').click();
      await page.getByText('assigned you to').click();

      await page.waitForURL(`**/tasks/${taskId}`);
      await expect(page.getByText('Fix login bug')).toBeVisible();
    });
  });
});
```

---

## Running E2E Tests

```bash
# Run all E2E tests
cd frontend/apps/web && npx playwright test --config=e2e/playwright.config.ts

# Run a specific test file
npx playwright test --config=e2e/playwright.config.ts e2e/project-team.spec.ts

# Run with UI mode for debugging
npx playwright test --config=e2e/playwright.config.ts --ui

# Run headed (visible browser)
npx playwright test --config=e2e/playwright.config.ts --headed

# View last test report
npx playwright show-report
```

### Prerequisites

1. Backend server running on `localhost:18080` (same as integration tests)
2. Frontend dev server running on `localhost:13000`
3. PostgreSQL database running with test schema

---

## Checklist Before Submitting

1. Scenario names match between backend integration and frontend E2E tests (where both exist)
2. Arrange step uses API calls, not UI interactions
3. Every `test.describe` scenario starts with `"when ..."`
4. Every `test()` describes the expected outcome, not the action
5. No `waitForTimeout` — use meaningful wait conditions
6. Selectors use `getByRole`, `getByText`, or `getByTestId` — not brittle CSS
7. Tests are independently runnable (no ordering dependencies between `test()` blocks)
8. Error scenarios test user-visible error messages
9. Auth is handled via helpers, not duplicated in each test
10. Proto field names and API paths verified against actual codebase (not guessed)

## Relationship to Other Skills

| Skill | Relationship |
|-------|-------------|
| `backend-integration-testing` | Shares scenario names. Backend tests validate API contracts; E2E tests validate the same behaviors through the UI. Write backend tests first — they're faster to iterate on. |
| `playwright-skill` | E2E tests use Playwright. The playwright skill covers ad-hoc browser automation; this skill covers structured behavior-driven test suites. |
| `speckit-specify` / `speckit-tasks` | Scenarios are derived from spec user stories. The spec is the single source of truth for what behaviors to test. |
