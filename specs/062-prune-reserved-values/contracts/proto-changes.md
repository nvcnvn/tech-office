# Contract: Protobuf Changes

**Feature**: 062-prune-reserved-values

This is a **breaking change** to the published RPC contract. It ships atomically with both
clients, which is how Constitution VI is satisfied in this project. No `reserved` markers
are added — there is no pinned third-party consumer that could reuse a tag number against an
older reader, so a `reserved` line would itself be an inert value.

## 1. `backend/rpc/v1/chat.proto` — `ChannelType`

```diff
 enum ChannelType {
   CHANNEL_TYPE_UNSPECIFIED = 0;
   CHANNEL_TYPE_CHAT = 1;
   CHANNEL_TYPE_DIRECT_MESSAGE = 2;
   CHANNEL_TYPE_PROJECT_TICKET_THREAD = 3;
-  CHANNEL_TYPE_CRM_DEAL_NOTES = 4;
-  CHANNEL_TYPE_SUPPORT_TICKET = 5;
 }
```

Tags 0–3 keep their numbers. Any message field typed `ChannelType` is unchanged.

## 2. `backend/rpc/v1/files.proto` — `FileContextType`

```diff
 enum FileContextType {
   FILE_CONTEXT_TYPE_UNSPECIFIED = 0;
   FILE_CONTEXT_TYPE_CHAT_CHANNEL = 1;
   FILE_CONTEXT_TYPE_PROJECT = 2;
   FILE_CONTEXT_TYPE_DEPARTMENT_DOCS = 3;
   FILE_CONTEXT_TYPE_CALENDAR_EVENT = 4;
-  FILE_CONTEXT_TYPE_SUPPORT_TICKET = 5;
-  FILE_CONTEXT_TYPE_CRM_DEAL = 6;
 }
```

## 3. `backend/rpc/v1/notification.proto` — comments only

`source_domain` is a `string`, not an enum, so no field changes. The trailing comments that
enumerate the permitted values are corrected:

```diff
-  string source_domain = 3; // chat, crm, projects, hr, support, finance, system
+  string source_domain = 3; // chat, projects, docs, calendar, system
```

The same correction applies to every other place in this file that lists the domains,
including the `ListNotifications` filter field and the comment near line 615 that says
"Values are from the same set the publisher accepts as source_domain".

## 4. Link resolution — `legacyNormalized` removed

`LegacyNormalized` is not a protobuf field; it is a Go struct field serialised to JSON by
`backend/internal/linking/types.go`. Removing it changes the JSON shape of a resolved link
target:

```diff
 {
   "tenantKey": "acme",
   "resourceType": "task_instance",
   "resourceId": "0199...",
-  "legacyNormalized": true,
   "canonicalVersion": 1
 }
```

Because the field carried `omitempty` and could only be `true` on a legacy resolution — a
path that no longer exists — no canonical resolution's payload changes at all.
`frontend/packages/links/src/index.ts` drops the matching optional property.

## Regeneration

Proto edits are not hand-propagated. After editing the `.proto` files, regenerate:

- Go: `backend/rpc/v1/*.pb.go` and `rpcv1connect/`
- TypeScript: `frontend/packages/rpc/rpc/v1/*_pb.ts`

Both come from the repository's `buf` configuration. Generated output is committed, so the
regenerated files are part of this change set. Do not hand-edit `*.pb.go` or `*_pb.ts`.

## Compile-time consequences (intended)

Deleting an enum value makes every `switch` arm that names it a compile error in Go and a
type error in TypeScript. That is the mechanism by which FR-008 is enforced: the five Go
mapping switches (`chat/logic.go` ×3, `chat/connect.go` ×2, `files/service.go` ×2) and the
`convertChannelType` arms in `packages/apis/src/chat.ts` cannot be forgotten.
