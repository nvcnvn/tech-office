# Contract: Behavioral Coverage For Workspace Context Rail Redesign

## Purpose

Define the reviewable scenario contract before task generation. Backend scenarios cover the named summary RPC methods introduced for the rail. Playwright scenarios cover layout, session persistence, responsive behavior, and route-specific rendering.

## Coverage Notes

- Layout-only behavior such as toggle placement, right-side rendering, main-content reflow, and session persistence is frontend-owned and is therefore covered by Playwright rather than backend integration tests.
- Backend integration coverage is required for any new or extended summary contracts introduced to support the rail, especially cross-project work-today data and pinned-message summaries.

## Backend Integration Scenario Stubs

### CollaborationService.GetAssignedWorkSummary

```go
func TestContextRailSummaries(t *testing.T) {
	w := newTestWorld(t)
	_ = w

	// FR-008, FR-010
	t.Run("when GetAssignedWorkSummary is requested", func(t *testing.T) {
		t.Run("it returns assigned work due today or overdue across projects for the authenticated employee", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
		t.Run("it excludes closed tasks from the work summary", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
		t.Run("it returns an empty summary when the authenticated employee has no due-today or overdue work", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
		t.Run("it does not leak assigned work from another organization", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
	})

```

### ChatService.GetChannelContextSummary

```go
func TestContextRailChatContext(t *testing.T) {
	w := newTestWorld(t)
	_ = w

	// FR-014
	t.Run("when GetChannelContextSummary is requested", func(t *testing.T) {
		t.Run("it returns member summaries for the active channel", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
		t.Run("it returns pinned message previews for the active channel", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
		t.Run("it returns an empty pinned-message list when the channel has no pins", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
		t.Run("it returns direct-message counterpart context for a dm conversation", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
		t.Run("it denies access when the caller cannot view the target channel", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
	})

	// FR-009
	t.Run("when unread state changes after a message read action", func(t *testing.T) {
		t.Run("the unread count reflects the newly read channel state", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
	})
}
```

### Existing calendar mutation reused by the rail

```go
func TestContextRailCalendarActions(t *testing.T) {
	w := newTestWorld(t)
	_ = w

	// FR-013
	t.Run("when a calendar invite response is submitted from calendar context", func(t *testing.T) {
		t.Run("it updates the attendee response status", func(t *testing.T) {
			t.Skip("TODO: implement after scenario review")
		})
	})
}
```

## Playwright Scenario Stubs

```ts
test.describe('workspace context rail', () => {
	// FR-001, FR-002, FR-003, SC-001
	test('shows a visible context rail toggle on every workspace route including chat', async () => {
		// TODO: implement after scenario review
	})

	// FR-004, SC-007
	test('preserves the rail open state while navigating between workspace routes in one session', async () => {
		// TODO: implement after scenario review
	})

	// FR-005, SC-006
	test('expands the main content area when the rail is collapsed', async () => {
		// TODO: implement after scenario review
	})

	// FR-006, FR-007, FR-008, FR-009, FR-010, FR-016, SC-002, SC-005
	test('renders live global blocks and meaningful empty states instead of mock quick info content', async () => {
		// TODO: implement after scenario review
	})

	// FR-012, FR-013, SC-003
	test('shows calendar-specific day context and invite actions on the calendar route', async () => {
		// TODO: implement after scenario review
	})

	// FR-014, SC-004
	test('shows chat channel context on the right while keeping the channel sidebar on the left', async () => {
		// TODO: implement after scenario review
	})

	// Edge case coverage
	test('auto-collapses the rail on narrow widths without hiding the toggle', async () => {
		// TODO: implement after scenario review
	})

	test('does not flash stale calendar or chat content while rapidly navigating between routes', async () => {
		// TODO: implement after scenario review
	})
})
```

## Story And Requirement Mapping

| Spec item | Backend coverage | Playwright coverage | Notes |
|-----------|------------------|---------------------|-------|
| User Story 1 | Not required beyond support contracts | Route visibility, persistence, reflow, chat coexistence | Frontend-owned shell behavior |
| User Story 2 | `GetAssignedWorkSummary` scenarios plus unread-count transition coverage | Live data and empty-state rendering | Backend coverage is tied to the named collaboration summary RPC |
| User Story 3 | Invite response scenario | Calendar-specific rendering and selected-day behavior | Calendar display is frontend-owned; invite mutation is backend-owned |
| User Story 4 | `GetChannelContextSummary` scenarios including `dm_counterpart` | Chat right-rail rendering and DM variant | DM counterpart identity and presence are now formal requirements per FR-014 |
| FR-001 to FR-005 | Not required | Covered | Pure layout contract |
| FR-006 to FR-010 | Covered through named summary RPC scenarios and existing unread or presence behavior | Covered | Hybrid data and UI behavior |
| FR-011 | Not required directly | Covered indirectly through route-specific rendering | Provider registration is an internal frontend mechanism |
| FR-012 to FR-015 | Covered where backend data or mutation applies | Covered | Calendar and chat route behavior |
| FR-016 | Covered indirectly through live-data scenarios | Covered directly through UI assertions and code search follow-up | Mock removal is primarily frontend |
| FR-017 | Not required (client-derived state) | Covered — badge visible on collapsed toggle when overdue work or unread messages present; clears when resolved | `hasBadgeAlert` derived from existing summary data; no new backend contract |