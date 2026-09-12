# Contract: TypeScript Type Changes

**Feature**: 062-prune-reserved-values

All edits are inside `frontend/packages/*`, per Constitution VII — no app reaches past the
wrapper. Two of the three apps changes are *forced* by these type narrowings rather than
found by inspection, which is the point of putting them here.

## `packages/apis/src/chat.ts`

```diff
 export type ChannelType =
 	| 'chat'
 	| 'direct_message'
-	| 'project_ticket_thread'
-	| 'crm_deal_notes'
-	| 'support_ticket';
+	| 'project_ticket_thread';
```

and in `convertChannelType`:

```diff
 		case chat.ChannelType.PROJECT_TICKET_THREAD:
 			return 'project_ticket_thread';
-		case chat.ChannelType.CRM_DEAL_NOTES:
-			return 'crm_deal_notes';
-		case chat.ChannelType.SUPPORT_TICKET:
-			return 'support_ticket';
```

The two deleted `case` labels reference generated enum members that no longer exist, so
this edit is mandatory for the package to compile.

Two stale comments in the same package also name removed values and are corrected:
`packages/apis/src/types/search.ts:56` (a comment listing the channel-type union) and
`packages/apis/src/chat.ts:1068` (`// "task", "crm_deal", "support_ticket"`).

## `packages/apis/src/notification.ts`

```diff
 export type SourceDomain =
 	| 'chat'
-	| 'crm'
 	| 'projects'
 	| 'docs'
-	| 'hr'
-	| 'support'
-	| 'finance'
 	| 'system'
 	| 'calendar';

 export const SOURCE_DOMAINS: readonly SourceDomain[] = [
 	'chat',
 	'projects',
 	'calendar',
 	'docs',
-	'crm',
-	'hr',
-	'support',
-	'finance',
 	'system',
 ] as const;
```

The doc comment above `SOURCE_DOMAINS` explains the deliberate reading order and the D28
history that motivated it. Both remain accurate over five values and are kept.

## `packages/links/src/index.ts`

```diff
 	canonicalVersion: number;
-	legacyNormalized?: boolean;
```

## `apps/mobile/src/app/(app)/(more)/settings.tsx` — forced by the above

```diff
 const MUTE_ROWS: Record<SourceDomain, { label: string; icon: string }> = {
   chat: { label: "Chat", icon: "bubble.left.and.bubble.right.fill" },
   projects: { label: "Tasks and projects", icon: "checklist" },
   calendar: { label: "Calendar", icon: "calendar" },
   docs: { label: "Documents", icon: "doc.text.fill" },
-  crm: { label: "Customers", icon: "person.2.fill" },
-  hr: { label: "People and HR", icon: "person.badge.shield.checkmark" },
-  support: { label: "Support", icon: "lifepreserver" },
-  finance: { label: "Finance", icon: "creditcard.fill" },
   system: { label: "System", icon: "gearshape.fill" },
 };
```

`Record<SourceDomain, …>` makes the four surplus keys a type error the moment the union
narrows, so `pnpm run typecheck:mobile` — the repository's one CI-enforced gate — catches
a half-done change. The screen renders from `SOURCE_DOMAINS.map(...)`, so no rendering code
changes; the list simply becomes five rows.

## `apps/web/src/app/workspace/layout.tsx` — not type-forced

```diff
-  { id: "crm",     label: "CRM",     emoji: "🤝", path: "/workspace/crm",     shortcut: "⌘9", enabled: false },
-  { id: "finance", label: "Finance", emoji: "💰", path: "/workspace/finance", shortcut: "⌘-", enabled: false },
-  { id: "hr",      label: "HR",      emoji: "👤", path: "/workspace/hr",      shortcut: "⌘=", enabled: false },
 ];
```

Nothing in the type system catches this one, which is why US2 gets a web E2E assertion that
every rendered entry is enabled and reachable. The surviving eight already carry `⌘1`–`⌘8`,
so the advertised sequence is contiguous with no renumbering.

## Regenerated, not edited

`frontend/packages/rpc/rpc/v1/chat_pb.ts`, `files_pb.ts` and `notification_pb.ts` come from
`buf` and are regenerated from the `.proto` edits. Each workspace package builds to a
gitignored `dst/`, so `pnpm --filter "./packages/*" run build` must run before any
typecheck on a clean tree — this is the D34 lesson and applies to CI as much as locally.
