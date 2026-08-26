/**
 * SF Symbol icon catalog for the mobile app
 *
 * All icons are Apple SF Symbols rendered with expo-image (`sf:` prefix).
 * Every icon entry has:
 *   - `name`     — SF Symbol name (regular weight)
 *   - `filled`   — filled variant for selected / active state (optional)
 *   - `label`    — human-readable text label that MUST accompany the icon
 *   - `testID`   — suggested testID for Maestro targeting
 *
 * Design principle: **every icon always has a visible text label**.
 * There are NO icon-only buttons in the app. This eliminates ambiguity for
 * low-tech workers who may not recognise symbolic icons alone.
 *
 * Usage with expo-image:
 *
 *   import { Image } from 'expo-image';
 *   import { icons } from '@tech-office/theme-tokens/icons';
 *
 *   <Image
 *     source={`sf:${icons.chat.send.name}`}
 *     style={{ width: 24, height: 24, tintColor: palette.primary.main }}
 *   />
 */

// ─── Type ────────────────────────────────────────────────────────────────────

export type SFIcon = {
    /** SF Symbol name (outline / regular weight). */
    name: string;
    /** Filled variant (for selected / active state). Falls back to `name`. */
    filled: string;
    /** Human-readable label displayed next to the icon. */
    label: string;
    /** Suggested testID attribute (kebab-case). */
    testID: string;
};

function icon(
    name: string,
    label: string,
    testID: string,
    filled?: string,
): SFIcon {
    return { name, filled: filled ?? name, label, testID };
}

// ─── Tab Bar ─────────────────────────────────────────────────────────────────

/**
 * Four tabs are on the bar: chat, today, tasks, more.
 * `calendar` and `alerts` stay here because both are still real destinations —
 * they are just reached from a header action (Today -> Schedule, Chat -> Alerts)
 * instead of owning a tab slot.
 */
export const tabIcons = {
    chat: icon('bubble.left', 'Chat', 'tab-chat', 'bubble.left.fill'),
    today: icon('sun.max', 'Today', 'tab-today', 'sun.max.fill'),
    tasks: icon('checkmark.square', 'My Work', 'tab-tasks', 'checkmark.square.fill'),
    calendar: icon('calendar', 'Schedule', 'tab-calendar', 'calendar'),
    alerts: icon('bell', 'Alerts', 'tab-alerts', 'bell.fill'),
    more: icon('ellipsis', 'More', 'tab-more', 'ellipsis'),
} as const;

// ─── Navigation / Chrome ─────────────────────────────────────────────────────

export const navIcons = {
    back: icon('chevron.left', 'Back', 'nav-back'),
    close: icon('xmark', 'Close', 'nav-close'),
    menu: icon('ellipsis.circle', 'Menu', 'nav-menu', 'ellipsis.circle.fill'),
    search: icon('magnifyingglass', 'Search', 'nav-search'),
    filter: icon('line.3.horizontal.decrease', 'Filter', 'nav-filter'),
    sort: icon('arrow.up.arrow.down', 'Sort', 'nav-sort'),
    settings: icon('gearshape', 'Settings', 'nav-settings', 'gearshape.fill'),
    info: icon('info.circle', 'Info', 'nav-info', 'info.circle.fill'),
} as const;

// ─── Chat ────────────────────────────────────────────────────────────────────

export const chatIcons = {
    send: icon('paperplane.fill', 'Send', 'send-message-button'),
    attach: icon('paperclip', 'Attach', 'attach-file-button'),
    newChannel: icon('plus.bubble', 'New Channel', 'new-channel-button', 'plus.bubble.fill'),
    newDM: icon('envelope', 'New Message', 'new-dm-button', 'envelope.fill'),
    reply: icon('arrowshape.turn.up.left', 'Reply', 'reply-button', 'arrowshape.turn.up.left.fill'),
    thread: icon('bubble.left.and.bubble.right', 'Thread', 'open-thread', 'bubble.left.and.bubble.right.fill'),
    reaction: icon('face.smiling', 'React', 'add-reaction-button', 'face.smiling.fill'),
    mention: icon('at', 'Mention', 'mention-button'),
    pin: icon('pin', 'Pin', 'pin-message', 'pin.fill'),
    mute: icon('bell.slash', 'Mute', 'mute-channel', 'bell.slash.fill'),
    unmute: icon('bell', 'Unmute', 'unmute-channel', 'bell.fill'),
    channel: icon('number', 'Channel', 'channel-icon'),
    privateLock: icon('lock', 'Private', 'private-channel-icon', 'lock.fill'),
} as const;

// ─── Tasks / Projects ────────────────────────────────────────────────────────

export const taskIcons = {
    addTask: icon('plus.circle', 'New Task', 'add-task-button', 'plus.circle.fill'),
    checkbox: icon('square', 'Mark Complete', 'task-checkbox', 'checkmark.square.fill'),
    project: icon('folder', 'Project', 'project-icon', 'folder.fill'),
    assignee: icon('person', 'Assignee', 'task-assignee', 'person.fill'),
    dueDate: icon('calendar.badge.clock', 'Due Date', 'task-due-date'),
    priority: icon('flag', 'Priority', 'task-priority', 'flag.fill'),
    comment: icon('text.bubble', 'Comment', 'task-comment', 'text.bubble.fill'),
    watch: icon('eye', 'Watch', 'task-watch', 'eye.fill'),
    unwatch: icon('eye.slash', 'Unwatch', 'task-unwatch', 'eye.slash.fill'),
    subtask: icon('list.bullet.indent', 'Subtask', 'task-subtask'),
    attachment: icon('paperclip', 'Attachment', 'task-attachment'),
    move: icon('arrow.right.circle', 'Move', 'task-move-state', 'arrow.right.circle.fill'),
    ritual: icon('repeat', 'Ritual', 'ritual-task-icon'),
} as const;

// ─── Calendar / Events ───────────────────────────────────────────────────────

export const calendarIcons = {
    addEvent: icon('plus.circle', 'New Event', 'add-event-button', 'plus.circle.fill'),
    checkIn: icon('checkmark.circle', 'Check In', 'event-checkin', 'checkmark.circle.fill'),
    checkOut: icon('arrow.right.circle', 'Check Out', 'event-checkout', 'arrow.right.circle.fill'),
    decline: icon('xmark.circle', 'Decline', 'event-decline', 'xmark.circle.fill'),
    accept: icon('hand.thumbsup', 'Accept', 'event-accept', 'hand.thumbsup.fill'),
    location: icon('mappin.and.ellipse', 'Location', 'event-location'),
    clock: icon('clock', 'Time', 'event-time', 'clock.fill'),
    recurrence: icon('repeat', 'Repeats', 'event-recurrence'),
    attendees: icon('person.2', 'Attendees', 'event-attendees', 'person.2.fill'),
    organizer: icon('person.text.rectangle', 'Organizer', 'event-organizer'),
} as const;

// ─── Notifications / Alerts ──────────────────────────────────────────────────

export const alertIcons = {
    /** Domain-specific icons that appear next to each notification row. */
    chatMessage: icon('bubble.left', 'Message', 'alert-chat', 'bubble.left.fill'),
    chatMention: icon('at', 'Mentioned you', 'alert-mention'),
    taskAssigned: icon('checkmark.square', 'Task assigned', 'alert-task', 'checkmark.square.fill'),
    taskComment: icon('text.bubble', 'Comment', 'alert-task-comment', 'text.bubble.fill'),
    calendarEvent: icon('calendar', 'Event', 'alert-calendar'),
    calendarReminder: icon('alarm', 'Reminder', 'alert-reminder', 'alarm.fill'),
    system: icon('gear', 'System', 'alert-system', 'gear'),

    /** Actions. */
    markRead: icon('checkmark', 'Mark Read', 'mark-read-button'),
    markAllRead: icon('checkmark.circle', 'Mark All Read', 'mark-all-read-button', 'checkmark.circle.fill'),
} as const;

// ─── Profile / Account ───────────────────────────────────────────────────────

export const profileIcons = {
    profile: icon('person.crop.circle', 'Profile', 'menu-profile', 'person.crop.circle.fill'),
    editProfile: icon('pencil', 'Edit Profile', 'edit-profile-button'),
    camera: icon('camera', 'Camera', 'avatar-camera', 'camera.fill'),
    signOut: icon('rectangle.portrait.and.arrow.right', 'Sign Out', 'menu-signout'),
    help: icon('questionmark.circle', 'Help & Support', 'menu-help', 'questionmark.circle.fill'),
} as const;

// ─── More Tab Menu ───────────────────────────────────────────────────────────

export const moreMenuIcons = {
    search: icon('magnifyingglass', 'Search', 'menu-search'),
    documents: icon('doc.text', 'Documents', 'menu-documents', 'doc.text.fill'),
    files: icon('folder', 'Files', 'menu-files', 'folder.fill'),
    profile: icon('person.crop.circle', 'Profile', 'menu-profile', 'person.crop.circle.fill'),
    settings: icon('gearshape', 'Settings', 'menu-settings', 'gearshape.fill'),
    help: icon('questionmark.circle', 'Help & Support', 'menu-help', 'questionmark.circle.fill'),
    signOut: icon('rectangle.portrait.and.arrow.right', 'Sign Out', 'menu-signout'),
} as const;

// ─── Global Search ───────────────────────────────────────────────────────────

export const searchIcons = {
    /** The tappable pill shown at the top of Chat, Tasks, Calendar lists. */
    searchPill: icon('magnifyingglass', 'Search people, tasks, chats…', 'global-search-pill'),
    /** Input field icon in the full-screen search modal. */
    searchInput: icon('magnifyingglass', 'Search', 'global-search-input'),
    /** Clear query button inside the search input. */
    clearQuery: icon('xmark.circle.fill', 'Clear', 'search-clear-button'),
    /** "Cancel" dismiss button. */
    cancel: icon('xmark', 'Cancel', 'search-cancel-button'),

    /** Domain badges shown on each result row. */
    resultPerson: icon('person', 'Person', 'search-result-person', 'person.fill'),
    resultChannel: icon('bubble.left', 'Channel', 'search-result-channel', 'bubble.left.fill'),
    resultMessage: icon('text.bubble', 'Message', 'search-result-message', 'text.bubble.fill'),
    resultTask: icon('checkmark.square', 'Task', 'search-result-task', 'checkmark.square.fill'),
    resultEvent: icon('calendar', 'Event', 'search-result-event'),
    resultDocument: icon('doc.text', 'Document', 'search-result-document', 'doc.text.fill'),
    resultDepartment: icon('building.2', 'Department', 'search-result-department', 'building.2.fill'),
} as const;

// ─── Common Actions ──────────────────────────────────────────────────────────

export const actionIcons = {
    add: icon('plus', 'Add', 'action-add'),
    edit: icon('pencil', 'Edit', 'action-edit'),
    delete: icon('trash', 'Delete', 'action-delete', 'trash.fill'),
    share: icon('square.and.arrow.up', 'Share', 'action-share'),
    copy: icon('doc.on.doc', 'Copy', 'action-copy', 'doc.on.doc.fill'),
    download: icon('arrow.down.circle', 'Download', 'action-download', 'arrow.down.circle.fill'),
    refresh: icon('arrow.clockwise', 'Refresh', 'action-refresh'),
    cancel: icon('xmark', 'Cancel', 'action-cancel'),
    confirm: icon('checkmark', 'Confirm', 'action-confirm'),
    undo: icon('arrow.uturn.backward', 'Undo', 'action-undo'),
} as const;

// ─── Status / State Indicators ───────────────────────────────────────────────

export const statusIcons = {
    online: icon('circle.fill', 'Online', 'status-online'),
    away: icon('moon.fill', 'Away', 'status-away'),
    busy: icon('minus.circle.fill', 'Busy', 'status-busy'),
    offline: icon('circle', 'Offline', 'status-offline'),
    unread: icon('circle.fill', 'Unread', 'unread-indicator'),
    chevronRight: icon('chevron.right', '', 'chevron-right'),
    chevronDown: icon('chevron.down', '', 'chevron-down'),
    checkmark: icon('checkmark', 'Done', 'checkmark'),
    warning: icon('exclamationmark.triangle', 'Warning', 'warning-icon', 'exclamationmark.triangle.fill'),
    error: icon('xmark.circle', 'Error', 'error-icon', 'xmark.circle.fill'),
} as const;

// ─── Empty State Illustrations ───────────────────────────────────────────────
// These are larger SF Symbols used at 48–64dp in empty state screens.

export const emptyStateIcons = {
    noMessages: icon('bubble.left.and.text.bubble.right', 'No messages yet', 'empty-chat'),
    noTasks: icon('checkmark.square.trianglebadge.exclamationmark', 'No tasks', 'empty-tasks'),
    noEvents: icon('calendar.badge.exclamationmark', 'No events', 'empty-calendar'),
    noNotifications: icon('bell.slash', 'All caught up', 'empty-notifications', 'bell.slash.fill'),
    noResults: icon('magnifyingglass', 'No results', 'empty-search'),
    noFiles: icon('doc', 'No files', 'empty-files'),
    noDocuments: icon('doc.text', 'No documents', 'empty-docs', 'doc.text.fill'),
    offline: icon('wifi.slash', 'No connection', 'empty-offline'),
} as const;

// ─── Aggregate Export ────────────────────────────────────────────────────────

export const icons = {
    tab: tabIcons,
    nav: navIcons,
    chat: chatIcons,
    task: taskIcons,
    calendar: calendarIcons,
    alert: alertIcons,
    search: searchIcons,
    profile: profileIcons,
    moreMenu: moreMenuIcons,
    action: actionIcons,
    status: statusIcons,
    emptyState: emptyStateIcons,
} as const;
