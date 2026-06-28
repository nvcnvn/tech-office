# Feature Specification: Document Management System (Notion/Confluence-style)

**Feature Branch**: `016-docs-sys-basic-implementation`  
**Created**: 2024-12-19  
**Status**: Draft  
**Input**: User description: "docs sys basic implementation - document management like notion or confluence with nested pages, versioning, section linking, permissions, and full-text search"

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As an employee, I want to create, organize, and collaborate on documentation within my organization so that knowledge is easily accessible, versioned, and shareable with appropriate access controls.

### Acceptance Scenarios

#### Document Creation & Organization
1. **Given** I am logged in, **When** I create a new root document, **Then** the system generates a URL-friendly slug combining title and unique identifier
2. **Given** I have a document, **When** I rename it, **Then** the old slug redirects to the new slug (permanent link integrity)
3. **Given** I have a document, **When** I create a child page, **Then** the child is nested under the parent in the hierarchy

#### Editing & Versioning
4. **Given** I am editing a document, **When** I save changes, **Then** a new version is recorded with timestamp, author, and diff
5. **Given** I view a document's history, **When** I inspect a version, **Then** I can see line-by-line attribution (who wrote what)
6. **Given** I am viewing version history, **When** I select a previous version, **Then** I can see what changed between versions (diff view)

#### Section Linking & Embedding
7. **Given** I am viewing a document, **When** I select lines 2-7 and share, **Then** a link is generated that opens the document with those lines highlighted
8. **Given** I am editing document B, **When** I embed a section from document A, **Then** the embedded content displays with document A's status indicator
9. **Given** document A has status "outdated", **When** document B embeds a section from A, **Then** the embedded section displays an "outdated" warning

#### Access Control & Permissions
10. **Given** I create a root document, **When** I set it as private, **Then** only specified users/teams can access it
11. **Given** I have a public root document, **When** another employee visits it, **Then** they can read and comment by default
12. **Given** I grant "write+update" permission to a user, **When** they access the document, **Then** they can edit the content

#### Search
13. **Given** documents exist in the system, **When** I search for text, **Then** original content ranks higher than embedded/cited content
14. **Given** I search for content, **When** results include documents I don't have access to, **Then** those documents are excluded from results

### Edge Cases
- What happens when a parent document is deleted? → Child documents become orphaned root documents
- What happens when an embedded source document is deleted? → Show "source unavailable" placeholder
- How does the system handle concurrent edits? → Merge changes; support multiple users editing same line with real-time sync
- What happens when a user loses access to a document they're editing? → Save current work, prevent future edits
- How deep can nesting go? → Maximum 10 levels; URL shows only 3 levels then uses shortened format
- What happens when too many users try to edit simultaneously? → Block new editors when ≥10 concurrent editors

---

## Requirements *(mandatory)*

### Functional Requirements

#### Document Structure
- **FR-001**: System MUST support hierarchical document organization with parent-child relationships (nested pages)
- **FR-002**: System MUST allow unlimited root documents per organization (documents without parent)
- **FR-003**: System MUST generate URL slugs in format `{title-text}-{base62-uuid}` for permanent linking
- **FR-004**: System MUST redirect old slugs to new slugs when document titles change
- **FR-005**: System MUST support document status values: active, outdated, archived
- **FR-005a**: System MUST limit document hierarchy to maximum 10 levels depth
- **FR-005b**: System MUST display only 3 levels in URL path; deeper levels use shortened base32 format

#### Content Editing
- **FR-006**: System MUST support Markdown content format
- **FR-007**: System MUST support WYSIWYG editing mode (compatible with TipTap)
- **FR-008**: System MUST preserve content format when switching between Markdown and WYSIWYG modes
- **FR-009**: System MUST support line-based content structure for section referencing

#### Version History
- **FR-010**: System MUST create a new version on every save with timestamp, author, and content snapshot
- **FR-011**: System MUST display version history with author attribution (git blame style)
- **FR-012**: System MUST allow viewing diff between any two versions (StackOverflow edit history style)
- **FR-013**: Users MUST be able to browse and preview any historical version (read-only, no revert)
- **FR-014**: System MUST retain all versions indefinitely (no pruning policy)

#### Section Linking & Embedding
- **FR-015**: Users MUST be able to select a range of lines (e.g., lines 2-7) and generate a shareable link
- **FR-016**: System MUST highlight the specified line range when opening a section link
- **FR-017**: Users MUST be able to embed/cite a section from one document into another document
- **FR-018**: Embedded sections MUST display the source document's status (active/outdated/archived)
- **FR-019**: Embedded sections MUST show live content from source document (not cached copy)
- **FR-020**: System MUST indicate when an embedded section's source is unavailable or inaccessible

#### Access Control
- **FR-021**: Root documents MUST have visibility setting: public (organization-wide) or private
- **FR-022**: Private documents MUST support access grants to specific users or teams
- **FR-023**: System MUST support two permission levels: read+comment and write+update
- **FR-024**: All users with access MUST have read+comment permission by default (minimum access)
- **FR-025**: Child documents MUST inherit parent document's access control settings
- **FR-026**: Child documents MAY only be MORE restrictive than parent (cannot grant broader access than parent allows)
- **FR-027**: Only users with write+update permission can change document status

#### Search
- **FR-028**: System MUST support full-text search across document content
- **FR-029**: Search results MUST rank original content higher than embedded/cited content
- **FR-030**: Search results MUST respect access control (only show accessible documents)
- **FR-031**: Search MUST support multilingual content (consistent with existing PGroonga infrastructure)

#### Comments
- **FR-032**: Users MUST be able to select a block of text and add a comment (inline commenting)
- **FR-033**: Comments MUST be visible to all users with read access to the document
- **FR-034**: Comment threads MUST support replies for discussion/clarification

#### Notifications
- **FR-035**: System MUST notify document owner when their document is edited
- **FR-036**: System MUST notify users when they are @mentioned in a document or comment
- **FR-037**: Users MUST be able to "follow" a document to receive update notifications
- **FR-038**: System MUST notify followers when a followed document is updated

#### Collaborative Editing
- **FR-039**: System MUST support real-time collaborative editing with automatic merge
- **FR-040**: System MUST support multiple users editing the same line simultaneously
- **FR-041**: System MUST limit concurrent editors to 10 per document
- **FR-042**: System MUST block new editors when concurrent editor limit is reached (with notification)

### Key Entities

- **Document**: A page of content with title, body, status, and optional parent. Forms a tree structure within organization. Has unique slug for permanent URLs.
  
- **DocumentVersion**: Historical snapshot of document content with author, timestamp, and content. Enables diff comparison and blame-style attribution.
  
- **Section**: A range of lines within a document that can be linked to or embedded in other documents. Referenced by document ID and line range.
  
- **DocumentAccess**: Permission grant linking a document to users or teams with specific access level (read+comment or write+update).
  
- **SectionEmbed**: A citation/embed relationship from one document to a section in another document. Displays live content with source status.

- **Comment**: An inline comment attached to a specific text block within a document. Supports threaded replies for discussion.

- **DocumentFollower**: A subscription relationship between a user and a document for receiving update notifications.

### Scale & Distribution Considerations

- **Expected concurrent editors**: Maximum 10 concurrent editors per document; block new editors when limit reached
- **Document count**: System should support thousands of documents per organization
- **Version retention**: All versions retained indefinitely (no pruning)
- **Document size**: No size limits for documents
- **Search performance**: Full-text search with PGroonga, no special size constraints
- **Multi-instance resilience**: Document reads must be consistent across server instances; real-time collaborative editing with merge support
- **Embedded content**: System must handle circular embedding detection (A embeds B which embeds A)

---

## Clarifications Resolved

| Question | Resolution |
|----------|------------|
| Conflict resolution | Merge with real-time sync; support multiple users editing same line |
| Nesting depth | Max 10 levels; URL shows 3 levels then shortened base32 format |
| Permission inheritance | Children can only be MORE restrictive than parent |
| Version revert | No revert in first release; preview only |
| Document size limits | No limits |
| Concurrent editors | Max 10; block new editors when limit reached |
| Version retention | No pruning; retain all versions indefinitely |
| Comments | Yes - select text block and add inline comment |
| Notifications | Yes - for owner, @mentioned users, and followers |
| Export | Not in first release |

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
