# Typing Indicator Enhancements - Implementation Summary

**Date**: November 7, 2025  
**Branch**: `012-user-status-and-notification-popup`

## Overview

Implemented two major enhancements to the typing indicator system:

1. **Thread Typing Indicators** - Support for typing indicators in thread/reply contexts
2. **Smart Throttling** - Aggregate display for crowded channels (3+ typers)

## Changes Made

### 1. Backend Changes

#### Proto Updates (`backend/rpc/v1/chat.proto`)
- Added optional `parent_message_id` field to `StartTypingRequest` and `StopTypingRequest`
- Enables separate typing state tracking for channels vs threads

```protobuf
message StartTypingRequest {
  string channel_id = 1;
  string parent_message_id = 2;  // Optional: for thread typing indicators
}

message StopTypingRequest {
  string channel_id = 1;
  string parent_message_id = 2;  // Optional: for thread typing indicators
}
```

#### Logic Layer (`backend/internal/chat/logic.go`)
- Updated `StartTyping` and `StopTyping` functions to include `parentMessageId` in action data
- Backend sends `parentMessageId` via SSE notification payload for proper routing
- Added debug logging for thread typing events

**Key Implementation:**
```go
actionData := map[string]string{
    "channelId":  channelID.String(),
    "action":     "start",
    "employeeId": employeeID.String(),
}
if req.ParentMessageId != "" {
    actionData["parentMessageId"] = req.ParentMessageId
}
```

### 2. Frontend Changes

#### API Wrappers (`frontend/packages/apis/src/chat.ts`)
- Updated `startTyping` and `stopTyping` to accept optional `parentMessageId` parameter
- Backwards compatible: existing calls without `parentMessageId` continue to work

```typescript
export async function startTyping(channelId: string, parentMessageId?: string): Promise<StartTypingResponse>
export async function stopTyping(channelId: string, parentMessageId?: string): Promise<StopTypingResponse>
```

#### SSE Event Handler (`frontend/apps/web/src/app/workspace/chat/hooks/useChatSSE.ts`)
- Extended `OnTypingEvent` type to include optional `parentMessageId`
- Updated event parser to extract `parentMessageId` from action data
- Routes typing events to appropriate channel or thread context

```typescript
export type OnTypingEvent = (data: {
    channelId: string;
    parentMessageId?: string; // Optional: for thread typing indicators
    userId: string;
    userName: string;
    isTyping: boolean;
}) => void;
```

#### Typing State Management (`frontend/apps/web/src/app/workspace/chat/page.tsx`)
- Changed typing state key format:
  - Channel typing: `channelId`
  - Thread typing: `thread:parentMessageId`
- Unified state cleanup logic handles both formats
- Passes thread-specific typing state to `ThreadView`

**Key Implementation:**
```typescript
const key = parentMessageId ? `thread:${parentMessageId}` : channelId;
setTypingUsers((prev) => ({
    ...prev,
    [key]: /* updated typing users */
}));
```

#### UI Component (`frontend/apps/web/src/app/workspace/chat/components/TypingIndicator.tsx`)
- **Smart Throttling**: Shows "3 people are typing..." for 3+ simultaneous typers
- Prevents noise in crowded channels
- Added support for both `channelId` and `parentMessageId` props

**Display Logic:**
```typescript
const displayText =
    names.length === 1
        ? `${names[0]} is typing...`
        : names.length === 2
            ? `${names[0]} and ${names[1]} are typing...`
            : `${names.length} people are typing...`; // Throttled for 3+ users
```

#### Thread View (`frontend/apps/web/src/app/workspace/chat/components/ThreadView.tsx`)
- Added `typingUsers` prop
- Displays typing indicator above reply composer
- Imported and rendered `TypingIndicator` component

#### Message Composer (`frontend/apps/web/src/app/workspace/chat/components/MessageComposer.tsx`)
- Added optional `parentMessageId` prop
- Passes `parentMessageId` to `startTyping`/`stopTyping` calls
- Automatic thread typing indicators when composing replies
- Cleanup on unmount sends proper thread context

## User Experience Improvements

### Before
- ❌ No typing indicators in threads
- ❌ Crowded channels show all typing users ("Alice, Bob, Charlie, Dave, Eve... are typing")
- ❌ Thread replies had no visual feedback when others typing

### After
- ✅ **Thread Typing Indicators**: See who's typing in thread you're viewing
- ✅ **Smart Throttling**: "5 people are typing..." instead of listing all names
- ✅ **Context-Aware**: Channel typing and thread typing tracked separately
- ✅ **Clean UI**: Reduced noise in busy channels while maintaining awareness

## Technical Benefits

1. **Backwards Compatible**: Existing channel typing still works without changes
2. **Minimal Overhead**: Reuses existing SSE infrastructure, no new connections
3. **Scalable**: Smart throttling prevents UI clutter in large teams
4. **Type-Safe**: Full TypeScript types for all new parameters
5. **Observability**: Debug logs track thread typing events

## Testing Recommendations

### Manual Testing Scenarios

1. **Channel Typing** (existing functionality)
   - Open channel
   - Start typing → Others see "{Your Name} is typing..."
   - Stop typing → Indicator disappears

2. **Thread Typing** (new feature)
   - Open thread
   - Start typing reply → Others viewing same thread see indicator
   - Others NOT viewing thread don't see indicator (correct routing)

3. **Smart Throttling** (new feature)
   - Get 3+ people typing in same channel
   - Verify shows "3 people are typing..." instead of all names
   - Verify works for both channels and threads

4. **Cleanup**
   - Type in thread, then close thread → Stop signal sent correctly
   - Switch between threads → Old typing state cleared

## Architecture Decisions

### Why Key Format `thread:parentMessageId`?

**Decision**: Use prefixed string key instead of nested object structure

**Rationale**:
- Simple flat state structure
- Easy to pass to child components
- Clear separation between channel and thread contexts
- Efficient lookups (O(1) key access)

**Alternative Considered**: Nested object `{ channels: {}, threads: {} }`
- Rejected: More complex state updates, harder to pass around

### Why Optional `parentMessageId` Instead of New RPCs?

**Decision**: Reuse existing `StartTyping`/`StopTyping` RPCs with optional field

**Rationale**:
- Backwards compatible with existing calls
- Single code path for typing logic (less duplication)
- Proto evolution best practice (optional fields)
- Simpler client code

**Alternative Considered**: New RPCs `StartThreadTyping`/`StopThreadTyping`
- Rejected: Duplicates 90% of logic, more maintenance burden

### Why Throttle at 3+ Instead of 5+ or 10+?

**Decision**: Show aggregate "X people are typing..." when 3+ simultaneous typers

**Rationale**:
- UX Research: "Alice and Bob are typing" is useful info
- UX Research: "Alice, Bob, Charlie, Dave, Eve..." creates visual noise
- 3 is the tipping point where individual names stop being valuable
- Prevents long strings that break UI layout

**Alternative Considered**: Throttle at 5+
- Rejected: "Alice, Bob, Charlie, Dave are typing..." still too noisy

## Future Enhancements

### Potential Improvements (Not Implemented)

1. **Active Channel Filtering**
   - Track `active_thread_id` in backend (similar to `active_channel_id`)
   - Only route thread typing to users actively viewing that specific thread
   - Requires: Backend schema change to `notification.active_connection`

2. **Typing User Avatars**
   - Show user avatars instead of/alongside names
   - Visual indicator (animated dots) next to typing users
   - Requires: Avatar URLs in typing event payload

3. **Typing Duration Tracking**
   - Show how long user has been typing ("Alice is typing for 2 minutes...")
   - Helpful for long-form responses
   - Requires: Timestamp in typing state

4. **Smart Grouping**
   - Group typing users by department/team
   - "3 people from Engineering are typing..."
   - Requires: Employee department data in context

## Files Changed

### Backend
- `backend/rpc/v1/chat.proto` - Added `parent_message_id` fields
- `backend/internal/chat/logic.go` - Updated typing handlers with thread support
- Generated proto files (via `buf generate`)

### Frontend
- `frontend/packages/apis/src/chat.ts` - Updated typing API wrappers
- `frontend/apps/web/src/app/workspace/chat/hooks/useChatSSE.ts` - Thread event routing
- `frontend/apps/web/src/app/workspace/chat/page.tsx` - State management with key format
- `frontend/apps/web/src/app/workspace/chat/components/TypingIndicator.tsx` - Smart throttling
- `frontend/apps/web/src/app/workspace/chat/components/ThreadView.tsx` - Display indicator
- `frontend/apps/web/src/app/workspace/chat/components/MessageComposer.tsx` - Thread typing signals

## Deployment Notes

- ✅ **Zero downtime deployment**: Backwards compatible, no schema changes
- ✅ **No database migrations**: Pure application logic changes
- ✅ **No feature flags needed**: Graceful degradation (old clients ignore `parentMessageId`)
- ⚠️ **Frontend rebuild required**: New RPC types need regeneration

## Conclusion

Successfully implemented thread typing indicators with smart throttling, improving UX for focused conversations (threads) while reducing noise in busy channels (3+ typers). Implementation is backwards compatible, type-safe, and follows existing patterns in the codebase.

**Status**: ✅ Ready for testing and deployment
