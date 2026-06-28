# Chat Integration in Task Detail Page

**Feature**: 017-realtime-task-collaboration-system (T150)  
**Date**: 2024-12-27

## Overview

This document describes the integration of chat components into the task detail page, enabling real-time collaboration on tasks through comments, file attachments, and threaded discussions.

## Implementation Summary

### Components Reused from Chat Domain

1. **MessageList** (`/workspace/chat/components/MessageList.tsx`)
   - Displays all messages in the task's associated chat channel
   - Supports virtual scrolling for performance with large message lists
   - Handles message reactions, edits, and deletions
   - Provides threaded reply functionality
   - Shows typing indicators (can be enhanced with SSE later)

2. **MessageComposer** (`/workspace/chat/components/MessageComposer.tsx`)
   - WYSIWYG editor with rich text formatting (Bold, Italic, Underline, Lists, Code, Links)
   - @mention autocomplete for employees and departments
   - Emoji picker integration
   - File attachment support via ChatFileUpload
   - Auto-resizing editor (up to 50% viewport height)
   - Keyboard shortcuts (Enter to send, Shift+Enter for newline)

3. **ChatFileUpload** (`/workspace/chat/components/ChatFileUpload.tsx`)
   - Simple file upload component using requestChannelFileUpload API
   - Direct R2 upload with progress tracking
   - Validation and security checks
   - Supports multiple file uploads

### Integration Points

#### Task → Chat Channel Mapping

- Each task has a `channelId` field linking to its associated chat channel
- Channel is auto-created during task creation with `channel_type=project_ticket_thread`
- Channel members are automatically managed (reporter, assignees, watchers)

#### File Attachments

- Task has `fileIds` array storing attached file UUIDs
- Files uploaded via MessageComposer are added to the channel and task
- Files are displayed in the "Attachments" section with metadata
- Access control handled via `files.file_access_rule` with `context_type='project'`

### Page Structure

```
Task Detail Page
├── Breadcrumbs (Projects > Project Name > Task ID)
├── Main Content Area (66% width)
│   ├── Task Header (ID, Level chip)
│   ├── Title (inline editable)
│   ├── Description (DocumentEditor from docs domain)
│   ├── Comments Section ← Chat Integration
│   │   └── MessageList (reused from chat)
│   │       ├── Message history with reactions
│   │       ├── Typing indicators
│   │       └── MessageComposer (with file upload)
│   ├── Attachments Section
│   │   └── List of fileIds from task.fileIds
│   └── Subtasks Section
└── Sidebar (33% width)
    ├── Actions (Watch/Unwatch, Delete)
    ├── Status dropdown
    ├── Dates (Start, Due)
    ├── Assignees
    └── Metadata (Reporter, Created, Updated)
```

## Features

### Comments Section

- ✅ Real-time message display with auto-scroll
- ✅ Rich text formatting (Bold, Italic, Underline, Lists, Code blocks, Links)
- ✅ @mentions for employees and departments
- ✅ Emoji reactions on messages
- ✅ File attachments with drag-and-drop
- ✅ Threaded replies (click reply on any message)
- ✅ Message editing and deletion
- ⏳ Typing indicators (structure in place, SSE integration pending)
- ⏳ Read receipts (future enhancement)

### Attachments Section

- ✅ Display list of attached files with IDs
- ⏳ File preview modal (future enhancement)
- ⏳ Download file functionality (future enhancement)
- ⏳ Delete attachment (future enhancement)

## Architecture Alignment

### Constitution Compliance

- ✅ **Cross-Domain Integration**: Uses Chat domain via logic layer interfaces
- ✅ **Component Reuse**: No duplication - MessageList, MessageComposer reused as-is
- ✅ **Two-Layer Architecture**: Task creation auto-creates channel via ChatLogic
- ✅ **Multi-Tenancy**: All queries include `organization_id` filters
- ✅ **Proto-Level Authorization**: Channel access enforced via membership

### Benefits of Reuse

1. **Consistency**: Task comments behave identically to regular chat channels
2. **Maintainability**: Bug fixes in chat components automatically apply to tasks
3. **Feature Parity**: All chat features (reactions, threads, files) work in tasks
4. **Performance**: Virtualized scrolling handles large message lists efficiently
5. **Developer Experience**: Familiar component API, easy to extend

## Future Enhancements

### Typing Indicators

To enable real-time typing indicators, integrate SSE notifications:

```tsx
import { useSSENotifications } from '@/lib/sse/useSSENotifications';

const { typingUsers } = useSSENotifications();

<MessageList
  channelId={task.channelId}
  typingUsers={typingUsers[task.channelId] || []}
  ...
/>
```

### File Preview

Integrate FilePreviewModal from chat components:

```tsx
import FilePreviewModal from '@/app/workspace/chat/components/FilePreviewModal';

const [previewFileId, setPreviewFileId] = useState<string | null>(null);

<FilePreviewModal
  open={!!previewFileId}
  fileId={previewFileId}
  onClose={() => setPreviewFileId(null)}
/>
```

### Activity Feed

Combine chat messages with task update events (state changes, assignments) in a unified activity feed.

## Testing

### Manual Testing Checklist

- [ ] Send message in task comments → appears in real-time
- [ ] Upload file via MessageComposer → appears in Attachments section
- [ ] @mention employee → notification sent, mention highlighted
- [ ] React to message → reaction count updates
- [ ] Reply to message → thread view opens
- [ ] Edit message → changes reflected immediately
- [ ] Delete message → marked as deleted with placeholder
- [ ] Scroll up in long message list → load more messages
- [ ] Multiple users typing → typing indicator shows names

### Integration Test Scenarios

See `backend/integration/collaboration_task_test.go`:
- `TestCreateTask_WithIntegrations` - verifies channel auto-creation
- Task comments use regular chat test suite (no separate tests needed)

## Performance Considerations

- **Virtual Scrolling**: MessageList uses VirtualizedMessageList for 1000+ messages
- **Lazy Loading**: Messages loaded in pages of 50 (configurable)
- **Optimistic Updates**: Message reactions update UI before API confirmation
- **Debounced Typing**: Typing indicators debounced at 3 seconds
- **Fixed Height**: Chat area has fixed 500px height to prevent layout shifts

## Known Limitations

1. **Typing Indicators**: Currently disabled (pass empty array). Requires SSE integration.
2. **File Metadata**: Attachments section shows file IDs only. File metadata fetching not implemented yet.
3. **Thread View**: Thread modal not integrated in task page (future enhancement).

## Related Documentation

- Chat Components: `/frontend/apps/web/src/app/workspace/chat/components/`
- Chat Integration Test: `/backend/integration/chat_mentions_test.go`
- Files Architecture: `/backend/docs/FILE-WORKFLOWS-ARCHITECTURE.md`
- Task Creation: `/backend/docs/TASK-CREATION-FIX.md`

---

*Last Updated: 2024-12-27*
