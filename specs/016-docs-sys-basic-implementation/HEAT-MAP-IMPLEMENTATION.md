# Heat Map Citation Visualization Implementation

**Date**: 2025-12-24  
**Task**: T061d  
**Component**: `LineNumberSidebar.tsx`  
**Feature**: Progressive heat map visualization for citation density

---

## Overview

Replaced the previous dot-based citation visualization with a **heat map system** that uses progressive color intensity to indicate citation density. This provides a more intuitive, at-a-glance understanding of which content sections are most frequently cited.

---

## Visual Design

### Heat Map Color Scale

The heat map uses a 6-level progressive color scale:

| Citation Count | Color | Theme | Visual Intensity | Density Label |
|----------------|-------|-------|------------------|---------------|
| 1 citation | Light Blue | Cool | Low | Low citation density |
| 2 citations | Blue | Cool | Low-Medium | Low citation density |
| 3 citations | Yellow | Warm | Medium | Moderate citation density |
| 4 citations | Amber | Warm | Medium-High | Moderate citation density |
| 5 citations | Orange | Warm-Hot | High | High citation density |
| 6+ citations | Red | Hot | Maximum | High citation density |

### Color Values (RGBA)

```typescript
// Light Mode (higher opacity for visibility on white background)
1: rgba(191, 219, 254, 0.3)  // Blue 200
2: rgba(147, 197, 253, 0.5)  // Blue 300
3: rgba(254, 240, 138, 0.5)  // Yellow 200
4: rgba(252, 211, 77, 0.6)   // Amber 300
5: rgba(251, 191, 36, 0.6)   // Orange 300
6+: rgba(248, 113, 113, 0.6) // Red 400

// Dark Mode (lower opacity for readability on dark background)
1: rgba(147, 197, 253, 0.2)  // Blue 300
2: rgba(147, 197, 253, 0.4)  // Blue 300
3: rgba(253, 224, 71, 0.3)   // Yellow 300
4: rgba(251, 191, 36, 0.4)   // Amber 400
5: rgba(251, 146, 60, 0.4)   // Orange 400
6+: rgba(239, 68, 68, 0.4)   // Red 500
```

### Border Colors

Left border accent (3px solid):
- **Cool (1-2 citations)**: `#3b82f6` (Blue 500)
- **Warm (3-4 citations)**: `#f59e0b` (Amber 500)
- **Hot (5+ citations)**: `#ef4444` (Red 500)

---

## Implementation Details

### Key Functions

#### `getHeatColor(citationCount: number)`

Returns the appropriate background color based on citation count and theme mode.

```typescript
const getHeatColor = useCallback((citationCount: number) => {
    if (citationCount === 0) return 'transparent';
    
    const isDark = theme.palette.mode === 'dark';
    
    if (citationCount === 1) {
        return isDark ? 'rgba(147, 197, 253, 0.2)' : 'rgba(191, 219, 254, 0.3)';
    } else if (citationCount === 2) {
        return isDark ? 'rgba(147, 197, 253, 0.4)' : 'rgba(147, 197, 253, 0.5)';
    } else if (citationCount === 3) {
        return isDark ? 'rgba(253, 224, 71, 0.3)' : 'rgba(254, 240, 138, 0.5)';
    } else if (citationCount === 4) {
        return isDark ? 'rgba(251, 191, 36, 0.4)' : 'rgba(252, 211, 77, 0.6)';
    } else if (citationCount === 5) {
        return isDark ? 'rgba(251, 146, 60, 0.4)' : 'rgba(251, 191, 36, 0.6)';
    } else {
        return isDark ? 'rgba(239, 68, 68, 0.4)' : 'rgba(248, 113, 113, 0.6)';
    }
}, [theme.palette.mode]);
```

#### `getHeatLabel(citationCount: number)`

Returns a descriptive label for tooltip display.

```typescript
const getHeatLabel = useCallback((citationCount: number) => {
    if (citationCount <= 2) return 'Low citation density';
    if (citationCount <= 4) return 'Moderate citation density';
    return 'High citation density';
}, []);
```

---

## User Experience Improvements

### Before: Dot-Based Visualization

**Issues**:
- Small dot target (6px) difficult to click
- Binary indication (cited or not) - no density information
- Requires tooltip hover to see citation count
- Visual clutter with many citations

**Visual**:
```
●  3 │ Important concept here   ← Small dot, hard to click
```

### After: Heat Map Visualization

**Benefits**:
- ✅ **Immediate density perception**: Color intensity shows importance at a glance
- ✅ **Larger clickable area**: Entire line is interactive, not just a small dot
- ✅ **Progressive information**: Color gradient clearly distinguishes between 1, 3, and 7+ citations
- ✅ **Theme-aware**: Automatically adjusts opacity for light/dark modes
- ✅ **Dual visual cues**: Background color + left border for better visibility
- ✅ **Descriptive tooltips**: "High citation density" is more informative than "7 citations"

**Visual**:
```
▌  3 │ Important concept here   ← Blue background (2 cites)
▌  7 │ Critical technical info  ← Red background (7+ cites) - HOT SPOT!
```

---

## Tooltip Enhancement

### Tooltip Content Structure

```tsx
<Tooltip
    title={
        <Box>
            <Typography variant="body2" fontWeight={600}>
                {heatLabel}  // "High citation density"
            </Typography>
            <Typography variant="caption">
                Cited by {count} document{count > 1 ? 's' : ''}
            </Typography>
            <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                Click to view citations
            </Typography>
        </Box>
    }
    placement="left"
    arrow
>
```

### Information Hierarchy

1. **Heat label** (bold): Immediate understanding of density level
2. **Count details**: Specific number of citations
3. **Action hint**: Clear call-to-action for interaction

---

## Click Behavior

### Citation Line Click

When user clicks a cited line:
1. Calls `onCitedLineClick(citation)` callback
2. Parent component opens Citations Panel
3. Panel filters to show only citations for that line range

### Non-Citation Line Click

When user clicks a non-cited line:
1. Calls `handleLineClick(lineNumber)` for line selection
2. Enables copy URL functionality for line reference

---

## Accessibility Considerations

### Screen Readers

- Tooltip content is accessible via aria-describedby
- Heat label provides semantic meaning ("High citation density")
- Citation count provides specific quantitative data

### Color Blindness

- **Dual indicators**: Background color + left border ensures visibility even if colors are hard to distinguish
- **Progressive intensity**: Even without color perception, darker shades indicate higher density
- **Text labels**: Tooltip provides non-visual information

### Keyboard Navigation

- Tab navigation moves between line numbers
- Enter key triggers click behavior
- Tooltip appears on focus, not just hover

---

## Performance Optimization

### Memoization

```typescript
const heatColor = getHeatColor(citationCount);        // Memoized via useCallback
const heatLabel = getHeatLabel(citationCount);        // Memoized via useCallback
const citation = getCitationForLine(lineNumber);      // Memoized via useCallback
```

### Render Optimization

- Color calculations happen once per line per render
- No DOM measurements required for heat map (unlike position tracking)
- Uses CSS for visual effects (no JavaScript animations)

---

## Testing Considerations

### Visual Testing

- [ ] Verify heat map colors in light mode
- [ ] Verify heat map colors in dark mode
- [ ] Check color progression (1 → 2 → 3+ citations)
- [ ] Verify left border appears on cited lines
- [ ] Check tooltip content and positioning

### Interaction Testing

- [ ] Click on cited line opens Citations Panel
- [ ] Tooltip appears on hover
- [ ] Tooltip content matches citation count
- [ ] Heat label updates correctly for different citation counts

### Edge Cases

- [ ] Line with 0 citations (no heat map)
- [ ] Line with 1 citation (light blue)
- [ ] Line with 10+ citations (capped at red/hot)
- [ ] Multiple consecutive cited lines (continuous heat map)

---

## Future Enhancements

### Possible Improvements

1. **Animation on load**: Fade-in effect for heat map colors
2. **Hover intensity boost**: Slight opacity increase on hover
3. **Citation preview**: Show excerpt of citing document in tooltip
4. **Heat map legend**: Small legend at top of sidebar explaining color scale
5. **Customizable thresholds**: Allow users to adjust citation count ranges

### Advanced Features

1. **Time-based heat map**: Show citation activity over time (trending)
2. **Department-based heat map**: Different colors for citations from different teams
3. **Stale citation highlighting**: Additional visual indicator for outdated citations
4. **Citation clustering**: Group adjacent cited lines into visual blocks

---

## Related Files

### Modified
- `frontend/apps/web/src/app/workspace/docs/components/LineNumberSidebar.tsx`

### Documentation
- `specs/016-docs-sys-basic-implementation/CITATION-VISIBILITY-DESIGN.md`
- `specs/016-docs-sys-basic-implementation/tasks.md` (T061d)
- `specs/016-docs-sys-basic-implementation/HEAT-MAP-IMPLEMENTATION.md` (this file)

---

## Rationale

### Why Heat Map Over Dots?

| Aspect | Dot Visualization | Heat Map Visualization |
|--------|-------------------|------------------------|
| **Information density** | Binary (cited or not) | Progressive (1, 3, 7+ citations) |
| **Clickable area** | 6px dot | Full line width |
| **Glanceability** | Requires counting dots | Color intensity shows density |
| **Cognitive load** | Must read tooltip for count | Color conveys meaning instantly |
| **Visual scalability** | Cluttered with many citations | Gracefully handles high density |
| **Semantic meaning** | "Is cited" | "How important is this?" |

### Design Principles Applied

1. **Progressive disclosure**: Basic info (color) → detailed info (tooltip)
2. **Visual hierarchy**: Warmer colors draw attention to "hot spots"
3. **Consistency**: Uses standard color scales (blue → red = cool → hot)
4. **Affordance**: Entire colored line suggests clickability
5. **Feedback**: Hover state confirms interactivity

---

## Conclusion

The heat map citation visualization transforms citation awareness from a binary indicator into a **density map** that highlights content importance. This aligns with the feature's goal: helping document owners understand not just *if* their content is cited, but *how much* their content is relied upon by others.

Warmer colors immediately draw attention to "critical sections" that are heavily referenced, enabling authors to make more informed editing decisions and reducing the risk of unintentionally breaking downstream dependencies.
