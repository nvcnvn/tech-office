# Feature Specification: Chat Backend System

**Feature Branch**: `009-chat-backend`  
**Created**: October 29, 2025  
**Status**: Draft  
**Input**: User description: "chat backend - I want to design the backend system for chat service that later on can be reuse at other part of the system, for example project ticket comment will leverage part of this chat system. This chat system will leverage notification hub backend. The system will operate similar to Slack. Starting with a 'Channel', the place where a group of people can join (or get invited) to chat. Channel can be private (invite only) or public (everyone can find and join). channel will have title (url friendly) and description. Then people can send 'Message' to Channel. People can reply to a message, but we should only allow 1 layer of reply. People can also react to a Message."

## Execution Flow (main)
```
1. Parse user description from Input ✓
   → Feature description provided: chat backend system
2. Extract key concepts from description ✓
   → Actors: employees, channel members, channel creators
   → Actions: create channels, join channels, send messages, reply to messages (1 level), react to messages, invite users
   → Data: channels, messages, replies, reactions, memberships
   → Constraints: single-layer reply depth, reusable for project comments, integrates with notification hub, Slack-like UX
3. For each unclear aspect: ✓
   → Users can leave channels after joining: YES
   → Channel admins can remove members: YES (multiple admins model)
   → Channels can be archived: YES (no deletion, archived prevents new messages/notifications)
   → Message editing/deletion: YES (both supported)
   → Channel title: 64 characters max, alphanumeric and hyphen only
   → Search functionality: YES (deferred to dedicated search feature)
   → Read receipts: NO, Typing indicators: YES
   → File attachments: YES (deferred to dedicated S3-compatible file upload feature with Cloudflare R2)
   → Per-channel notification preferences (mute): YES
   → Direct messages: YES (treated as special 2-person private channels)
   → Channel ownership: Multiple admins (no single owner limitation)
   → Maximum members per channel: No limit
   → Channel visibility conversion: YES (private ↔ public)
   → Notification triggers: Configurable per channel (all messages / mentions only / muted)
4. Fill User Scenarios & Testing section ✓
5. Generate Functional Requirements ✓
6. Identify Key Entities ✓
7. Run Review Checklist ✓
   → All clarifications resolved
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
As an employee in Tech Office, I need a channel-based chat system where I can communicate with colleagues in organized spaces (channels), send messages, reply to specific messages (one level deep), and react to messages with emoji, similar to Slack. Channels can be public (discoverable and joinable by anyone) or private (invite-only), and the same underlying system should be reusable for project ticket comments and other collaborative features.

### Acceptance Scenarios

**Channel Management**

1. **Given** an employee wants to create a communication space, **When** they create a new channel with a title and description, **Then** the channel is created and they become a member with ability to invite others

2. **Given** a public channel exists, **When** any employee searches for or discovers the channel, **Then** they can join the channel without requiring an invitation

3. **Given** a private channel exists, **When** a non-member employee tries to access it, **Then** they cannot see or join the channel unless invited by an existing member

4. **Given** an employee is a member of a channel, **When** they invite another employee to the channel, **Then** the invited employee receives a notification and can access the channel

5. **Given** an employee has joined multiple channels, **When** they view their channel list, **Then** they see all public and private channels they're a member of, organized clearly

**Messaging**

6. **Given** an employee is a member of a channel, **When** they post a message to the channel, **Then** all channel members receive the message in real-time and get notified via the notification hub

7. **Given** a message exists in a channel, **When** another member replies to that message, **Then** the reply is visually associated with the parent message (threaded conversation, 1 level only)

8. **Given** a message already has a reply, **When** another member tries to reply to that reply, **Then** the system prevents nested replies deeper than 1 level (reply to reply is not allowed)

9. **Given** a message exists in a channel, **When** a member reacts to the message with an emoji, **Then** the reaction appears on the message visible to all members

10. **Given** multiple members react to the same message with the same emoji, **When** viewing the message, **Then** the reaction shows a count of how many members used that emoji

**Notifications & Real-Time**

11. **Given** an employee is online and a new message is posted to their channel, **When** they are viewing a different channel or page, **Then** they receive a real-time notification via the notification hub

12. **Given** an employee is mentioned in a message (e.g., @username), **When** the message is sent, **Then** they receive a high-priority notification regardless of their current location in the app

13. **Given** an employee replies to another member's message, **When** the reply is posted, **Then** the original message author receives a notification about the reply

**Reusability for Other Features**

14. **Given** the chat backend system is implemented, **When** the project management feature needs comment functionality, **Then** it can reuse the message and reply components from the chat system with minimal modification

15. **Given** the chat backend supports channels and messages, **When** project tickets need threaded discussions, **Then** a project ticket can be treated as a specialized private channel with the same messaging capabilities

### Edge Cases

- What happens when a channel has no members? → Channel remains accessible to inviting new members or may be auto-archived after inactivity period
- What happens when someone deletes a message that has replies? → Keep replies with "original message deleted" placeholder to maintain conversation context
- What happens when someone deletes a message that has reactions? → Reactions are deleted along with the message
- What happens when a user is removed from a channel? → User loses access immediately; historical messages remain visible to other members with author attribution intact
- What happens when a channel admin leaves the organization? → Multiple admin model ensures continuity; if all admins leave, oldest remaining member promoted to admin
- What happens when hundreds of people react to a single message? → System aggregates reactions by type with counts, displaying most popular reactions prominently
- What happens when a channel title conflicts with an existing channel? → System prevents duplicate channel titles within same organization (enforce uniqueness on URL-friendly slug)
- What happens when someone tries to send a message to a channel they're not a member of? → System rejects the message with appropriate error
- What happens when a channel has thousands of messages? → System implements pagination and lazy loading for message history
- What happens when a user creates too many channels (abuse)? → Rate limiting applied per organization configuration (defer specific limits to implementation)
- What happens when someone reacts with the same emoji multiple times? → System treats it as toggle (remove existing reaction, don't duplicate)
- What happens when network issues prevent message delivery? → Message stored in database; delivery retried via notification hub; user sees sending indicator
- What happens when searching for channels by title? → Search functionality deferred to dedicated search feature (full-text search across channels and messages)
- What happens when a message contains sensitive information and needs to be redacted? → Message editing supported; author can edit/delete; channel admins can delete any message
- What happens when an archived channel is accessed? → Members can view message history but cannot post new messages or receive notifications; admins can unarchive
- What happens when direct messaging a user who has left the organization? → DM channel persists with historical messages; sending new messages returns error indicating user unavailable
- What happens when a file attachment exceeds size limit? → Deferred to dedicated file upload feature; file service enforces org-level quotas and size limits
- What happens when typing indicator shows but user navigates away? → Typing indicator auto-expires after timeout (e.g., 5 seconds of inactivity)
- What happens when a public channel is converted to private? → Existing members retain access; channel becomes non-discoverable; no automatic member removal
- What happens when notification preferences conflict (global mute vs channel unmute)? → Channel-level preferences override global settings

---

## Requirements *(mandatory)*

### Functional Requirements

**Channel Management**

- **FR-001**: System MUST allow employees to create channels with a title, description, and visibility type (public or private)
- **FR-002**: System MUST enforce that channel titles are URL-friendly (slug format: alphanumeric and hyphens only, maximum 64 characters)
- **FR-003**: System MUST ensure channel title uniqueness within each organization (prevent duplicate slugs)
- **FR-004**: System MUST support public channels that any employee in the organization can discover and join
- **FR-005**: System MUST support private channels that are invitation-only and not discoverable by non-members
- **FR-006**: System MUST track channel membership - which employees are members of which channels
- **FR-007**: System MUST allow channel members to invite other employees to their channels (both public and private)
- **FR-008**: System MUST enforce tenant isolation - employees can only access channels within their organization
- **FR-009**: System MUST store channel metadata including: channel ID, organization ID, title (slug), display name, description, visibility type, created timestamp, updated timestamp
- **FR-010**: System MUST track who created each channel and support multiple channel admins (no single owner limitation)
- **FR-011**: System MUST allow employees to join public channels via explicit "join" action (requires user intent)
- **FR-012**: System MUST prevent non-members from accessing private channel content
- **FR-013**: System MUST support channel archiving (prevents new messages and notifications; no deletion supported)
- **FR-014**: System MUST allow channel admins to remove members from channels
- **FR-015**: System MUST allow members to leave channels voluntarily
- **FR-016**: System MUST support unlimited members per channel (no enforced maximum)
- **FR-017**: System MUST support changing channel visibility between private and public (with access control preservation for existing members)

**Messaging**

- **FR-018**: System MUST allow channel members to post messages to channels
- **FR-019**: System MUST store message content including: message ID, channel ID, author (employee ID), organization ID, message text, parent message ID (for replies), created timestamp, updated timestamp
- **FR-020**: System MUST support replying to messages with exactly 1 level of threading (replies to messages only, no replies to replies)
- **FR-021**: System MUST prevent replies to replies (enforce single-layer reply constraint)
- **FR-022**: System MUST visually associate reply messages with their parent message
- **FR-023**: System MUST preserve message order within channels (chronological by creation timestamp)
- **FR-024**: System MUST enforce that only channel members can send messages to the channel (except archived channels which prevent all new messages)
- **FR-025**: System MUST deliver messages to all channel members in real-time (via notification hub integration, respecting per-channel notification preferences)
- **FR-026**: System MUST support message editing after posting (by message author only)
- **FR-027**: System MUST support message deletion by author or channel admins
- **FR-028**: System MUST preserve replies with "original message deleted" placeholder when parent message is deleted (maintains conversation context)
- **FR-029**: System MUST support file attachments via integration with dedicated file upload feature (S3-compatible storage with Cloudflare R2, deferred to separate feature)
- **FR-030**: System MUST implement reasonable maximum message length limit (deferred to implementation, suggest 10,000 characters)

**Reactions**

- **FR-031**: System MUST allow channel members to react to messages with emoji reactions
- **FR-032**: System MUST store reactions including: reaction ID, message ID, employee ID (who reacted), emoji/reaction type, organization ID, created timestamp
- **FR-033**: System MUST aggregate reactions by emoji type and display counts per emoji
- **FR-034**: System MUST treat multiple identical reactions from same user as toggle (add if not exists, remove if exists)
- **FR-035**: System MUST allow reactions on both top-level messages and reply messages
- **FR-036**: System MUST delete all reactions when the associated message is deleted
- **FR-037**: System MUST support unlimited different emoji types per message (no artificial limit)
- **FR-038**: System MUST NOT send notifications for reactions (reactions are low-priority engagement, avoid notification fatigue)

**Notifications & Real-Time Integration**

- **FR-039**: System MUST integrate with notification hub backend (feature #007) for all notification delivery
- **FR-040**: System MUST send notifications when new messages are posted to channels (to all members except the author)
- **FR-041**: System MUST send notifications when someone replies to a user's message (to the original message author)
- **FR-042**: System MUST send notifications when someone is invited to a channel (to the invited user)
- **FR-043**: System MUST support @mention functionality to notify specific users in messages (using @username syntax, always sends notification regardless of channel settings)
- **FR-044**: System MUST support configurable notification triggers per channel (all messages / mentions only / muted)
- **FR-045**: System MUST support per-channel notification preferences with three levels: all messages, mentions only, muted (overrides global settings)
- **FR-046**: System MUST NOT send notifications for reactions (avoid notification fatigue from low-priority engagement signals)
- **FR-047**: System MUST publish notification events with appropriate action_data for deep linking (e.g., `{channelId, messageId, replyId}`)
- **FR-048**: System MUST use notification hub's batching for bulk notifications (e.g., multiple members receiving same message notification)

**Reusability & Extensibility**

- **FR-049**: System MUST design data model to be reusable for project ticket comments, CRM notes, and other collaborative features
- **FR-050**: System MUST support treating project tickets or other entities as specialized channels (polymorphic channel types)
- **FR-051**: System MUST allow other business domains to create channels programmatically (e.g., auto-create channel when project ticket created)
- **FR-052**: System MUST provide backend API for other services to post messages to channels on behalf of system events
- **FR-053**: System MUST support channel types beyond "chat" (e.g., "direct_message", "project_ticket_thread", "crm_deal_notes") for extensibility
- **FR-054**: System MUST support direct messages between users as specialized private channels with exactly 2 members

**Performance & Scale**

- **FR-055**: System MUST support pagination when loading message history (infinite scroll pattern)
- **FR-056**: System MUST handle channels with thousands of messages without performance degradation
- **FR-057**: System MUST defer full-text search functionality to dedicated search feature (not included in v1)
- **FR-058**: System MUST NOT implement read receipts (avoid privacy concerns and complexity)
- **FR-059**: System MUST show typing indicators when members are actively composing messages (with auto-expiry after inactivity timeout)
- **FR-060**: System MUST enforce tenant isolation at database level with organization_id filtering on all queries

**Channel Archival**

- **FR-061**: System MUST allow channel admins to archive channels
- **FR-062**: System MUST prevent posting new messages to archived channels
- **FR-063**: System MUST prevent sending notifications for archived channels
- **FR-064**: System MUST allow viewing message history in archived channels
- **FR-065**: System MUST allow channel admins to unarchive channels (restore full functionality)
- **FR-066**: System MUST preserve all messages, reactions, and metadata when archiving channels

**Admin & Moderation**

- **FR-067**: System MUST support promoting members to admin role within channels
- **FR-068**: System MUST support demoting admins to member role (requires at least one admin remains)
- **FR-069**: System MUST auto-promote oldest member to admin if all admins leave channel
- **FR-070**: System MUST track admin actions (member removal, message deletion) for audit purposes

**Audit & Observability**

- **FR-071**: System MUST log all channel creation, archival, membership changes, message posting, editing, deletion, and moderation actions
- **FR-072**: System MUST track message delivery status through notification hub integration
- **FR-073**: System MUST expose metrics for channel activity (message volume, active channels, member engagement, typing activity)

### Key Entities *(include if feature involves data)*

- **Channel**: A communication space where employees can send messages. Has title (URL-friendly slug, max 64 chars, alphanumeric + hyphens), display name, description, visibility (public/private), channel type (chat/direct_message/project_ticket_thread), organization association, multiple admins, membership list, and archived status. Channels are the top-level container for conversations.

- **Message**: Text content posted by an employee to a channel. Has author, channel association, optional parent message (for replies), organization context, message text (max ~10k chars), edit history, deleted status (soft delete with placeholder), timestamps. Messages are the core communication unit. Reply messages reference a parent message ID but cannot themselves be replied to (1-level constraint).

- **Channel Membership**: Links employees to channels they can access. Tracks join date, invitation details, member role (admin/member), notification preference (all/mentions/muted), and status. Enforces access control for channel visibility rules.

- **Reaction**: Emoji-based response to a message. Links an employee, a message, and an emoji type (unlimited variety). Multiple employees can use the same emoji on one message (aggregated as counts). Reactions are lightweight engagement signals that do NOT trigger notifications.

- **Typing Indicator**: Ephemeral state tracking which members are currently composing messages in a channel. Auto-expires after inactivity timeout. Transmitted via real-time updates separate from persistent notifications.

- **Notification Event**: Generated when messages are posted (configurable: all/mentions/muted), replies are added, users are @mentioned (always), or invitations are sent. Routed through the notification hub backend (#007) with action-specific data containing channel ID, message ID, and reply ID for deep linking. NOT sent for reactions or archived channels. Channel-level preferences override global notification settings.

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain ← **ALL RESOLVED**
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified (notification hub backend #007, future file upload feature)

---

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked and resolved
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed ← **COMPLETE**

---

## Dependencies

- **Feature #007 (Notification Hub Backend)**: Chat system relies on notification hub for all real-time message delivery, invitation notifications, mention alerts, and reply notifications. The notification hub provides the infrastructure for SSE connections, cross-instance routing, and delivery tracking.

- **Future File Upload Feature**: File attachments in messages depend on a dedicated S3-compatible file upload service using Cloudflare R2 storage. This feature will handle file uploads, org-level usage tracking, and quota enforcement. Chat system will reference uploaded files via URLs/IDs.

---

## Notes for Planning Phase

1. **Reusability Design**: The channel/message/reply model should be designed generically enough to support:
   - Direct messages (2-person private channels with `channel_type='direct_message'`)
   - Project ticket comment threads (ticket = private channel, comments = messages)
   - CRM deal activity feeds (deal notes = messages in deal-specific channel)
   - Support ticket conversations (ticket = channel with customer + support team)
   
2. **Notification Strategy**: Chat is a high-volume notification source. Implementation clarified:
   - **Configurable per channel**: All messages / Mentions only / Muted
   - **@mentions always notify**: Override channel mute settings for explicit mentions
   - **No notifications for**: Reactions, archived channels, typing indicators
   - **Channel-level overrides global**: User can mute specific busy channels while keeping others unmuted
   - **Batching strategy**: Use notification hub's batch processing for bulk message notifications
   
3. **Database Schema Considerations**: 
   - `chat` schema to separate from other domains
   - All tables include `organization_id` for tenant isolation
   - Channel table fields: `title_slug` (64 char max), `channel_type` (chat/direct_message/project_ticket_thread), `is_archived`, `admin_ids[]`
   - Message table fields: `parent_message_id` (for replies), `is_deleted` (soft delete), `edit_history` (JSONB or separate table)
   - Channel membership fields: `role` (admin/member), `notification_preference` (all/mentions/muted)
   - Efficient indexing for message pagination and reply lookups
   - Consider partitioning messages table by date for scale

4. **Integration Points**:
   - Notification hub publishes events with `source_domain='chat'`
   - Action data format: `{channelId: uuid, messageId: uuid, replyId?: uuid, channelType: string}`
   - Channel membership queries needed for targeting notifications (respect per-user channel notification preferences)
   - Typing indicator transmitted separately from notification system (ephemeral WebSocket/SSE events)

5. **URL-Friendly Channel Titles**: Slug generation logic (title → slug):
   - **Validation**: Alphanumeric and hyphen only (no spaces, no special chars)
   - **Max length**: 64 characters (enforced at input)
   - **Lowercase transformation**: Convert to lowercase
   - **Duplicate handling**: Append numeric suffix if slug exists (e.g., `-2`, `-3`)
   - **Direct message channels**: Auto-generate slug from participant IDs (e.g., `dm-{user1_id}-{user2_id}`)

6. **Admin & Archival Logic**:
   - Multiple admins supported; at least one admin required
   - If last admin leaves: Promote oldest member to admin
   - Archiving prevents new messages and notifications but preserves read access
   - Admins can unarchive channels to restore full functionality

7. **Message Editing & Deletion**:
   - Edit: Author only, preserve edit history for transparency
   - Delete: Author or any channel admin, soft delete with placeholder
   - Parent message deleted: Keep replies with "original message deleted" text
   - Reactions deleted: When associated message deleted

8. **Typing Indicators**:
   - Ephemeral state, not persisted to database
   - Auto-expire after 5 seconds of inactivity
   - Transmitted via SSE/WebSocket separate from notification hub
   - Display "Username is typing..." in channel UI

9. **File Attachments** (Future Integration):
   - Messages reference uploaded files by URL/ID
   - File upload handled by separate S3-compatible service (Cloudflare R2)
   - Org-level quota tracking and enforcement
   - Support common media formats (images, documents, videos)
   - Chat system stores file reference metadata only

10. **Direct Messages**:
    - Implemented as private channels with `channel_type='direct_message'`
    - Exactly 2 members (sender + recipient)
    - Auto-created on first DM between users
    - Not discoverable, no join/leave (permanent 2-person association)
    - Share same message/reply/reaction infrastructure as regular channels
