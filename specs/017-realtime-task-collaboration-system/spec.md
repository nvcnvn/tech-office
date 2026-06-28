# Feature Specification: Realtime Task Collaboration System

**Feature Branch**: `017-realtime-task-collaboration-system`  
**Created**: 2024-12-26  
**Status**: Draft  
**Input**: User description: "realtime task collaboration system (like trello). Each task will be a chat channel which all related people in the channel. We will have 'project' and 'task' as the core feature here. Task should be dynamic to support user need. Task support file upload, use documentation as the task description, task comment will be a channel message...etc. A project is a collection of tasks, project can have a list of state (backlog, on progress, testing, prod...). Task should have their old status (open, close) and then user can config some rule that: 'if the state is prod then close the ticket'. Task should have common metadata we usually found in these kind of ticket system (reporter, assigners, begin, end time, ...) but I think we should support a dynamic key-value system for tasks, for example many team use story point, many team use hour, many team use T-shirt size... we need to support them all without bloating our system db schema. Tasks can have parent and children relationship, task can have a level label, for example epic, story, task. We should be able to draw gantt chart for the project. Most importantly we need to support analytic with all the metadata, don't need to be fancy as drawing but kind of summary table that user can group by and filtering (map reduce then excel)."

## Execution Flow (main)
```
1. Parse user description from Input ✓
   → Feature description provided: realtime task collaboration system
2. Extract key concepts from description ✓
   → Actors: project members, task reporters, task assignees, project admins
   → Actions: create projects, create tasks, assign tasks, update task state/status, add comments, upload files, configure custom fields, define workflow rules, view analytics, draw gantt charts
   → Data: projects, tasks, states, custom fields, task hierarchy (epic→story→task), task relationships, analytics
   → Constraints: dynamic fields (key-value), reuses chat system for comments, reuses docs for descriptions, reuses files for attachments, multi-tenant isolation
3. For each unclear aspect: ✓
   → Resolved via analysis of existing systems and requirements
4. Fill User Scenarios & Testing section ✓
5. Generate Functional Requirements ✓
6. Identify Key Entities ✓
7. Run Review Checklist ✓
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As a team member in an organization, I need a realtime task collaboration system where I can manage projects with customizable workflows, create and track tasks with flexible metadata, collaborate with team members through comments, and analyze project progress through reports and visualizations like Gantt charts.

### Acceptance Scenarios

#### Project Management

1. **Given** I am an employee, **When** I create a new project with name, description, and initial states, **Then** the project is created with default states (Backlog, In Progress, Testing, Done) or my custom states

2. **Given** a project exists, **When** I define custom states for the project (e.g., "Ideation", "Design", "Development", "QA", "Deployed"), **Then** tasks in that project can be assigned to any of these states

3. **Given** I am a project admin, **When** I configure a workflow rule "if state is 'Deployed' then close the task", **Then** tasks automatically change to "closed" status when moved to that state

4. **Given** a project has tasks, **When** I view the project board, **Then** I see tasks organized by their current state in columns (Kanban-style view)

5. **Given** I am a project admin, **When** I define task levels (e.g., "Epic", "Story", "Task", "Subtask"), **Then** tasks can be categorized using these levels

#### Task Management

6. **Given** I am a project member, **When** I create a task with title and description (as a document), **Then** the task is created with a unique identifier, assigned to initial state, and a chat channel is auto-created for discussions

7. **Given** a task exists, **When** I add a comment, **Then** the comment is posted to the task's chat channel and all watchers are notified

8. **Given** I am the reporter or an assignee, **When** I attach a file to the task, **Then** the file is uploaded and linked to the task

9. **Given** a task exists, **When** I drag it from one state column to another (e.g., "Backlog" to "In Progress"), **Then** the task's state is updated and the change is reflected in real-time for all viewers

10. **Given** a task exists, **When** I set start date and due date, **Then** these dates are saved and visible in Gantt chart view

#### Custom Fields (Dynamic Metadata)

11. **Given** I am a project admin, **When** I define a custom field "Story Points" with type "number", **Then** all tasks in the project can have this field set

12. **Given** custom fields are defined for a project, **When** I create or edit a task, **Then** I can set values for these custom fields

13. **Given** a project has custom field "T-Shirt Size" with options (XS, S, M, L, XL), **When** I set a task's size to "M", **Then** this value is stored and available for filtering/analytics

14. **Given** custom fields exist, **When** I want to change field type or remove a field, **Then** I am warned about impact on existing data before confirmation

#### Task Hierarchy & Relationships

15. **Given** I have an Epic, **When** I create child Stories under it, **Then** the Stories are linked as children of the Epic

16. **Given** a Story has child Tasks, **When** all child Tasks are closed, **Then** the Story can optionally auto-close based on project rules

17. **Given** tasks have parent-child relationships, **When** I view the project, **Then** I can see the hierarchy (expand/collapse children under parents)

18. **Given** a task at level "Story", **When** I try to add a child, **Then** I can only add children at lower levels (e.g., "Task" or "Subtask")

#### Gantt Chart Visualization

19. **Given** tasks have start and end dates, **When** I open Gantt chart view, **Then** I see tasks as bars on a timeline with their duration

20. **Given** tasks have parent-child relationships, **When** viewing Gantt chart, **Then** parent tasks span the range of all their children

21. **Given** tasks are on the Gantt chart, **When** I drag to extend/shrink a task bar, **Then** the start/end dates are updated

22. **Given** the Gantt chart is displayed, **When** I filter by assignee or state, **Then** only matching tasks are shown

#### Analytics & Reporting

23. **Given** a project has tasks with metadata, **When** I open the analytics view, **Then** I see a summary table with customizable grouping and filtering

24. **Given** analytics view, **When** I group by "Assignee" and filter by "State = In Progress", **Then** I see count/sum of tasks per assignee that are in progress

25. **Given** custom fields exist, **When** I group by "Story Points", **Then** I see aggregated metrics (sum, average, count) per group

26. **Given** analytics data, **When** I export to CSV/Excel, **Then** I can download the data for external analysis

#### Real-time Collaboration

27. **Given** multiple users viewing the same project board, **When** one user moves a task, **Then** all other viewers see the change in real-time

28. **Given** a task's chat channel, **When** someone posts a comment, **Then** all channel members (watchers, assignees, reporter) are notified via notification hub

29. **Given** I am watching a task, **When** any changes occur (state change, field update, new assignee), **Then** I receive a notification

### Edge Cases

- What happens when a project is deleted? → Projects are archived (read-only), not permanently deleted
- What happens when a task's parent is deleted? → Children become orphaned (moved to root level); project rule can configure cascade archive
- What happens when a custom field is deleted? → Data preserved but field hidden from UI; warn admin before archival
- What happens when a state is deleted but tasks are in that state? → Require moving tasks to another state before deletion
- What happens when maximum nesting depth is reached? → Maximum 5 levels; system prevents creating deeper children
- What happens when a user is unassigned from all tasks but watches a project? → They retain project membership, can still view
- What happens when task dates conflict (end before start)? → System prevents invalid date ranges
- What happens when circular parent-child relationships are attempted? → System prevents cycles
- What happens to completed tasks in analytics? → Include by default with filter option to exclude
- What happens when project has hundreds of tasks? → Pagination, lazy loading, virtual scrolling in board view

## Requirements *(mandatory)*

### Functional Requirements

#### Project Management

- **FR-001**: System MUST allow employees to create projects with name, description, and optional project icon/color
- **FR-002**: System MUST support default project states template (Backlog, In Progress, Review, Done) that users can customize
- **FR-003**: System MUST allow project admins to add, rename, reorder, and remove states
- **FR-004**: System MUST prevent deletion of states that contain tasks (require moving tasks first)
- **FR-005**: System MUST support project-level task levels (e.g., Epic, Story, Task, Subtask) with customizable names
- **FR-006**: System MUST provide default task levels template that users can customize
- **FR-007**: System MUST support project archival (read-only access, no new tasks, no permanent deletion)
- **FR-008**: System MUST support project membership (who can view/edit the project)
- **FR-009**: System MUST track project admins who can manage settings, states, custom fields, and workflow rules

#### Task Management (Core)

- **FR-010**: System MUST allow project members to create tasks with title
- **FR-011**: System MUST auto-generate unique task identifier per project (e.g., PROJ-123)
- **FR-012**: System MUST support task description as a linked document (reusing docs system #016)
- **FR-013**: System MUST auto-create a chat channel for each task for discussions (reusing chat system #009)
- **FR-014**: System MUST support task comments as channel messages in the task's chat channel
- **FR-015**: System MUST support file attachments on tasks (reusing files system #014/#015)
- **FR-016**: System MUST track task reporter (who created the task)
- **FR-017**: System MUST support multiple assignees per task
- **FR-018**: System MUST support task watchers (users who receive notifications but are not assignees)
- **FR-019**: System MUST support task status: open, closed
- **FR-020**: System MUST support task state (project-specific column, e.g., "In Progress", "QA")
- **FR-021**: System MUST support task start date and due date for timeline planning
- **FR-022**: System MUST support task priority (configurable levels, default: Low, Medium, High, Critical)

#### Task Hierarchy

- **FR-023**: System MUST support parent-child relationships between tasks
- **FR-024**: System MUST enforce task level hierarchy (e.g., Epic → Story → Task → Subtask)
- **FR-025**: System MUST prevent circular parent-child relationships
- **FR-026**: System MUST limit maximum hierarchy depth to 5 levels
- **FR-027**: System MUST support expanding/collapsing child tasks in views
- **FR-028**: System MUST allow moving tasks between parents (re-parenting)

#### Custom Fields (Dynamic Metadata)

- **FR-029**: System MUST support project-level custom field definitions
- **FR-030**: System MUST support custom field types: text, number, single-select, multi-select, date, user (employee picker)
- **FR-031**: System MUST store custom field values per task without requiring schema changes
- **FR-032**: System MUST allow project admins to add, edit, and archive custom fields
- **FR-033**: System MUST preserve custom field data when field is archived (hidden from UI but data retained)
- **FR-034**: System MUST validate custom field values according to field type constraints
- **FR-035**: System MUST support default values for custom fields

#### Workflow Rules (Automation)

- **FR-036**: System MUST allow project admins to define workflow rules
- **FR-037**: System MUST support rule condition: "when task enters state X"
- **FR-038**: System MUST support rule action: "set status to closed/open"
- **FR-039**: System MUST support rule action: "set custom field value"
- **FR-040**: System MUST execute rules in defined order
- **FR-041**: System MUST log workflow rule executions for audit trail

#### Gantt Chart Visualization

- **FR-042**: System MUST provide Gantt chart view showing tasks on timeline based on start/due dates
- **FR-043**: System MUST display parent tasks spanning the range of their children in Gantt view
- **FR-044**: System MUST support dragging task bars to update dates in Gantt view
- **FR-045**: System MUST support zooming Gantt timeline (day, week, month, quarter views)
- **FR-046**: System MUST support filtering Gantt chart by assignee, state, level, custom fields
- **FR-047**: System MUST highlight overdue tasks in Gantt view

#### Analytics & Reporting

- **FR-048**: System MUST provide analytics view with customizable summary table
- **FR-049**: System MUST support grouping by: state, status, assignee, reporter, level, priority, custom fields
- **FR-050**: System MUST support filtering by: any task field including custom fields
- **FR-051**: System MUST calculate aggregations: count, sum (numeric fields), average (numeric fields)
- **FR-052**: System MUST support multi-level grouping (e.g., group by state, then by assignee)
- **FR-053**: System MUST support date range filtering (tasks updated/created within range)
- **FR-054**: System MUST support exporting analytics data to CSV format
- **FR-055**: System MUST update analytics in real-time as tasks change

#### Views & Display

- **FR-056**: System MUST support Kanban board view (tasks in state columns)
- **FR-057**: System MUST support list view (table with sortable columns)
- **FR-058**: System MUST support Gantt chart view (timeline)
- **FR-059**: System MUST support saving view configurations (filters, groupings) as named views
- **FR-060**: System MUST allow drag-and-drop to move tasks between states in board view
- **FR-061**: System MUST allow drag-and-drop to reorder tasks within a state

#### Real-time Collaboration

- **FR-062**: System MUST broadcast task state changes to all viewers in real-time
- **FR-063**: System MUST broadcast task field updates to all viewers in real-time
- **FR-064**: System MUST integrate with notification hub for all notifications
- **FR-065**: System MUST send notifications on: task creation, assignment, state change, comment, mention
- **FR-066**: System MUST support @mentions in task comments (via chat system)
- **FR-067**: System MUST show who is currently viewing a task (presence awareness)

#### Access Control

- **FR-068**: System MUST enforce project membership for viewing tasks
- **FR-069**: System MUST enforce tenant isolation (organization_id on all queries)
- **FR-070**: System MUST support project visibility: private (members only) or organization-wide
- **FR-071**: All project members MUST have access to all tasks within the project (no task-level restrictions in v1)

### Key Entities

- **Project**: A container for tasks with customizable workflow states, task levels, and custom fields. Has name, description, key (for task identifiers), member list, admin list, visibility settings, archived status. Links to multiple tasks. Belongs to one organization.

- **ProjectState**: A column/stage in the project workflow (e.g., "Backlog", "In Progress"). Has name, position (for ordering), color, and optional workflow rules. States are project-specific.

- **TaskLevel**: Defines hierarchy level names for tasks (e.g., "Epic", "Story", "Task"). Has name, position, and icon. Project-specific with configurable nesting rules.

- **Task**: Core work item with title, unique identifier (PROJ-123), status (open/closed), current state, level, reporter, assignees, watchers, parent task, start/due dates, priority. Links to a document for description, a chat channel for comments, and files for attachments.

- **CustomFieldDefinition**: Schema for a custom field at project level. Has name, type (text/number/select/date/user), options (for select types), default value, position. Archived fields are hidden but data preserved.

- **CustomFieldValue**: Instance of a custom field value for a specific task. Stores the value according to field type. Key-value storage to avoid schema bloat.

- **WorkflowRule**: Automation rule at project level. Has trigger condition (state entered), action (set status, set field), execution order, enabled flag.

- **ProjectMembership**: Links employees to projects with role (admin/member). Controls access and permissions.

- **SavedView**: User's saved view configuration for a project. Has filters, grouping, view type (board/list/gantt), column ordering.

### Scale & Distribution Considerations

- **Expected concurrent users**: 50+ users per project viewing board simultaneously
- **Task volume**: System should support projects with 10,000+ tasks
- **Real-time updates**: All board/list changes must be visible within 1 second
- **Custom field storage**: Support 50+ custom fields per project without performance degradation
- **Analytics queries**: Aggregations over 10,000+ tasks should complete within 5 seconds
- **Multi-instance resilience**: User sessions survive server instance failures; reconnect to any instance
- **State consistency**: Users see their own changes immediately; other users see changes within 2 seconds

---

## Dependencies

- **Feature #009 (Chat Backend)**: Task comments are implemented as messages in auto-created chat channels per task
- **Feature #016 (Docs System)**: Task descriptions are implemented as linked documents for rich editing
- **Feature #014/#015 (Files System)**: Task attachments use the existing file upload infrastructure
- **Feature #007 (Notification Hub)**: All task notifications route through notification hub for real-time delivery

---

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous  
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---

## Notes for Planning Phase

1. **Integration Strategy**: 
   - Task → Chat: Auto-create channel with `channel_type='project_ticket_thread'` on task creation
   - Task → Docs: Create document for description, link via document_id
   - Task → Files: Use `upload_context='project'` for task attachments

2. **Custom Fields Storage**: 
   - Store definitions at project level (separate table)
   - Store values as key-value pairs (JSONB or separate table with field_id, task_id, value)
   - Enables analytics queries without schema changes

3. **Real-time Architecture**:
   - Leverage notification hub SSE for board updates
   - Ephemeral signals for "who is viewing" presence
   - Channel membership auto-includes task watchers, assignees, reporter

4. **Analytics Design**:
   - Pre-aggregate common metrics or compute on-demand?
   - Consider materialized views for frequently-used groupings
   - Export uses streaming for large datasets

5. **Task Identifier Generation**:
   - Project-scoped sequential counter (PROJ-1, PROJ-2, ...)
   - Store project key and next_task_number on project entity
   - Ensure atomicity for concurrent task creation

6. **Future Considerations (Not in v1)**:
   - Task dependencies (blocked by/blocks)
   - Time tracking (actual hours spent)
   - Recurring/template tasks
   - Sprint/iteration grouping
   - Bulk task operations
