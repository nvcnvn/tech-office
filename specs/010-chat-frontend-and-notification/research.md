# Research Document: Chat Frontend and Notification Integration

**Feature**: 010-chat-frontend-and-notification  
**Date**: 2025-10-29  
**Status**: Complete

## Summary

This document captures research findings and technical decisions for implementing the chat frontend with notification integration. All NEEDS CLARIFICATION items from the plan have been resolved.

---

## 1. WYSIWYG Markdown Editor Selection

**Decision**: Use **TipTap** (ProseMirror-based) for message composition

**Rationale**:
- Excellent React integration with `@tiptap/react` package
- Built-in Markdown support via `@tiptap/starter-kit` and `@tiptap/extension-markdown`
- Extensible architecture for @mentions via `@tiptap/extension-mention`
- ~60KB gzipped (acceptable for chat-heavy application)
- Active development by core ProseMirror team
- Supports both short messages (inline) and long-form (full editor)
- Great TypeScript support
- Mobile-responsive out of the box

**Alternatives Considered**:
- **Lexical**: More modern but less mature ecosystem, larger bundle (~80KB), fewer Markdown extensions
- **Slate**: Fully customizable but requires more boilerplate, steeper learning curve
- **SimpleMDE**: Lightweight (~40KB) but pure Markdown textarea, no WYSIWYG, limited @mention support

**Integration Plan**:
```typescript
// packages/chat-editor (new package)
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import Markdown from '@tiptap/extension-markdown'

const MessageComposer = () => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      Mention.configure({
        suggestion: mentionSuggestionOptions, // Autocomplete channel members
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      // Get Markdown output
      const markdown = editor.storage.markdown.getMarkdown()
    },
  })
  
  return <EditorContent editor={editor} />
}
```

**Dependencies**:
```json
{
  "@tiptap/react": "^2.1.13",
  "@tiptap/starter-kit": "^2.1.13",
  "@tiptap/extension-markdown": "^2.1.13",
  "@tiptap/extension-mention": "^2.1.13",
  "@tiptap/pm": "^2.1.13"
}
```

**Migration Notes**: None (new feature)

---

## 2. Virtual Scrolling Library

**Decision**: Use **react-virtuoso** for message list rendering

**Rationale**:
- Native support for **reverse scrolling** (chat messages render bottom-up)
- Automatic handling of dynamic item heights (messages vary in size)
- Built-in "scroll to bottom" on new message with `followOutput` prop
- "Load more" at top when scrolling up via `startReached` callback
- Excellent integration with React Query for infinite scroll
- ~20KB gzipped (lightweight)
- Active maintenance and excellent documentation
- Better UX than react-window for chat use case

**Alternatives Considered**:
- **react-window**: Lightweight (~8KB) but requires custom reverse scroll logic, no dynamic heights
- **TanStack Virtual**: Modern and flexible but requires more boilerplate for reverse scroll

**Integration Plan**:
```typescript
import { Virtuoso } from 'react-virtuoso'
import { useInfiniteQuery } from '@tanstack/react-query'

const MessageList = ({ channelId }) => {
  const {
    data,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ['messages', channelId],
    queryFn: ({ pageParam }) => fetchMessages(channelId, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextPageToken,
  })

  const messages = data?.pages.flatMap(p => p.messages) ?? []

  return (
    <Virtuoso
      data={messages}
      firstItemIndex={10000 - messages.length} // Reverse indexing
      initialTopMostItemIndex={messages.length - 1} // Start at bottom
      followOutput="smooth" // Auto-scroll on new messages
      startReached={() => {
        if (hasNextPage) fetchNextPage()
      }}
      itemContent={(index, message) => (
        <MessageItem message={message} />
      )}
    />
  )
}
```

**Dependencies**:
```json
{
  "react-virtuoso": "^4.6.2"
}
```

**Migration Notes**: None (new feature)

---

## 3. SSE Chat Event Schema

**Decision**: Extend existing `NotificationEvent` using `action_data` map for chat events

**Rationale**:
- Reuses existing SSE infrastructure from notification hub (#007)
- Single SSE connection for all real-time events (efficient)
- `action_data` map supports arbitrary key-value pairs (verified in notification.proto)
- Backend already publishes notifications with action_data
- Frontend already handles NotificationEvent in workspace layout
- No proto changes needed for event delivery

**Event Type Mapping**:
Use `source_domain = "chat"` and `notification_type` to distinguish chat events:

| Event Type | notification_type | action_data Keys | Purpose |
|------------|------------------|------------------|---------|
| New Message | `message` | `channelId`, `messageId` | New message in channel |
| Reply | `reply` | `channelId`, `messageId`, `parentMessageId` | Reply to message |
| Mention | `mention` | `channelId`, `messageId`, `action=view_message` | @mention in message |
| Reaction | `reaction` | `channelId`, `messageId`, `emoji` | Reaction added |
| Typing | `typing` | `channelId`, `employeeId`, `employeeName` | User typing (ephemeral) |

**Integration Plan**:
```typescript
// Frontend: Extend useSSEConnection to handle chat events
const { events } = useSSEConnection({
  onNotification: (event) => {
    if (event.source_domain === 'chat') {
      switch (event.notification_type) {
        case 'message':
        case 'reply':
          // Refetch messages for channel
          queryClient.invalidateQueries(['messages', event.action_data.channelId])
          break
        case 'mention':
          // Show notification + add to notification list
          break
        case 'typing':
          // Update typing indicator state (ephemeral, don't persist)
          break
      }
    }
  }
})
```

**Backend Changes**:
```go
// In chat/logic.go SendMessage method
// Parse @mentions from message text
mentions := parseMentions(req.MessageText)
for _, mentionedEmployeeID := range mentions {
  s.NotificationLogic.PublishNotification(ctx, tx, &notification.PublishNotificationParams{
    OrganizationID: orgID,
    RecipientEmployeeIDs: []dbuuid.UUID{mentionedEmployeeID},
    SourceDomain: "chat",
    NotificationType: "mention",
    Title: fmt.Sprintf("%s mentioned you in #%s", authorName, channelSlug),
    Message: truncate(req.MessageText, 200),
    ActionData: map[string]string{
      "channelId": channelID.String(),
      "messageId": messageID.String(),
      "action": "view_message",
    },
    Priority: 1, // Notify when not offline
  })
}
```

**Migration Notes**: No breaking changes; extends existing notification infrastructure

---

## 4. Unread Message Tracking

**Decision**: Hybrid approach - server persists `last_viewed_message_id` in `channel_membership`, client caches

**Rationale**:
- Multi-device sync requires server-side persistence
- Client-side caching prevents unnecessary DB queries
- Optimistic updates provide instant feedback
- "Mark as read" on channel view is standard UX
- Efficient query: COUNT messages WHERE created_at > last_viewed_at

**Schema Changes**:
```sql
-- Extend chat.channel_membership table
ALTER TABLE chat.channel_membership
ADD COLUMN last_viewed_message_id UUID REFERENCES chat.message(id),
ADD COLUMN last_viewed_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX idx_channel_membership_last_viewed 
ON chat.channel_membership(employee_id, organization_id, last_viewed_at);
```

**API Design**:
```protobuf
// Add to chat.proto
rpc MarkChannelAsRead(MarkChannelAsReadRequest) returns (MarkChannelAsReadResponse);

message MarkChannelAsReadRequest {
  string channel_id = 1;
  string last_read_message_id = 2; // Optional: specific message to mark as read up to
}

message MarkChannelAsReadResponse {
  int32 unread_count = 1; // Remaining unread count for this channel
}
```

**Integration Plan**:
```typescript
// Client-side: Call MarkChannelAsRead when user views channel
useEffect(() => {
  if (lastMessageId && isChannelVisible) {
    markChannelAsRead({ channelId, lastReadMessageId: lastMessageId })
  }
}, [channelId, lastMessageId, isChannelVisible])

// Server-side: Update channel_membership on read
func (s *chatLogicImpl) MarkChannelAsRead(ctx, tx, orgID, employeeID, channelID, messageID) {
  err := s.Queries.UpdateChannelMembershipLastViewed(ctx, tx, &database.UpdateParams{
    OrganizationID: orgID,
    EmployeeID: employeeID,
    ChannelID: channelID,
    LastViewedMessageID: messageID,
    LastViewedAt: time.Now(),
  })
}
```

**Migration Notes**: Requires Atlas migration for schema change

---

## 5. Mention Detection & Navigation

**Decision**: Use regex `@(\w+)` for mention parsing, validate against organization.employee usernames

**Rationale**:
- Simple regex is fast and sufficient for MVP
- Username validation ensures mentions are valid
- TipTap Mention extension handles autocomplete UI
- Backend notification integration provides click-to-message navigation

**Mention Syntax**: `@username` only (no @channel, @here for MVP)

**Components**:

**Backend Parsing**:
```go
// backend/internal/chat/helpers.go
func parseMentions(messageText string) []string {
  re := regexp.MustCompile(`@(\w+)`)
  matches := re.FindAllStringSubmatch(messageText, -1)
  var usernames []string
  for _, match := range matches {
    if len(match) > 1 {
      usernames = append(usernames, match[1])
    }
  }
  return usernames
}

// Validate and resolve to employee IDs
func (s *chatLogicImpl) validateMentions(ctx, tx, orgID, channelID, usernames) ([]dbuuid.UUID, error) {
  // Query organization.employee WHERE username IN (usernames) AND organization_id = orgID
  // Check if mentioned users are channel members
  // Return employee UUIDs
}
```

**Frontend Autocomplete**:
```typescript
// Use TipTap Mention extension with channel member suggestions
const mentionSuggestion = {
  items: async ({ query }) => {
    const members = await fetchChannelMembers(channelId)
    return members
      .filter(m => m.username.toLowerCase().startsWith(query.toLowerCase()))
      .slice(0, 5)
  },
  render: () => {
    let component: MentionList
    return {
      onStart: (props) => {
        component = new MentionList({
          props,
          editor: props.editor,
        })
      },
      onUpdate(props) {
        component.updateProps(props)
      },
      onExit() {
        component.destroy()
      },
    }
  },
}
```

**Navigation from Notification**:
```typescript
// Handle notification click
const handleNotificationClick = (notification) => {
  if (notification.source_domain === 'chat' && notification.action_data.action === 'view_message') {
    router.push(`/workspace/chat?channel=${notification.action_data.channelId}&message=${notification.action_data.messageId}`)
  }
}
```

**Migration Notes**: None (new feature)

---

## 6. Thread View Auto-Open/Close Logic

**Decision**: Auto-open on reply click, auto-close on channel switch or Escape

**UX Rules**:
- **Auto-open triggers**:
  * User clicks "Reply" button on message → Open thread with that message as parent
  * User clicks reply count badge → Open thread with that message as parent
- **Auto-close triggers**:
  * User switches to different channel
  * User presses Escape key
- **Manual close only**:
  * X button on thread panel header
  * Click outside thread DOES NOT close (requires explicit action)
- **Preserve on send**:
  * Sending new message in channel does NOT close thread
  * Allows user to continue browsing channel while thread is open

**Mobile Behavior**:
- Thread view replaces message list (full-width modal)
- Back button closes thread and returns to message list

**Implementation**:
```typescript
const [threadState, setThreadState] = useState<{
  isOpen: boolean
  parentMessageId: string | null
}>({ isOpen: false, parentMessageId: null })

// Auto-open on reply click
const handleReplyClick = (messageId: string) => {
  setThreadState({ isOpen: true, parentMessageId: messageId })
}

// Auto-close on channel switch
useEffect(() => {
  setThreadState({ isOpen: false, parentMessageId: null })
}, [channelId])

// Auto-close on Escape
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && threadState.isOpen) {
      setThreadState({ isOpen: false, parentMessageId: null })
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [threadState.isOpen])
```

**Migration Notes**: None (new feature)

---

## 7. Typing Indicator Debouncing

**Decision**: Client debounces with 3s delay, server auto-expires after 5s (in-memory for MVP)

**Rationale**:
- 3s debounce prevents excessive RPC calls
- 5s server expiry handles disconnects gracefully (no explicit stop needed)
- In-memory state is sufficient for MVP (Redis for production scale)
- SSE broadcasts only to channel members (efficient)

**Client Implementation**:
```typescript
const useTypingIndicator = (channelId: string) => {
  const lastSentRef = useRef<number>(0)
  const timeoutRef = useRef<NodeJS.Timeout>()

  const startTyping = useCallback(() => {
    const now = Date.now()
    // Only send if 3s has passed since last send
    if (now - lastSentRef.current > 3000) {
      startTypingRPC({ channelId })
      lastSentRef.current = now
    }

    // Schedule stop after 5s idle
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      stopTypingRPC({ channelId })
      lastSentRef.current = 0
    }, 5000)
  }, [channelId])

  return { startTyping }
}
```

**Backend Implementation**:
```go
// Ephemeral in-memory state (for MVP)
type TypingIndicator struct {
  ChannelID    dbuuid.UUID
  EmployeeID   dbuuid.UUID
  EmployeeName string
  ExpiresAt    time.Time
}

var typingIndicators = make(map[string]*TypingIndicator)
var typingMutex sync.RWMutex

func (s *chatLogicImpl) StartTyping(ctx, tx, orgID, employeeID, channelID) {
  key := fmt.Sprintf("%s:%s", channelID, employeeID)
  typingMutex.Lock()
  typingIndicators[key] = &TypingIndicator{
    ChannelID: channelID,
    EmployeeID: employeeID,
    EmployeeName: employeeName,
    ExpiresAt: time.Now().Add(5 * time.Second),
  }
  typingMutex.Unlock()

  // Broadcast via notification hub
  s.NotificationLogic.PublishNotification(ctx, tx, &notification.PublishParams{
    OrganizationID: orgID,
    ChannelID: channelID, // Broadcast to channel members
    SourceDomain: "chat",
    NotificationType: "typing",
    ActionData: map[string]string{
      "channelId": channelID.String(),
      "employeeId": employeeID.String(),
      "employeeName": employeeName,
    },
    Priority: 2, // Online only (ephemeral)
  })
}

// Background goroutine cleans up expired indicators every 1s
func cleanupExpiredTypingIndicators() {
  ticker := time.NewTicker(1 * time.Second)
  for range ticker.C {
    now := time.Now()
    typingMutex.Lock()
    for key, indicator := range typingIndicators {
      if now.After(indicator.ExpiresAt) {
        delete(typingIndicators, key)
      }
    }
    typingMutex.Unlock()
  }
}
```

**Migration Notes**: Production deployment should migrate to Redis for multi-instance support

---

## 8. Emoji Reaction Picker

**Decision**: Use native browser emoji picker for MVP (system emoji picker)

**Rationale**:
- Zero bundle size impact
- OS-native UX (familiar to users)
- No maintenance overhead
- Sufficient for MVP
- Can upgrade to emoji-mart in v2 if custom emoji support needed

**Implementation**:
```typescript
// Use native emoji input with contentEditable
<input
  type="text"
  inputMode="text"
  placeholder="React with emoji..."
  onKeyDown={(e) => {
    if (e.key === 'Enter') {
      addReaction({ messageId, emoji: e.currentTarget.value })
      e.currentTarget.value = ''
    }
  }}
/>

// Alternative: Use emoji-mart for richer UX (evaluate in v2)
```

**Migration Notes**: Consider emoji-mart (~100KB) for v2 if users request:
- Recently used emojis
- Search functionality
- Custom emoji support
- Category browsing

---

## 9. Existing Tech Office Patterns

**Workspace Layout Pattern**:
- File: `frontend/apps/web/src/app/workspace/layout.tsx`
- Pattern: Single shared layout for all business features
- Top nav: 56px fixed height with tab navigation
- Domain tabs: Added to `tabs` array with emoji, label, path, shortcut
- Auth: `useRequireAuth()` hook handles authentication state
- SSE: Managed in layout, passed down via context

**Sidebar Pattern**:
- File: `frontend/apps/web/src/app/workspace/organization/components/`
- Pattern: 256px fixed-width sidebar with list items, search, and action buttons
- Scrollable content area with virtual scrolling for large lists
- Unread badges on list items

**API Client Pattern**:
- File: `frontend/packages/apis/src/organization.ts`
- Pattern: Import generated RPC client, wrap with type assertions, export typed functions
```typescript
import { createClient } from 'rpc'
import type { OrganizationService } from 'rpc'

const client = createClient<OrganizationService>()

export const listEmployees = async (orgId: string) => {
  const response = await client.listEmployees({ organizationId: orgId })
  return response as ListEmployeesResponse // Type assertion
}
```

**SSE Integration Pattern**:
- File: `frontend/packages/notifications/src/useSSEConnection.ts`
- Pattern: Single SSE connection managed in workspace layout
- Automatic reconnection with exponential backoff
- Proactive 5-minute disconnect/reconnect for load balancing
- Events dispatched to subscribers via callbacks

**Material-UI Theme**:
- Primary color: Indigo (#4F46E5)
- Secondary color: Pink (#EC4899)
- Spacing: 4px base unit (gap-4 = 16px)
- Typography: Inter font, text-sm (14px) for body
- Components: Use MUI's built-in components (Box, Stack, Typography, Button, etc.)

---

## 10. Backend Notification Integration

**NotificationLogic Interface** (verified in backend/internal/notification/logic.go):
```go
type NotificationLogic interface {
  PublishNotification(
    ctx context.Context,
    tx database.DBTX,
    orgID dbuuid.UUID,
    params *PublishNotificationParams,
  ) (notificationID dbuuid.UUID, recipientCount int32, err error)
}

type PublishNotificationParams struct {
  RecipientEmployeeIDs []dbuuid.UUID // Direct employee list
  RecipientDepartmentIDs []dbuuid.UUID // Department list (resolved to employees)
  SourceDomain string // "chat", "crm", "projects", etc.
  NotificationType string // "message", "mention", "reply", etc.
  Title string
  Message string
  ActionData map[string]string // Arbitrary key-value pairs for deep linking
  ActionCategory string // For deduplication (optional)
  Priority int32 // 0=always, 1=not offline (default), 2=online only, 4=silent
  PublishingServiceID string // Backend service identifier
}
```

**Integration Points for Chat**:
1. **@Mentions**: Call PublishNotification in SendMessage/ReplyToMessage after parsing mentions
2. **Replies**: Call PublishNotification to notify parent message author
3. **Priority**: Use priority=1 (notify when not offline) for mentions and replies
4. **ActionData**: Include `channelId`, `messageId`, `action=view_message` for navigation

**Verified**: action_data map in notification.proto supports arbitrary key-value pairs ✅

---

## 11. Database Query Patterns

**Existing Chat Queries** (verified in backend/database/scripts/chat.query.sql):
- All queries include `organization_id` filter ✅
- Use `-- name: MethodName :one/:many/:exec` for sqlc generation ✅
- Use pgx placeholders: `$1, $2, $3` for parameters ✅
- JOIN with organization.employee for author names ✅

**New Queries Needed**:
```sql
-- name: GetMessageByIdWithChannel :one
-- Get message by ID with channel context for validation and navigation
SELECT 
  m.*,
  e.email as author_email,
  e.full_name as author_name,
  c.title_slug as channel_slug,
  c.display_name as channel_display_name
FROM chat.message m
JOIN organization.employee e ON e.id = m.author_employee_id AND e.organization_id = m.organization_id
JOIN chat.channel c ON c.id = m.channel_id AND c.organization_id = m.organization_id
WHERE m.id = $1 
  AND m.organization_id = $2
  AND m.deleted_at IS NULL;

-- name: UpdateChannelMembershipLastViewed :exec
-- Update last viewed message and timestamp for unread tracking
UPDATE chat.channel_membership
SET 
  last_viewed_message_id = $1,
  last_viewed_at = NOW()
WHERE employee_id = $2
  AND channel_id = $3
  AND organization_id = $4;

-- name: GetEmployeesByUsernames :many
-- Resolve usernames to employee IDs for mention validation
SELECT id, username, full_name, email
FROM organization.employee
WHERE username = ANY($1::text[])
  AND organization_id = $2
  AND deleted_at IS NULL;

-- name: CheckChannelMembership :one
-- Validate if employee is member of channel
SELECT EXISTS(
  SELECT 1 FROM chat.channel_membership
  WHERE employee_id = $1
    AND channel_id = $2
    AND organization_id = $3
) as is_member;
```

---

## Summary of Decisions

| Decision Area | Choice | Rationale |
|--------------|--------|-----------|
| Markdown Editor | TipTap | Best React integration, Markdown support, @mention extensibility |
| Virtual Scroll | react-virtuoso | Native reverse scroll, dynamic heights, excellent DX |
| SSE Events | Extend NotificationEvent | Reuse infrastructure, single connection, efficient |
| Unread Tracking | Hybrid (server persist + client cache) | Multi-device sync + instant UX |
| Mentions | Regex `@(\w+)` + validation | Simple, fast, sufficient for MVP |
| Thread UX | Auto-open on reply, auto-close on channel switch | Intuitive, non-intrusive |
| Typing Indicators | 3s debounce + 5s expire | Efficient, graceful disconnects |
| Emoji Picker | Native browser picker | Zero bundle size, sufficient for MVP |

**All research items resolved. Ready for Phase 1 design.**
