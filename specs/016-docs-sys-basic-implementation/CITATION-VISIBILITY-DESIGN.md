# Citation Visibility Design: How Owners See Who Cites Their Content

**Date**: 2025-12-22  
**Status**: Design Proposal  
**Problem**: Document owners need to know when their content is being cited by others, and which specific lines are being embedded.

---

## Problem Statement

When someone embeds a section from Document A into Document B:
- **Document A owner** has no visibility that their content is being cited
- **Document A owner** doesn't know which specific lines are important to others
- **Document A owner** may unknowingly break citing documents when editing

This creates **responsibility blindness** - authors can't see the ripple effects of their edits.

---

## Design Goals

1. **Awareness**: Owners should immediately see when their document is cited
2. **Specificity**: Show exactly which lines are being cited
3. **Non-intrusive**: Don't clutter the editing experience
4. **Actionable**: Link directly to citing documents

---

## Solution: Multi-Layer Citation Visibility

### Layer 1: Document Metadata Banner (High-Level Awareness)

When viewing a document that has incoming citations, show a subtle **citation banner** below the toolbar:

```
┌─────────────────────────────────────────────────────────────────┐
│ 📌 Cited by 3 documents  •  Lines 5-10, 25-30, 45  [View All]  │
└─────────────────────────────────────────────────────────────────┘
```

**Design Details**:
- **Icon**: 📌 (pushpin) or 🔗 (link) to suggest "referenced"
- **Count**: Number of unique documents citing this one
- **Line Summary**: Quick glance at which lines are "hot" (cited)
- **Action**: "View All" opens Citations Panel
- **Color**: Subtle background tint (use `colors.bg.info` or similar)
- **Visibility**: Only shown to document owner/editors, not viewers

### Layer 2: Line Number Sidebar Heat Map (In-Context Awareness)

In the `LineNumberSidebar`, show **heat map visualization** on lines that are being cited:

```
   1 │ # Introduction
   2 │ This document explains...
▌  3 │ Important concept here   ← Line 3 cited by 2 documents (blue/cool)
▌  4 │ And continuation        
   5 │ 
   6 │ ## Details
▌  7 │ Critical technical info  ← Line 7 cited by 6 documents (red/hot)
   8 │ 
```

**Heat Map Color Scale**:
- **1-2 citations**: Light Blue (cool) - Low citation density
- **3-4 citations**: Yellow/Amber (warm) - Moderate citation density
- **5+ citations**: Orange/Red (hot) - High citation density

**Design Details**:
- **Visualization**: Background color intensity increases with citation count (heat map)
- **Left Border**: Colored accent border (3px) matching heat level
- **Colors**: 
  * Cool (1-2): Light Blue (#93C5FD → #3B82F6)
  * Warm (3-4): Yellow/Amber (#FDE047 → #F59E0B)
  * Hot (5+): Orange/Red (#FB923C → #EF4444)
- **Theme Support**: Both light and dark mode with appropriate opacity adjustments
- **Tooltip on hover**: Shows heat level, citation count, and links to citing docs
- **Click behavior**: Opens Citations Panel filtered to that line range
- **Fade effect**: Smooth color transitions for visual clarity

**Alternative Visual Options** (Deprecated):
1. ~~Colored dot next to line number~~ (Replaced by heat map)
2. ~~Colored left border only~~ (Now combined with heat map)
3. ~~Background tint on cited lines~~ (Now intensity-based)
4. ~~Icon in gutter~~ (Not needed with heat map)

### Layer 3: Citations Panel (Detailed View)

A new tab in `RightPanel` alongside Comments and History:

```
┌──────────────────────────────────────────┐
│ [Comments] [History] [Citations]         │
├──────────────────────────────────────────┤
│ 📊 3 documents cite this document        │
├──────────────────────────────────────────┤
│                                          │
│ 📄 Project Setup Guide                   │
│    Lines 5-10 → their Lines 23-28        │
│    Version: v3 (stale - v5 available)    │
│    Last updated: Dec 20, 2025            │
│    [View Document]                       │
│                                          │
│ ─────────────────────────────────────    │
│                                          │
│ 📄 Onboarding Checklist                  │
│    Lines 25-30 → their Lines 5-10        │
│    Version: v5 (current)                 │
│    Last updated: Dec 21, 2025            │
│    [View Document]                       │
│                                          │
│ ─────────────────────────────────────    │
│                                          │
│ 📄 Technical Reference                   │
│    Lines 7-7 → their Lines 45-45         │
│    Version: v4 (stale - v5 available)    │
│    Last updated: Dec 18, 2025            │
│    [View Document]                       │
│                                          │
└──────────────────────────────────────────┘
```

**Design Details**:
- **Summary header**: Total count of citing documents
- **Per-citation card**:
  - Document title (linked)
  - Line mapping: "Your Lines X-Y → Their Lines A-B"
  - Version status: Which version they captured (with staleness indicator)
  - Last updated timestamp of the citing document
  - Quick action to view citing document
- **Grouping**: Group by line range for easy scanning
- **Empty state**: "No documents cite this content yet"

### Layer 4: Edit Warning (Responsibility Reminder)

When entering edit mode on a document with citations, show a **one-time warning**:

```
┌────────────────────────────────────────────────────────────────────┐
│ ⚠️ This document is cited by 3 other documents                    │
│                                                                    │
│ Changes to cited lines (highlighted) may affect how your content  │
│ appears in those documents. Consider reviewing citations before   │
│ making significant edits.                                         │
│                                                                    │
│                              [Got it] [View Citations]             │
└────────────────────────────────────────────────────────────────────┘
```

**Design Details**:
- **One-time per session**: Don't annoy users with repeated warnings
- **Dismissible**: "Got it" button remembers preference
- **Actionable**: "View Citations" opens the panel
- **Non-blocking**: Just informational, doesn't prevent editing

---

## Data Model Changes

### New SQL Query: List Incoming Citations

```sql
-- name: ListIncomingCitations :many
-- Get all embeds that cite this document (incoming citations)
SELECT 
    e.*,
    source_d.title AS source_document_title,
    source_d.slug AS source_document_slug,
    source_d.owner_employee_id AS source_owner_employee_id,
    emp.given_name || ' ' || emp.family_name AS source_owner_name,
    source_d.updated_at AS source_updated_at
FROM docs.section_embed e
JOIN docs.document source_d ON (source_d.organization_id, source_d.id) = (e.organization_id, e.source_document_id)
JOIN organization.employee emp ON (emp.organization_id, emp.id) = (source_d.organization_id, source_d.owner_employee_id)
WHERE e.organization_id = @organization_id 
  AND e.target_document_id = @target_document_id
  AND source_d.is_deleted = FALSE
ORDER BY e.target_line_start ASC, source_d.updated_at DESC;
```

### Proto Addition

```protobuf
message IncomingCitation {
  string id = 1;
  
  // Source document (the one containing the embed)
  string source_document_id = 2;
  string source_document_title = 3;
  string source_document_slug = 4;
  string source_owner_name = 5;
  int32 source_line_start = 6;
  int32 source_line_end = 7;
  google.protobuf.Timestamp source_updated_at = 8;
  
  // Target (this document) line info
  int32 target_line_start = 9;
  int32 target_line_end = 10;
  
  // Version info
  int32 cited_at_version = 11;
  int32 current_version = 12;
  bool is_stale = 13;
}

message ListIncomingCitationsRequest {
  string document_id = 1 [(buf.validate.field).required = true];
}

message ListIncomingCitationsResponse {
  repeated IncomingCitation citations = 1;
  int32 total_count = 2;
  
  // Aggregated line ranges for quick display
  repeated CitedLineRange cited_line_ranges = 3;
}

message CitedLineRange {
  int32 start_line = 1;
  int32 end_line = 2;
  int32 citation_count = 3; // How many documents cite this range
}
```

### New RPC Method

```protobuf
service SectionEmbedService {
  // ... existing methods ...
  
  // ListIncomingCitations lists all embeds that cite a specific document
  rpc ListIncomingCitations(ListIncomingCitationsRequest) returns (ListIncomingCitationsResponse) {
    option (rpc.v1.access_control) = {
      allowed_roles: [ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]
      allow_unauthenticated: false
    };
  }
}
```

---

## Frontend Component Architecture

### New Components

1. **`CitationsPanel.tsx`** - Tab content for RightPanel
   - Lists all incoming citations
   - Grouped by line range
   - Links to citing documents

2. **`CitationBanner.tsx`** - Document-level awareness banner
   - Shows in DocumentView toolbar area
   - Compact summary with expand action

3. **Enhanced `LineNumberSidebar.tsx`** - Add citation markers
   - Accept `citedLineRanges` prop
   - Render markers/highlights for cited lines
   - Tooltip with citation details

### Component Props

```typescript
// CitationsPanel
interface CitationsPanelProps {
  documentId: string;
  currentVersionNumber: number;
}

// CitationBanner
interface CitationBannerProps {
  citationCount: number;
  citedLineRanges: CitedLineRange[];
  onViewAll: () => void;
}

// LineNumberSidebar enhancement
interface LineNumberSidebarProps {
  // ... existing props ...
  citedLineRanges?: CitedLineRange[];
  onCitedLineClick?: (lineRange: CitedLineRange) => void;
}

// Types
interface CitedLineRange {
  startLine: number;
  endLine: number;
  citationCount: number;
}

interface IncomingCitation {
  id: string;
  sourceDocumentId: string;
  sourceDocumentTitle: string;
  sourceDocumentSlug: string;
  sourceOwnerName: string;
  sourceLineStart: number;
  sourceLineEnd: number;
  sourceUpdatedAt: Date;
  targetLineStart: number;
  targetLineEnd: number;
  citedAtVersion: number;
  currentVersion: number;
  isStale: boolean;
}
```

---

## Visual Design Specifications

### Colors (Theme-Aware)

```typescript
// Heat map color scale (implemented in LineNumberSidebar)
const getHeatColor = (citationCount: number, isDark: boolean) => {
  if (citationCount === 0) return 'transparent';
  
  // Heat map scale: 1-2 citations (cool) → 3-5 citations (warm) → 6+ citations (hot)
  // Color progression: Light Blue → Yellow → Orange → Red
  
  if (citationCount === 1) {
    return isDark ? 'rgba(147, 197, 253, 0.2)' : 'rgba(191, 219, 254, 0.3)'; // Light Blue
  } else if (citationCount === 2) {
    return isDark ? 'rgba(147, 197, 253, 0.4)' : 'rgba(147, 197, 253, 0.5)'; // Blue
  } else if (citationCount === 3) {
    return isDark ? 'rgba(253, 224, 71, 0.3)' : 'rgba(254, 240, 138, 0.5)'; // Yellow
  } else if (citationCount === 4) {
    return isDark ? 'rgba(251, 191, 36, 0.4)' : 'rgba(252, 211, 77, 0.6)'; // Amber
  } else if (citationCount === 5) {
    return isDark ? 'rgba(251, 146, 60, 0.4)' : 'rgba(251, 191, 36, 0.6)'; // Orange
  } else {
    return isDark ? 'rgba(239, 68, 68, 0.4)' : 'rgba(248, 113, 113, 0.6)'; // Red (hot)
  }
};

// Heat map border colors
const borderColors = {
  cool: '#3b82f6',   // Blue (1-2 citations)
  warm: '#f59e0b',   // Amber (3-4 citations)
  hot: '#ef4444',    // Red (5+ citations)
};
```

### Line Number Heat Map Design

```
Option A (IMPLEMENTED): Heat Map Background + Border
┌──────────────────────────────────────────┐
│  1 │ Hello                               │
│▌ 2 │ World ←2 cites (blue/cool)         │  ← Light blue background
│▌ 3 │ Test  ←2 cites (blue/cool)         │
│  4 │ More content                        │
│▌ 5 │ Critical ←5 cites (orange/warm)    │  ← Orange background (warmer)
│▌ 6 │ Important ←7 cites (red/hot)       │  ← Red background (hottest)
│  7 │ End                                 │
└──────────────────────────────────────────┘

Heat Map Legend:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  1-2 citations:  Light Blue (Cool)    🟦
  3-4 citations:  Yellow/Amber (Warm)  🟨
  5+ citations:   Orange/Red (Hot)     🟥
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tooltip Content (on hover):
┌────────────────────────────────┐
│ High citation density          │
│ Cited by 7 documents           │
│                                │
│ Click to view citations        │
└────────────────────────────────┘
```

**Key Features**:
- **Progressive intensity**: Background color intensity scales with citation count
- **Color coding**: Blue (cool) → Yellow (warm) → Red (hot)
- **Left border accent**: 3px colored border reinforces heat level
- **Interactive**: Entire line clickable to view citations
- **Informative tooltip**: Shows density level, count, and action hint

**Alternative Options** (Not Implemented):
```
Option B: Filled Circle (Old Design - Deprecated)
┌────────────────────┐
│ 1 │ Hello          │
│●2 │ World ←cited   │
│●3 │ Test  ←cited   │
│ 4 │ End            │
└────────────────────┘

Option C: Background Tint Only (Less Clear)
┌────────────────────┐
│ 1 │ Hello          │
│ 2 │▓World ←cited   │
│ 3 │▓Test  ←cited   │
│ 4 │ End            │
└────────────────────┘

Option D: Dot + Number (Cluttered)
┌────────────────────┐
│  1 │ Hello         │
│●₂2 │ World ←2 cites│
│●₁3 │ Test  ←1 cite │
│  4 │ End           │
└────────────────────┘
```

---

## Implementation Tasks

### Phase 1: Backend (Database + RPC)

1. Add `ListIncomingCitations` SQL query to `docs.query.sql`
2. Run `sqlc generate`
3. Add `ListIncomingCitations` to proto definitions
4. Run `buf generate`
5. Implement `ListIncomingCitations` in `embed_logic.go`
6. Wire up Connect handler in `embed_connect.go`

### Phase 2: Frontend API

1. Add `IncomingCitation` and `CitedLineRange` types to `packages/apis/src/docs.ts`
2. Add `listIncomingCitations` wrapper function
3. Build frontend packages

### Phase 3: UI Components

1. Create `CitationsPanel.tsx`
2. Create `CitationBanner.tsx`
3. Enhance `LineNumberSidebar.tsx` with citation markers
4. Add Citations tab to `RightPanel.tsx`
5. Integrate banner into `DocumentView.tsx`

### Phase 4: Polish

1. Add loading states
2. Add empty states
3. Add tooltips
4. Add keyboard shortcuts
5. Add data-testid attributes
6. Verify theme colors

---

## User Flow Examples

### Flow 1: Owner Discovers Citations

1. Owner opens their document
2. Sees banner: "📌 Cited by 3 documents"
3. Notices purple dots on lines 5-10
4. Clicks "View All" → Citations panel opens
5. Sees list of citing documents with line mappings
6. Clicks a citation → navigates to citing document

### Flow 2: Owner Edits Cited Content

1. Owner enters edit mode
2. One-time warning appears about citations
3. Clicks "View Citations" to see who depends on this content
4. Makes careful edits knowing which lines are referenced
5. Saves document
6. Citing documents now show "Stale embed" indicator

### Flow 3: Quick Line Check

1. Owner hovers over purple dot on line 7
2. Tooltip shows: "Cited by 2 documents"
3. Quick links: "Technical Guide", "API Reference"
4. Clicks link → opens citing document in new tab

---

## Accessibility Considerations

1. **Screen readers**: Markers should have aria-label
2. **Keyboard navigation**: Tab through citations in panel
3. **Color blindness**: Use shape (●) not just color
4. **Focus indicators**: Clear focus states on all interactive elements

---

## Future Enhancements

1. **Notification on new citation**: Notify owner when someone cites their document
2. **Citation analytics**: Track citation count over time
3. **Bidirectional links**: Show both incoming and outgoing citations in one view
4. **Citation health dashboard**: Organization-wide view of stale citations
5. **Auto-update embeds**: "Update all stale citations" bulk action

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Use heat map visualization | More intuitive than dots - warmer color = higher importance |
| Progressive color scale | Blue → Yellow → Orange → Red clearly shows citation density gradient |
| Background + border combination | Dual visual cues ensure visibility in all themes |
| Show citations only to owner/editors | Viewers don't need this context |
| One-time edit warning | Balance awareness vs. friction |
| Aggregate by line range | Easier to scan than individual citations |
| Include version staleness | Critical for understanding embed health |
| Entire line clickable | Reduces need for tiny dot target - better UX |
| Tooltip with heat label | "Low/Moderate/High citation density" is more descriptive than just count |

