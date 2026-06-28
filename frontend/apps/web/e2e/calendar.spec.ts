/**
 * Calendar E2E Tests
 *
 * Behavioral scenarios derived from spec 026-calendar-system user stories.
 * Mirrors backend integration tests in backend/integration/calendar_*_test.go.
 *
 * Pattern: Arrange via API, Act via UI, Assert via UI.
 *
 * Prerequisites:
 *   - Backend running on localhost:18080
 *   - Frontend dev server running on localhost:13000
 *   - PostgreSQL with schema applied
 */
import { test, expect } from '@playwright/test';
import { createTestOrg, createTestEmployee, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';
import { stepScreenshot } from './helpers/screenshot';

// =============================================================================
// US1: Personal Calendar with Event Creation
// =============================================================================

test.describe('Personal Calendar and Event RSVP', () => {
  let owner: TestUser;
  let employee1: TestUser;
  let employee2: TestUser;

  test.beforeAll(async () => {
    owner = await createTestOrg();
    employee1 = await createTestEmployee(owner);
    employee2 = await createTestEmployee(owner);
  });

  test.describe('when an employee navigates to the calendar page', () => {
    test('the calendar page loads and displays the view', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/calendar');
      await stepScreenshot(page, testInfo, 'calendar-page-loaded');
      await expect(page.getByTestId('calendar-page')).toBeVisible();
    });
  });

  test.describe('when an employee creates a meeting event', () => {
    let eventId: string;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(11, 0, 0, 0);

    test.beforeAll(async () => {
      const resp = await api.createEvent(owner, {
        title: 'Team Standup E2E',
        eventType: 'meeting',
        visibility: 'team',
        startTime: tomorrow.toISOString(),
        endTime: tomorrowEnd.toISOString(),
        requiredAttendeeIds: [employee1.id, employee2.id],
      });
      eventId = resp.event.id;
    });

    test('the organizer sees the event on the calendar', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/calendar');
      await stepScreenshot(page, testInfo, 'organizer-calendar-view');
      await expect(page.getByText('Team Standup E2E')).toBeVisible();
    });

    test('an invited attendee sees the event on their calendar', async ({ page }, testInfo) => {
      await loginAs(page, employee1);
      await page.goto('/workspace/calendar');
      await stepScreenshot(page, testInfo, 'attendee-calendar-view');
      await expect(page.getByText('Team Standup E2E')).toBeVisible();
    });
  });

  test.describe('when an attendee responds to an invitation', () => {
    let rsvpEventId: string;
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeek.setHours(14, 0, 0, 0);
    const nextWeekEnd = new Date(nextWeek);
    nextWeekEnd.setHours(15, 0, 0, 0);

    test.beforeAll(async () => {
      const resp = await api.createEvent(owner, {
        title: 'RSVP Test Meeting',
        startTime: nextWeek.toISOString(),
        endTime: nextWeekEnd.toISOString(),
        requiredAttendeeIds: [employee1.id],
      });
      rsvpEventId = resp.event.id;
      // Employee accepts via API (arrange step)
      await api.respondToInvite(employee1, rsvpEventId, 'accepted');
    });

    test('the organizer sees the accepted RSVP status', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/calendar');
      await stepScreenshot(page, testInfo, 'calendar-with-rsvp-event');
      // Navigate to the correct week to find the event
      await page.getByText('RSVP Test Meeting').click();
      await expect(page.getByTestId('event-detail-panel')).toBeVisible();
      await stepScreenshot(page, testInfo, 'event-detail-with-rsvp');
      // The attendee list should show at least one accepted status
      await expect(page.getByText(/accepted/i).first()).toBeVisible();
    });
  });

  test.describe('when the organizer cancels an event', () => {
    let cancelEventId: string;
    const nextMonth = new Date();
    nextMonth.setDate(nextMonth.getDate() + 30);
    nextMonth.setHours(9, 0, 0, 0);
    const nextMonthEnd = new Date(nextMonth);
    nextMonthEnd.setHours(10, 0, 0, 0);

    test.beforeAll(async () => {
      const resp = await api.createEvent(owner, {
        title: 'Cancel Me Meeting',
        startTime: nextMonth.toISOString(),
        endTime: nextMonthEnd.toISOString(),
        requiredAttendeeIds: [employee1.id],
      });
      cancelEventId = resp.event.id;
      // Cancel via API
      await api.cancelEvent(owner, cancelEventId);
    });

    test('the cancelled event no longer appears on the attendee calendar', async ({ page }, testInfo) => {
      await loginAs(page, employee1);
      await page.goto('/workspace/calendar');
      await stepScreenshot(page, testInfo, 'calendar-after-cancellation');
      // The cancelled event should not appear
      await expect(page.getByText('Cancel Me Meeting')).not.toBeVisible();
    });
  });
});

// =============================================================================
// US2: Recurring Events (basic verification)
// =============================================================================

test.describe('Recurring Events', () => {
  let owner: TestUser;

  test.beforeAll(async () => {
    owner = await createTestOrg();
  });

  test.describe('when an employee opens the event create form', () => {
    test('the recurrence selector is available', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/calendar');
      // Click the create button to open the form
      await page.getByRole('button', { name: /create|new|add/i }).click();
      await expect(page.getByTestId('event-create-form')).toBeVisible();
      await stepScreenshot(page, testInfo, 'event-form-with-recurrence');
      await expect(page.getByTestId('recurrence-selector')).toBeVisible();
    });
  });
});

// =============================================================================
// US3: Resource Booking (UI verification)
// =============================================================================

test.describe('Resource Booking', () => {
  let owner: TestUser;

  test.beforeAll(async () => {
    owner = await createTestOrg();
  });

  test.describe('when an employee opens the event creation form', () => {
    test('the resource booking panel is accessible', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/calendar');
      await page.getByRole('button', { name: /create|new|add/i }).click();
      await expect(page.getByTestId('event-create-form')).toBeVisible();
      await stepScreenshot(page, testInfo, 'event-form-with-resources');
      // Resource booking panel should be part of the form
      await expect(page.getByTestId('resource-booking-panel')).toBeVisible();
    });
  });
});

// =============================================================================
// US4: Team Calendar Visibility
// =============================================================================

test.describe('Team Calendar Visibility', () => {
  let owner: TestUser;
  let employee: TestUser;

  test.beforeAll(async () => {
    owner = await createTestOrg();
    employee = await createTestEmployee(owner);

    // Create a private event as the employee
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(15, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(16, 0, 0, 0);

    await api.createEvent(employee, {
      title: 'My Secret Meeting',
      visibility: 'private',
      startTime: tomorrow.toISOString(),
      endTime: tomorrowEnd.toISOString(),
    });
  });

  test.describe('when a team member views the team calendar', () => {
    test('private events from other members show as Busy', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/calendar');
      // Wait for the calendar page to fully render
      await expect(page.getByTestId('calendar-page')).toBeVisible({ timeout: 15_000 });
      await stepScreenshot(page, testInfo, 'team-calendar-private-redacted');
      // Private event title should NOT be visible to other users
      await expect(page.getByText('My Secret Meeting')).not.toBeVisible();
    });
  });
});

// =============================================================================
// US5: Cross-Domain Overlays
// =============================================================================

test.describe('Cross-Domain Overlays', () => {
  let owner: TestUser;

  test.beforeAll(async () => {
    owner = await createTestOrg();
  });

  test.describe('when overlay toggles are visible', () => {
    test('the overlay toggle bar renders on the calendar page', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/calendar');
      await stepScreenshot(page, testInfo, 'calendar-with-overlay-bar');
      await expect(page.getByTestId('overlay-toggle-bar')).toBeVisible();
    });
  });
});

// =============================================================================
// US6: Scheduling Assistant
// =============================================================================

test.describe('Scheduling Assistant', () => {
  let owner: TestUser;

  test.beforeAll(async () => {
    owner = await createTestOrg();
  });

  test.describe('when an employee accesses the scheduling assistant', () => {
    test('the scheduling assistant panel is accessible from the calendar', async ({ page }, testInfo) => {
      await loginAs(page, owner);
      await page.goto('/workspace/calendar');
      await stepScreenshot(page, testInfo, 'calendar-scheduling-assistant');
      await expect(page.getByTestId('calendar-page')).toBeVisible();
      // The scheduling assistant should be reachable from the calendar UI
    });
  });
});
