export type Audience = 'Owner / IT Admin' | 'Employee' | 'Both';

export type FeatureStatus = 'Available now' | 'Role-dependent' | 'Mobile in progress';

export interface GuideScreenshot {
  src: string;
  alt: string;
  caption: string;
}

export interface GuideLink {
  label: string;
  href: string;
}

export interface ProductFeature {
  title: string;
  status: FeatureStatus;
  audience: Audience;
  platforms: string;
  summary: string;
  tags: string[];
  highlights: string[];
  commonTasks: string[];
  relatedGuides: GuideLink[];
}

export interface GuideSection {
  title: string;
  summary: string;
  example: string;
  tags: string[];
  steps: string[];
  relatedFeatures: GuideLink[];
  screenshot?: GuideScreenshot;
}

export interface DocNavItem {
  href: string;
  label: string;
  description: string;
  personas: Audience[];
  tags: string[];
}

export interface DocNavGroup {
  title: string;
  items: DocNavItem[];
}

export const docsLastReviewed = 'June 18, 2026';

export const docsScreenshots = {
  signIn: {
    src: '/docs/transformar-signin.png',
    alt: 'TechOffice sign-in page showing organization subdomain, email or account ID, SSO, registration, and invitation options.',
    caption: 'Start sign-in by entering the organization subdomain, then continue with an email address or account ID.',
  },
  signup: {
    src: '/docs/transformar-signup.png',
    alt: 'TechOffice organization registration form with organization details and admin account fields.',
    caption: 'Owners and IT admins register an organization and create the first admin account from one form.',
  },
  signupFilled: {
    src: '/docs/transformar-signup-filled.png',
    alt: 'TechOffice organization registration form filled with sample documentation account details and an available subdomain indicator.',
    caption: 'Use a recognizable subdomain and a strong password before creating the organization.',
  },
  signupSuccess: {
    src: '/docs/transformar-signup-success.png',
    alt: 'TechOffice registration success page with a Go to Sign In link.',
    caption: 'After registration succeeds, go back to sign in with the new subdomain and admin email.',
  },
  emailSignIn: {
    src: '/docs/transformar-signin-email.png',
    alt: 'TechOffice sign-in form after entering an organization subdomain and email address, with the password field visible.',
    caption: 'Email accounts show the password field after the workspace and email address are recognized.',
  },
  firstWorkspace: {
    src: '/docs/transformar-first-workspace.png',
    alt: 'TechOffice first workspace screen showing Calendar, top navigation, search, context rail, and push notification prompt.',
    caption: 'The workspace opens with primary navigation, search, context rail, and notification setup.',
  },
  organizationSetup: {
    src: '/docs/transformar-organization.png',
    alt: 'TechOffice Organization page showing Departments, Employees, Permissions, and an empty department setup state.',
    caption: 'The Organization page is the owner and IT admin starting point for departments, employees, and permissions.',
  },
  notifications: {
    src: '/docs/owner-dashboard.png',
    alt: 'TechOffice notifications page with unread filter, live status, workspace context, and notification permission banner.',
    caption: 'Notifications are the daily inbox for unread work and push setup.',
  },
  chat: {
    src: '/docs/employee-chat.png',
    alt: 'TechOffice chat page with channels, direct messages, task discussions, composer, and workspace context.',
    caption: 'Chat separates channels, direct messages, and task discussions so the conversation can stay with the right work.',
  },
  tasks: {
    src: '/docs/employee-tasks.png',
    alt: 'TechOffice tasks page with project search, project card, New Project button, and workspace context.',
    caption: 'Tasks start from project workspaces and continue into task details, rituals, and evidence.',
  },
  calendar: {
    src: '/docs/employee-calendar.png',
    alt: 'TechOffice calendar month view with New Event button, view toggles, overlay chips, and workspace context.',
    caption: 'Calendar supports schedule views, event creation, overlays, and a context rail for selected dates and invites.',
  },
} satisfies Record<string, GuideScreenshot>;

const featureAnchor = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const getFeatureAnchor = featureAnchor;

const featureHref = (title: string) => `/docs/features#${featureAnchor(title)}`;

export const productFeatures: ProductFeature[] = [
  {
    title: 'Account Access',
    status: 'Available now',
    audience: 'Both',
    platforms: 'Web and mobile',
    summary: 'Register an organization, sign in with email/password, SSO, invitation links, organization switching, active sessions, and PIN-based organization accounts.',
    tags: ['sign-in', 'registration', 'sso', 'pin accounts', 'invitations'],
    highlights: [
      'Organization registration and subdomain lookup',
      'Email/password login, Google SSO, and Apple SSO',
      'Invitation acceptance, password reset, and organization switching',
      'PIN accounts for employees who do not use email every day',
    ],
    commonTasks: [
      'Register a new organization',
      'Sign in with email, SSO, or account ID plus PIN',
      'Reset a password or PIN',
      'Switch organizations before acting',
    ],
    relatedGuides: [
      { label: 'Register your organization', href: '/docs/guides/owner#register-your-organization' },
      { label: 'Sign in to the right workspace', href: '/docs/guides/employee#sign-in-to-the-right-workspace' },
    ],
  },
  {
    title: 'Organization Management',
    status: 'Role-dependent',
    audience: 'Owner / IT Admin',
    platforms: 'Web first',
    summary: 'Manage employees, imports, departments, managers, roles, permissions, and organization-managed PIN accounts.',
    tags: ['organization', 'employees', 'departments', 'permissions', 'pin accounts'],
    highlights: [
      'Employee invite, single creation, and CSV or Excel import',
      'Department tree and org chart surfaces',
      'Role and permission management',
      'Org-managed account unlock, deactivate, and credential reset',
    ],
    commonTasks: [
      'Create departments before importing employees',
      'Invite employees individually',
      'Import employees from a spreadsheet',
      'Create a PIN account for a low-email worker',
      'Delegate admin work with roles',
    ],
    relatedGuides: [
      { label: 'Set up departments and managers', href: '/docs/guides/owner#set-up-departments-and-managers' },
      { label: 'Invite your team members', href: '/docs/guides/owner#invite-your-team-members' },
      { label: 'Delegate with roles and permissions', href: '/docs/guides/owner#delegate-with-roles-and-permissions' },
    ],
  },
  {
    title: 'Notifications and Presence',
    status: 'Available now',
    audience: 'Both',
    platforms: 'Web and mobile',
    summary: 'Use notifications as the workspace inbox for unread work, source filters, live delivery, push registration, and presence visibility.',
    tags: ['notifications', 'alerts', 'presence', 'push', 'inbox'],
    highlights: [
      'Notification list, filters, unread counts, and mark-as-read actions',
      'Live stream for in-app delivery',
      'Browser and mobile push token registration',
      'Presence status and visibility settings',
    ],
    commonTasks: [
      'Check unread notifications',
      'Open a notification to jump to the source',
      'Enable push notifications on trusted devices',
      'Set presence visibility',
    ],
    relatedGuides: [
      { label: 'Prepare notifications and chat', href: '/docs/guides/owner#prepare-notifications-chat-docs-and-files' },
      { label: 'Check your notifications', href: '/docs/guides/employee#check-your-notifications' },
    ],
  },
  {
    title: 'Chat and Voice',
    status: 'Available now',
    audience: 'Both',
    platforms: 'Web and mobile',
    summary: 'Use channels, direct messages, task discussions, replies, reactions, mentions, attachments, voice messages, and live voice calls.',
    tags: ['chat', 'direct messages', 'channels', 'voice', 'mentions'],
    highlights: [
      'Public and private channels plus direct messages',
      'Replies, reactions, edits, deletes, user mentions, and department mentions',
      'File attachments with contextual access',
      'Voice calls, invitations, call records, and voice messages',
    ],
    commonTasks: [
      'Create a team or project channel',
      'Start a direct message',
      'Reply to a specific message',
      'Mention a person or department when action is needed',
      'Send a voice message or join a live call',
    ],
    relatedGuides: [
      { label: 'Prepare communication spaces', href: '/docs/guides/owner#prepare-notifications-chat-docs-and-files' },
      { label: 'Use DM, group chat, and task discussions', href: '/docs/guides/employee#use-direct-messages-group-chat-and-task-discussions' },
    ],
  },
  {
    title: 'Projects, Tasks, and Rituals',
    status: 'Available now',
    audience: 'Both',
    platforms: 'Web and mobile, with richer setup on web',
    summary: 'Create project workspaces with task workflow, saved views, recurring rituals, evidence submission, review, and operational health reporting.',
    tags: ['projects', 'tasks', 'rituals', 'evidence', 'reviews'],
    highlights: [
      'Project create, membership, visibility, and archive',
      'Board, list, gantt, calendar, analytics, today, review, health, and settings surfaces',
      'Task assignment, hierarchy, watchers, files, custom fields, and workflow rules',
      'Ritual definitions, generated instances, evidence submission, review, and compliance exports',
    ],
    commonTasks: [
      'Create a project',
      'Configure workflow states',
      'Assign project members',
      'Create a recurring ritual',
      'Submit evidence',
      'Review evidence and operational health',
    ],
    relatedGuides: [
      { label: 'Set up projects and task workflow', href: '/docs/guides/owner#set-up-projects-and-task-workflow' },
      { label: 'Set up recurring rituals and evidence', href: '/docs/guides/owner#set-up-recurring-rituals-and-evidence' },
      { label: 'Complete tasks and submit evidence', href: '/docs/guides/employee#complete-tasks-and-submit-evidence' },
    ],
  },
  {
    title: 'Calendar and Scheduling',
    status: 'Available now',
    audience: 'Both',
    platforms: 'Web first, mobile in progress',
    summary: 'Schedule events with attendees, RSVP, recurrence, working hours, availability, resources, booking links, check-in, audit, and overlays.',
    tags: ['calendar', 'scheduling', 'resources', 'booking links', 'rsvp'],
    highlights: [
      'Day, week, month, and agenda views',
      'Attendees, RSVP, recurring events, and series edits',
      'Resource booking and booking links',
      'Check-in, evidence, audit entries, and cross-domain overlays',
    ],
    commonTasks: [
      'Create a meeting or event',
      'Respond to an invitation',
      'Check availability',
      'Add a room, vehicle, or equipment resource',
      'Create a booking link',
    ],
    relatedGuides: [
      { label: 'Set up calendar resources and booking links', href: '/docs/guides/owner#set-up-calendar-resources-and-booking-links' },
      { label: 'Check your schedule', href: '/docs/guides/employee#check-your-schedule' },
    ],
  },
  {
    title: 'Docs',
    status: 'Available now',
    audience: 'Both',
    platforms: 'Web, with mobile reading routes',
    summary: 'Create and read document trees with rich editing, versions, comments, followers, access grants, line citations, embeds, and search.',
    tags: ['docs', 'knowledge', 'citations', 'comments', 'search'],
    highlights: [
      'Hierarchical document tree and rich editor',
      'Version history, diffs, and line-by-line attribution',
      'Employee and department access grants',
      'Line-range citations and live embedded sections',
    ],
    commonTasks: [
      'Create a root document for a policy or handbook',
      'Share access with an employee or department',
      'Comment on a document',
      'Copy a line-range citation link',
      'Search for a policy or procedure',
    ],
    relatedGuides: [
      { label: 'Prepare docs and files', href: '/docs/guides/owner#prepare-notifications-chat-docs-and-files' },
      { label: 'Use docs, files, search, and links', href: '/docs/guides/employee#use-docs-files-search-and-links' },
    ],
  },
  {
    title: 'Files',
    status: 'Available now',
    audience: 'Both',
    platforms: 'Web and mobile access, web management',
    summary: 'Manage secure downloads, metadata, listing, deletion details, quota, validation, access checks, search, PDF conversion, and indexing status.',
    tags: ['files', 'storage', 'quota', 'validation', 'search'],
    highlights: [
      'Secure download URLs and access checks',
      'Quota overview and updates',
      'File validation and deletion audit details',
      'Search, PDF conversion status, and content indexing status',
    ],
    commonTasks: [
      'Open a file attached to chat, a task, evidence, a doc, or an event',
      'Review storage usage',
      'Delete stale files with a reason',
      'Understand file validation warnings',
    ],
    relatedGuides: [
      { label: 'Prepare docs and files', href: '/docs/guides/owner#prepare-notifications-chat-docs-and-files' },
      { label: 'Use docs, files, search, and links', href: '/docs/guides/employee#use-docs-files-search-and-links' },
    ],
  },
  {
    title: 'Search and Links',
    status: 'Available now',
    audience: 'Both',
    platforms: 'Web and mobile',
    summary: 'Find people, departments, channels, messages, documents, files, and calendar events, then open shared resource links across web and mobile.',
    tags: ['search', 'links', 'mobile', 'navigation', 'access'],
    highlights: [
      'Employee and department search and autocomplete',
      'Channel, message, document, file, and calendar event search',
      'Canonical resource links for supported workspace resources',
      'Sign-in, access denied, and not-found fallback states',
    ],
    commonTasks: [
      'Search for a person, department, channel, message, document, file, or event',
      'Open a shared TechOffice link',
      'Recover from sign-in, access denied, or not-found states',
    ],
    relatedGuides: [
      { label: 'Confirm the active workspace', href: '/docs/guides/owner#confirm-the-active-workspace' },
      { label: 'Use docs, files, search, and links', href: '/docs/guides/employee#use-docs-files-search-and-links' },
    ],
  },
  {
    title: 'Mobile App',
    status: 'Mobile in progress',
    audience: 'Both',
    platforms: 'Mobile, with shared web links',
    summary: 'Use Chat, Tasks, Schedule, Alerts, and More for mobile authentication, notifications, task work, evidence, calendar, files, docs, search, and resource links.',
    tags: ['mobile', 'alerts', 'tasks', 'chat', 'schedule', 'links'],
    highlights: [
      'Authentication, invitation acceptance, SSO callback, password reset, PIN login, and PIN setup',
      'Chat, channels, direct messages, threads, voice messages, and voice calls',
      'Tasks, project details, ritual details, and evidence-oriented task views',
      'Calendar, event details, booking links, profile, files, docs, search, and settings',
    ],
    commonTasks: [
      'Use Alerts as the mobile daily inbox',
      'Respond to chat and calls',
      'Submit ritual evidence from the field',
      'Open resource links from notifications',
    ],
    relatedGuides: [
      { label: 'Mobile daily routine', href: '/docs/guides/employee#mobile-daily-routine' },
      { label: 'Check your notifications', href: '/docs/guides/employee#check-your-notifications' },
    ],
  },
];

export const evolvingFeatures = [
  'Mobile ritual UX for frontline worker and manager review surfaces',
  'Fully unified global search ranking across every domain',
  'Context Rail parity across every workspace page',
  'Advanced calendar and resource governance parity across clients',
];

export const ownerGuideSections: GuideSection[] = [
  {
    title: 'Register your organization',
    summary: 'Create the workspace and first admin account when your company does not have TechOffice yet.',
    example: 'Example: register Docs Capture 441114 with subdomain docs-guide-441114 and admin email docs.capture.441114@example.com.',
    tags: ['owner', 'it-admin', 'registration', 'sign-in'],
    screenshot: docsScreenshots.signupFilled,
    steps: [
      'Open https://transformar.work/signin/.',
      'Select Register your organization.',
      'Enter the company name and subdomain.',
      'Enter the first admin account details.',
      'Wait for the subdomain availability check.',
      'Select Create Organization, then go back to sign in after the success message.',
    ],
    relatedFeatures: [
      { label: 'Account Access', href: featureHref('Account Access') },
      { label: 'Organization Management', href: featureHref('Organization Management') },
    ],
  },
  {
    title: 'Confirm the active workspace',
    summary: 'Make sure every setup action happens in the intended organization before changing settings.',
    example: 'Example: switch from North Star Lab to North Star Clinic before creating departments or inviting clinic employees.',
    tags: ['owner', 'it-admin', 'organization', 'workspace'],
    screenshot: docsScreenshots.firstWorkspace,
    steps: [
      'Check the organization name in the top-left workspace header.',
      'Use the profile or organization switcher if you need a different workspace.',
      'Confirm the top navigation shows Calendar, Notifications, Chat, Tasks, Docs, Files, and Organization.',
      'Continue only after the active workspace is correct.',
    ],
    relatedFeatures: [
      { label: 'Account Access', href: featureHref('Account Access') },
      { label: 'Search and Links', href: featureHref('Search and Links') },
    ],
  },
  {
    title: 'Set up departments and managers',
    summary: 'Build the structure used for assignment, manager visibility, search, notifications, and permissions.',
    example: 'Example first structure: Operations, Sales, Support, and Field Team.',
    tags: ['owner', 'it-admin', 'departments', 'managers'],
    screenshot: docsScreenshots.organizationSetup,
    steps: [
      'Open Organization.',
      'Select Departments.',
      'Select Create Root Department or Create First Department.',
      'Create only the top-level groups you will actually use.',
      'Add child teams when they matter for assignment, reporting, or communication.',
      'Assign managers after employee records exist.',
      'Use org chart or list view to verify that the structure is easy to understand.',
    ],
    relatedFeatures: [
      { label: 'Organization Management', href: featureHref('Organization Management') },
      { label: 'Search and Links', href: featureHref('Search and Links') },
    ],
  },
  {
    title: 'Invite your team members',
    summary: 'Choose email, SSO, PIN account, or bulk import based on how each worker signs in.',
    example: 'Example: invite maya@northstar.example by email, create night-shift-17 as a PIN account, and use bulk import for a store opening team.',
    tags: ['owner', 'it-admin', 'employees', 'invitations', 'pin accounts'],
    screenshot: docsScreenshots.organizationSetup,
    steps: [
      'Open Organization.',
      'Select Employees.',
      'Invite office workers with email or SSO so they can manage their own sign-in.',
      'Create org-managed PIN accounts for frontline, temporary, field, or shared-device workers.',
      'Use import for batches and review the preview table before confirming.',
      'Assign each employee to the correct department and role.',
      'Save any one-time temporary PIN before closing the result screen.',
    ],
    relatedFeatures: [
      { label: 'Account Access', href: featureHref('Account Access') },
      { label: 'Organization Management', href: featureHref('Organization Management') },
    ],
  },
  {
    title: 'Delegate with roles and permissions',
    summary: 'Use permission-backed roles to delegate repeatable admin work without giving every operator owner access.',
    example: 'Example roles: People Operator, Project Lead, and Facilities Scheduler.',
    tags: ['owner', 'it-admin', 'permissions', 'roles'],
    steps: [
      'Open Organization.',
      'Select Permissions.',
      'Review who can invite employees, import employees, manage departments, manage roles, create projects, review evidence, manage resources, delete files, and change quotas.',
      'Keep owner access limited to recovery and high-risk settings.',
      'Create operator roles for repeatable administration.',
      'Use project membership for authority that should apply only inside one project.',
      'Review permissions after each rollout phase.',
    ],
    relatedFeatures: [
      { label: 'Organization Management', href: featureHref('Organization Management') },
      { label: 'Projects, Tasks, and Rituals', href: featureHref('Projects, Tasks, and Rituals') },
    ],
  },
  {
    title: 'Set up projects and task workflow',
    summary: 'Create project workspaces and keep workflow complexity small until the team needs it.',
    example: 'Example: create Q3 Product Launch with key PRJ56D0F and mixed mode for one-off tasks plus recurring readiness checks.',
    tags: ['owner', 'it-admin', 'projects', 'tasks'],
    screenshot: docsScreenshots.tasks,
    steps: [
      'Open Tasks.',
      'Select New Project.',
      'Give the project a short name and key.',
      'Choose visibility: public for broad discovery, private for restricted teams.',
      'Choose collaboration mode: standard, ritual, or mixed.',
      'Add members and assign project roles.',
      'Configure states, task levels, custom fields, and workflow rules only when they clarify the work.',
    ],
    relatedFeatures: [
      { label: 'Projects, Tasks, and Rituals', href: featureHref('Projects, Tasks, and Rituals') },
      { label: 'Chat and Voice', href: featureHref('Chat and Voice') },
    ],
  },
  {
    title: 'Set up recurring rituals and evidence',
    summary: 'Create scheduled operational work and require evidence only when proof matters.',
    example: 'Example rituals: store opening checklist, Friday safety inspection with photo evidence, and end-of-shift report with text notes.',
    tags: ['owner', 'it-admin', 'rituals', 'evidence'],
    steps: [
      'Open the project where the recurring work belongs.',
      'Create a ritual definition with a clear title and schedule.',
      'Add default assignees, departments, or reviewers.',
      'Set the completion window.',
      'Add evidence requirements only when proof matters.',
      'Save the ritual and verify upcoming instances.',
      'Use the review backlog to approve, reject, or request corrected evidence.',
    ],
    relatedFeatures: [
      { label: 'Projects, Tasks, and Rituals', href: featureHref('Projects, Tasks, and Rituals') },
      { label: 'Notifications and Presence', href: featureHref('Notifications and Presence') },
    ],
  },
  {
    title: 'Set up calendar resources and booking links',
    summary: 'Prepare scheduling for meetings, shifts, rooms, equipment, vehicles, and shared spaces.',
    example: 'Example resources: Training Room A, Delivery Van 2, and Portable Scanner Kit.',
    tags: ['owner', 'it-admin', 'calendar', 'resources'],
    screenshot: docsScreenshots.calendar,
    steps: [
      'Open Calendar.',
      'Select New Event for meetings, shifts, company events, or maintenance windows.',
      'Add required and optional attendees.',
      'Check availability before choosing a time.',
      'Add resources such as rooms, vehicles, or equipment when needed.',
      'Use booking links when someone else should choose from available times.',
      'Use check-in or evidence only for events where proof is operationally required.',
    ],
    relatedFeatures: [
      { label: 'Calendar and Scheduling', href: featureHref('Calendar and Scheduling') },
      { label: 'Notifications and Presence', href: featureHref('Notifications and Presence') },
    ],
  },
  {
    title: 'Prepare notifications, chat, docs, and files',
    summary: 'Set up the places where daily work will happen before inviting the whole team.',
    example: 'Example channels: General Announcements, Operations, Q3 Product Launch, and direct messages for one-on-one coordination.',
    tags: ['owner', 'it-admin', 'notifications', 'chat', 'docs', 'files'],
    screenshot: docsScreenshots.chat,
    steps: [
      'Open Notifications and enable push notifications on trusted admin devices.',
      'Open Chat and create channels for teams, projects, operations, or announcements.',
      'Use private channels only for restricted groups.',
      'Create root docs for policies, handbooks, procedures, and project notes.',
      'Review file storage quotas and cleanup responsibilities.',
      'Explain when employees should use mentions, direct messages, task discussions, voice messages, and live calls.',
    ],
    relatedFeatures: [
      { label: 'Notifications and Presence', href: featureHref('Notifications and Presence') },
      { label: 'Chat and Voice', href: featureHref('Chat and Voice') },
      { label: 'Docs', href: featureHref('Docs') },
      { label: 'Files', href: featureHref('Files') },
    ],
  },
];

export const employeeGuideSections: GuideSection[] = [
  {
    title: 'Sign in to the right workspace',
    summary: 'Use the sign-in method your organization gave you and confirm the workspace before acting.',
    example: 'Example: enter north-star-clinic, then frontdesk-03 and the temporary PIN your manager provided.',
    tags: ['employee', 'sign-in', 'workspace', 'pin accounts'],
    screenshot: docsScreenshots.emailSignIn,
    steps: [
      'Open the sign-in page.',
      'Enter the organization subdomain from your manager or invitation.',
      'Enter your email address or account ID.',
      'If you use email, enter your password or select the SSO provider your organization enabled.',
      'If you use an account ID, enter your six-digit PIN.',
      'Choose the right workspace if you belong to more than one organization.',
    ],
    relatedFeatures: [
      { label: 'Account Access', href: featureHref('Account Access') },
      { label: 'Mobile App', href: featureHref('Mobile App') },
    ],
  },
  {
    title: 'Check your notifications',
    summary: 'Use Notifications on web or Alerts on mobile as your daily inbox.',
    example: 'Example: open a task assignment notification to jump directly to the task detail, then mark it as read after handling it.',
    tags: ['employee', 'notifications', 'alerts', 'push'],
    screenshot: docsScreenshots.notifications,
    steps: [
      'Open Notifications on web or Alerts on mobile.',
      'Start with unread items.',
      'Open a notification to jump to the exact chat, task, event, document, or file.',
      'Mark the item as read after handling it.',
      'Use source filters when you are catching up after time away.',
      'Allow push notifications on trusted devices when your work is time-sensitive.',
    ],
    relatedFeatures: [
      { label: 'Notifications and Presence', href: featureHref('Notifications and Presence') },
      { label: 'Search and Links', href: featureHref('Search and Links') },
    ],
  },
  {
    title: 'Use direct messages, group chat, and task discussions',
    summary: 'Choose the smallest conversation space that includes the people who need to act.',
    example: 'Example: use a DM for a private schedule question, a channel for an Operations update, and a task discussion for Prepare Launch Materials.',
    tags: ['employee', 'chat', 'direct messages', 'channels', 'voice'],
    screenshot: docsScreenshots.chat,
    steps: [
      'Use a direct message for one-on-one coordination.',
      'Use a channel for team, project, operations, or topic conversations.',
      'Use a task discussion when the conversation belongs to a specific task.',
      'Use a reply when you are responding to one message.',
      'Use a mention when a person or department needs to act.',
      'Attach files when the conversation needs shared context.',
      'Use a voice message when recording is faster than typing.',
      'Use a live voice call when the group needs to talk now.',
    ],
    relatedFeatures: [
      { label: 'Chat and Voice', href: featureHref('Chat and Voice') },
      { label: 'Files', href: featureHref('Files') },
    ],
  },
  {
    title: 'Check your schedule',
    summary: 'Use Calendar on web or Schedule on mobile for meetings, shifts, invitations, and booking details.',
    example: 'Example: open a safety training invitation, review the event details, RSVP, then check the room or resource listed on the event.',
    tags: ['employee', 'calendar', 'schedule', 'rsvp'],
    screenshot: docsScreenshots.calendar,
    steps: [
      'Open Calendar or Schedule.',
      'Choose day, week, month, or agenda view.',
      'Open event details to see attendees, time, location, meeting link, resources, and notes.',
      'Respond to invitations when RSVP is available.',
      'Use booking links when someone asks you to choose from available times.',
      'Complete check-in or evidence only when the event asks for it.',
    ],
    relatedFeatures: [
      { label: 'Calendar and Scheduling', href: featureHref('Calendar and Scheduling') },
      { label: 'Notifications and Presence', href: featureHref('Notifications and Presence') },
    ],
  },
  {
    title: 'Complete tasks and submit evidence',
    summary: 'Use task details for assigned work and ritual task instances for recurring evidence work.',
    example: 'Example: for an end-of-shift report, open the ritual task instance, enter the report, attach any requested file, submit it, and watch for reviewer feedback.',
    tags: ['employee', 'tasks', 'rituals', 'evidence'],
    screenshot: docsScreenshots.tasks,
    steps: [
      'Open Tasks.',
      'Search or select the project that contains your work.',
      'Open the assigned task.',
      'Review the title, description, state, assignees, watchers, files, discussion, and due window.',
      'For standard tasks, update the state when your work moves forward.',
      'For ritual tasks, open the generated ritual task instance.',
      'Submit every required evidence item.',
      'Watch for approval, rejection, or resubmission notifications.',
    ],
    relatedFeatures: [
      { label: 'Projects, Tasks, and Rituals', href: featureHref('Projects, Tasks, and Rituals') },
      { label: 'Files', href: featureHref('Files') },
    ],
  },
  {
    title: 'Use docs, files, search, and links',
    summary: 'Find reference work without asking someone where it lives.',
    example: 'Example: search for return policy, open the document, copy a citation link to the exact section, and paste it into a task discussion.',
    tags: ['employee', 'docs', 'files', 'search', 'links'],
    steps: [
      'Use search for people, departments, channels, messages, docs, files, and calendar events.',
      'Open Docs for policies, procedures, project notes, and team handbooks.',
      'Follow documents you need to watch for updates.',
      'Use comments or replies when a document needs review.',
      'Open files from the chat, task, doc, event, or evidence item where they were attached.',
      'Open TechOffice resource links directly. If you are signed out, sign in and return to the resource.',
      'If a link says access denied, ask the channel, project, document, or organization admin for access.',
    ],
    relatedFeatures: [
      { label: 'Docs', href: featureHref('Docs') },
      { label: 'Files', href: featureHref('Files') },
      { label: 'Search and Links', href: featureHref('Search and Links') },
    ],
  },
  {
    title: 'Mobile daily routine',
    summary: 'Use the mobile tabs in the order that keeps daily work moving.',
    example: 'Example: if a push notification says evidence was rejected, open the alert, go to the task, read the reviewer comment, correct the evidence, and resubmit.',
    tags: ['employee', 'mobile', 'alerts', 'tasks'],
    steps: [
      'Open Alerts first.',
      'Check Schedule for meetings, shifts, and invitations.',
      'Open Tasks for assigned work and ritual evidence.',
      'Respond in Chat when messages need action.',
      'Use More for profile, files, docs, search, and settings.',
    ],
    relatedFeatures: [
      { label: 'Mobile App', href: featureHref('Mobile App') },
      { label: 'Notifications and Presence', href: featureHref('Notifications and Presence') },
      { label: 'Projects, Tasks, and Rituals', href: featureHref('Projects, Tasks, and Rituals') },
    ],
  },
];

export const docNavGroups: DocNavGroup[] = [
  {
    title: 'Start Here',
    items: [
      {
        href: '/docs',
        label: 'Overview',
        description: 'Choose the owner/admin path, employee path, or feature lookup reference.',
        personas: ['Both'],
        tags: ['overview', 'screenshots', 'quickstart'],
      },
    ],
  },
  {
    title: 'For Owner or IT Admin',
    items: [
      {
        href: '/docs/guides/owner',
        label: 'Owner and IT Admin Guide',
        description: 'Register the organization, invite the team, set up departments, projects, rituals, calendar resources, docs, files, chat, and notifications.',
        personas: ['Owner / IT Admin'],
        tags: ['owner', 'it-admin', 'setup', 'employees', 'permissions'],
      },
      ...ownerGuideSections.map((section) => ({
        href: `/docs/guides/owner#${featureAnchor(section.title)}`,
        label: section.title,
        description: section.summary,
        personas: ['Owner / IT Admin' as const],
        tags: section.tags,
      })),
    ],
  },
  {
    title: 'For Employee',
    items: [
      {
        href: '/docs/guides/employee',
        label: 'Employee Guide',
        description: 'Sign in, check notifications, use chat, manage schedule changes, complete tasks, submit evidence, and find shared work.',
        personas: ['Employee'],
        tags: ['employee', 'daily workflow', 'alerts', 'tasks'],
      },
      ...employeeGuideSections.map((section) => ({
        href: `/docs/guides/employee#${featureAnchor(section.title)}`,
        label: section.title,
        description: section.summary,
        personas: ['Employee' as const],
        tags: section.tags,
      })),
    ],
  },
  {
    title: 'Feature Reference',
    items: [
      {
        href: '/docs/features',
        label: 'All Features',
        description: 'Lookup current features by capability, platform, status, and related task guide.',
        personas: ['Both'],
        tags: ['reference', 'feature list', 'status'],
      },
      ...productFeatures.map((feature) => ({
        href: featureHref(feature.title),
        label: feature.title,
        description: feature.summary,
        personas: [feature.audience],
        tags: feature.tags,
      })),
    ],
  },
];