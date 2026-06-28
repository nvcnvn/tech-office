# Research: Departments Org Chart V2

**Feature**: Departments Org Chart V2 (spec-025)  
**Date**: 2026-03-19  
**Status**: Complete

## Overview

This feature is a **pure frontend redesign** — no backend changes required. The existing `DepartmentService` RPC APIs (GetDepartmentTree, GetDepartment, GetDepartmentMembers, CRUD operations) are fully adequate. Research focuses on frontend visualization library choice, layout algorithm, pan/zoom strategy, and mobile responsiveness.

---

## Research Question 1: Org Chart Visualization Library

**Question**: What library should be used for rendering the visual, node-based org chart with pan/zoom?

**Decision**: Use `@xyflow/react` (React Flow v12+) combined with `@dagrejs/dagre` for hierarchical layout computation.

**Rationale**:
- React Flow is purpose-built for interactive node-based diagrams with built-in pan/zoom, minimap, and edge rendering
- `dagre` is the de-facto hierarchical layout algorithm used alongside React Flow — automatically positions nodes top-down from root to leaves, handles variable subtree widths, and is well-documented
- TypeScript native; both libraries ship comprehensive type definitions
- MIT licensed — no commercial restrictions
- React Flow handles 10,000+ nodes in benchmarks (well above SC-003's 100+ threshold)
- Active development (React Flow v12 supports React 19 which the project uses)
- No drag-and-drop conflict: `@dnd-kit` is already used in the project for other features; React Flow's internal panning does not interfere with `@dnd-kit`

**Alternatives Considered**:
- **Custom CSS tree with SVG edges**: Rejected — implementing pan/zoom from scratch is complex and error-prone; would require touch event handling, gesture recognition, and transform matrix math
- **d3-hierarchy + d3-zoom**: Rejected — requires imperative DOM manipulation, conflicts with React 19's concurrent rendering model, much harder to maintain
- **orgchart.js / react-org-chart**: Rejected — older libraries not maintained for React 19, poor TypeScript support
- **Mermaid.js**: Rejected — static output only, cannot support interactive CRUD actions on nodes

**New Dependencies to Add**:
```json
"@xyflow/react": "^12.x",
"@dagrejs/dagre": "^1.x"
```

---

## Research Question 2: Hierarchical Layout Algorithm

**Question**: How should node positions be computed for the org chart tree layout?

**Decision**: Use `dagre` with `LR` (left-right) or `TB` (top-bottom) direction. Default to `TB` direction so root is at top and hierarchy flows downward — standard org chart convention.

**Layout Configuration**:
```typescript
const g = new dagre.graphlib.Graph();
g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 120, marginx: 40, marginy: 40 });
g.setDefaultEdgeLabel(() => ({}));

// Add nodes with dimensions
departments.forEach(dept => {
  g.setNode(dept.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
});

// Add edges (parent → child)
departments.forEach(dept => {
  if (dept.parentDepartmentId) {
    g.setEdge(dept.parentDepartmentId, dept.id);
  }
});

dagre.layout(g);
```

**Rationale**:
- `dagre` produces aesthetically pleasing hierarchical layouts with proper spacing
- `TB` direction matches conventional org chart expectations (top = CEO/root)
- `nodesep` and `ranksep` control horizontal and vertical spacing between nodes
- Re-layout on every department tree change ensures correctness after CRUD mutations

**Alternatives Considered**:
- **Custom recursive positioning**: Rejected — requires solving subtree width allocation manually; dagre handles this correctly with one function call
- **ELK layout engine (@eclipse-elk/core)**: More powerful but significantly heavier; overkill for org charts

---

## Research Question 3: Node Design

**Question**: How should each department node look and what information should it display?

**Decision**: Each node shows:
1. **Department name** (bold, prominent) — always visible
2. **Manager name** (subdued) — shown when a manager is assigned; shown as "No manager" warning if absent
3. **Member count** + **Child count** — small indicators in the node footer
4. **Hover-revealed action buttons**: Edit, Add Sub-dept, Add Employee, Move, Delete

Manager data is embedded in the department tree response (`managerCount`). However, the manager's **name** is not returned by `GetDepartmentTree`. Two strategies:

**Strategy A (Chosen)**: Lazy-load manager name per node using a `useQuery` on `getDepartmentMembers` triggered when the node becomes visible. Cache via React Query's `queryKey: ['departmentMembers', dept.id]` — this already exists in the current `DepartmentNode` component.

**Strategy B (Rejected)**: Pre-load all manager names in a single call. The existing `GetDepartmentTree` does not embed member names, and modifying the backend API is out of scope for this feature.

**Node dimensions**: 220px × 96px (width × height) — wide enough for department names and compact enough to show the hierarchy clearly.

---

## Research Question 4: Mobile Responsiveness (FR-005)

**Question**: How should the org chart behave on small/mobile screens where pan/zoom canvas charts are difficult to use?

**Decision**: Implement a **responsive view switcher** — automatically show the existing `DepartmentTreeView` (indent-based list) on screens narrower than `md` breakpoint (768px), and show the org chart canvas on `md`+. Also expose a manual toggle button ("Switch to List View" / "Switch to Org Chart") to let users override the auto-detection.

**Rationale**:
- The existing `DepartmentTreeView` + `DepartmentNode` components are battle-tested and work perfectly on mobile
- Reusing them for the fallback view requires zero new development for mobile
- React's `useMediaQuery` (or Next.js viewport detection) handles breakpoint switching cleanly
- The toggle button gives power users choice

**Implementation**:
```tsx
const isMobile = useMediaQuery('(max-width: 767px)');
const [forceListView, setForceListView] = useState(false);
const showListView = isMobile || forceListView;
```

**Alternatives Considered**:
- **Horizontal scroll on canvas**: Rejected — mobile pan gestures conflict with page scroll; very poor UX
- **Zoom out automatically until all nodes fit**: Rejected — nodes become unreadably small at 100+ nodes
- **Single responsive implementation**: Rejected — React Flow on mobile requires complex touch event tuning

---

## Research Question 5: Performance at 100+ Nodes (SC-003)

**Question**: Can React Flow render 100+ department nodes without significant stuttering?

**Decision**: Yes. React Flow uses windowed rendering by default — only nodes visible in the current viewport are fully rendered. Nodes outside the viewport are lightweight placeholder elements. This means 100+ nodes render as fast as 20 visible nodes in the viewport.

**Additional optimizations**:
- `useNodes` and `useEdges` are memoized — React Flow avoids re-rendering unchanged nodes
- Layout computation (dagre) runs synchronously outside React's render cycle and is only triggered on tree data changes (React Query cache updates)
- Manager name queries (`getDepartmentMembers`) are lazy — triggered only when the node first renders

**Benchmark Reference**: React Flow team documented rendering 1,000+ nodes at 60fps with virtualization enabled.

---

## Research Question 6: Integration Test Scope (Constitution Principle II)

**Question**: This feature has no new backend RPC endpoints. Are backend integration tests required?

**Decision**: No new backend integration tests are needed for this feature. The exclusion is documented and justified.

**Justification**:
- User Story 1 (View Org Chart) — describes frontend visualization only; the underlying data contract is already proven by the existing `TestDepartment` integration test which exercises `GetDepartmentTree`
- User Story 2 (Manage Departments within Org Chart) — describes frontend UI actions only; the backend CRUD operations (`CreateDepartment`, `UpdateDepartment`, `DeleteDepartment`, `MoveDepartment`, `AssignEmployeeToDepartment`, etc.) are fully covered by existing tests
- No new RPC methods are added
- No new business logic is introduced on the backend
- **Exclusion documented in plan.md Constitution Check section**

---

## Research Question 7: Existing Components to Reuse vs Replace

**Question**: Which existing components can be reused?

**Decision**:
| Component | Reuse? | How |
|---|---|---|
| `DepartmentsTab.tsx` | **Modify** | Replace `DepartmentTreeView` block with OrgChart; add view toggle |
| `DepartmentTreeView.tsx` | **Keep** | Reuse as mobile/list fallback |
| `DepartmentNode.tsx` | **Keep** | Reuse as mobile/list fallback |
| `CreateDepartmentDialog.tsx` | **Keep as-is** | Invoked from OrgChart node actions |
| `EditDepartmentDialog.tsx` | **Keep as-is** | Invoked from OrgChart node actions |
| `MoveDepartmentDialog.tsx` | **Keep as-is** | Invoked from OrgChart node actions |
| `AssignManagerDialog.tsx` | **Keep as-is** | Invoked from OrgChart node actions |
| `AddEmployeeDialog.tsx` | **Keep as-is** | Invoked from OrgChart node actions |

**New Components Required**:
| Component | Purpose |
|---|---|
| `DepartmentOrgChart.tsx` | React Flow canvas wrapper; manages layout computation and node/edge arrays |
| `DepartmentOrgNode.tsx` | React Flow custom node component; displays dept name, manager, counts, action buttons |

---

## Summary of Decisions

| Decision | Choice | Key Reason |
|---|---|---|
| Org chart library | `@xyflow/react` | Purpose-built, React 19 compatible, pan/zoom built-in |
| Layout algorithm | `@dagrejs/dagre` (TB direction) | Standard hierarchical layout, handles subtree widths |
| Manager display | Lazy-load on node render | Reuses existing query, no backend change |
| Mobile fallback | Existing `DepartmentTreeView` | Zero new development; battle-tested |
| Node dimensions | 220 × 96px | Balances readability and tree visibility |
| Integration tests | Excluded (justified) | Pure frontend; backend behavior already tested |
| New backend work | None | Existing APIs fully adequate (as per spec assumptions) |
