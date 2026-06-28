# LineNumberSidebar Variable-Height Content Alignment Fix

**Task**: T037c  
**Date**: 2025-12-22  
**Commit**: 7e1eabb

## Problem

The LineNumberSidebar was using fixed spacing (`lineHeight: 1.8` × line index) to position line numbers, but the actual content had variable heights due to:

1. **Embed nodes**: Take 100-200px but count as 1 line
2. **Headers**: H1/H2/H3 have larger font sizes and margins
3. **Code blocks**: Pre-formatted blocks with padding
4. **Lists**: Bullet/ordered lists with custom spacing

This caused line numbers to gradually fall behind the actual content as you scrolled down.

## Root Cause

The sidebar calculated positions using:
```typescript
position: `${(lineNumber - 1) * 1.8}rem`
```

This assumes all lines have identical height (1.8rem), which is false for rich content.

## Solution

### 1. DOM Measurement Approach

Instead of calculating positions, we now **measure** the actual positions of content blocks:

```typescript
const measurePositions = () => {
  const container = contentRef.current;
  const sidebarTop = sidebarRef.current.getBoundingClientRect().top;
  const blocks = container.querySelectorAll('p, h1, h2, h3, pre, blockquote, ul, ol, div[data-type="embed"]');
  
  blocks.forEach((block) => {
    const rect = block.getBoundingClientRect();
    const relativeTop = rect.top - sidebarTop;
    positions.push(relativeTop);
  });
};
```

### 2. Absolute Positioning

Line numbers are now positioned absolutely using measured offsets:

```typescript
<Box
  sx={{
    position: 'absolute',
    top: position, // Measured pixel value
    left: 0,
    right: 16,
  }}
>
  {lineNumber}
</Box>
```

### 3. Auto-Update on Changes

We use MutationObserver to detect content changes and re-measure:

```typescript
const observer = new MutationObserver(measurePositions);
observer.observe(contentRef.current, {
  childList: true,
  subtree: true,
  attributes: true,
});
```

### 4. Backward Compatibility

If no `contentRef` is provided, falls back to fixed spacing:

```typescript
if (!contentRef?.current) {
  const positions = Array.from({ length: lineCount }, (_, i) => i * 1.8);
  setLinePositions(positions);
  return;
}
```

## Implementation Details

### LineNumberSidebar Changes

**Props**:
- Added `contentRef?: React.RefObject<HTMLElement | null>` for content container reference

**State**:
- Added `linePositions: number[]` to store measured positions
- Added `sidebarRef` to measure sidebar position

**Effects**:
- `useEffect` to measure positions on mount and content changes
- MutationObserver to detect DOM changes
- Window resize listener to recalculate on viewport changes

### DocumentEditor Changes

**Refs Added**:
```typescript
const viewContentRef = useRef<HTMLDivElement>(null);       // View mode
const editorContentRef = useRef<HTMLDivElement>(null);     // WYSIWYG edit mode
const markdownContentRef = useRef<HTMLDivElement>(null);   // Markdown mode
```

**Sidebar Integration**:
```tsx
<LineNumberSidebar
  content={sidebarPlainText}
  documentSlug={document.slug}
  contentRef={viewContentRef} // Pass appropriate ref
/>
```

### TypeScript Improvements

**Added TipTapNode Interface**:
```typescript
interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  [key: string]: unknown;
}
```

**Fixed Type Violations**:
- Replaced `any` with `TipTapNode` in JSON processing
- Added proper type assertions for editor content
- Fixed contentRef type to accept `HTMLElement | null`

### EmbeddedSection Changes

**Margin Adjustments**:
```tsx
sx={{
  my: 0,        // Remove vertical margin
  mb: 1.8,      // Match lineHeight for consistent spacing
}}
```

This ensures embed blocks don't add extra spacing that would throw off alignment.

## Testing

### Build Verification
✅ `pnpm --filter web build` passes with no TypeScript errors

### Visual Verification Required
- [ ] View mode: Line numbers align with paragraph starts
- [ ] WYSIWYG edit mode: Line numbers align with editor blocks
- [ ] Markdown mode: Line numbers align with textarea lines
- [ ] Embeds: Line number for embed aligns with top of embed box
- [ ] Headers: Line numbers align with header text start
- [ ] Resize: Line numbers reposition on window resize
- [ ] Content changes: Line numbers update when editing

## Known Limitations

1. **Performance**: MutationObserver may cause lag on very large documents (>1000 blocks)
2. **Block Mapping**: Assumes 1 line = 1 block element, which may not hold for wrapped paragraphs
3. **Markdown Mode**: Uses TextField ref which doesn't have block elements (falls back to fixed spacing)

## Future Improvements

1. **Debounce measurements**: Add 100ms debounce to reduce re-calculations
2. **Virtual scrolling**: Only render visible line numbers for large documents
3. **Markdown block detection**: Parse markdown to detect actual blocks instead of using line count
4. **ResizeObserver**: Use ResizeObserver for individual blocks instead of global MutationObserver

## Related Issues

- T037a: Fixed line extraction double-break bug
- T037b: Fixed font size and URL generation
- T037c: This fix (variable-height alignment)

## References

- [TipTap Editor Documentation](https://tiptap.dev/)
- [MutationObserver MDN](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)
- [ResizeObserver MDN](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver)
