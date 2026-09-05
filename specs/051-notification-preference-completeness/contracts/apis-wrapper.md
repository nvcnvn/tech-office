# Contract: `apis` wrapper and the mobile hook

**Feature**: `051-notification-preference-completeness`

Principle VII requires every server call to go through the `apis` package and
forbids screens touching a Connect client. Two surfaces are therefore fixed
here: what `apis` exports, and what the mobile hook over it exposes.

---

## 1. `frontend/packages/apis/src/notification.ts` (MODIFIED)

The `SourceDomain` union gains `'calendar'` — a cross-stack constant that has
been out of step with the backend since feature 026 (see
[research.md R2](./research.md)) — and gains a companion array:

```ts
export type SourceDomain =
  | 'chat' | 'crm' | 'projects' | 'docs'
  | 'hr' | 'support' | 'finance' | 'system' | 'calendar';

/**
 * Every source domain, in the order the mute list shows them.
 *
 * MUST hold the same nine values as notification.AllSourceDomains in Go and the
 * two source-domain CHECK constraints. A value missing here is a domain nobody
 * can mute, which is the gap feature 051 closed.
 */
export const SOURCE_DOMAINS: readonly SourceDomain[] = [
  'chat', 'projects', 'calendar', 'docs',
  'crm', 'hr', 'support', 'finance', 'system',
] as const;
```

The existing "MUST align with… submit all changes in a single PR" comment block
above `SourceDomain` already states the obligation; it gains
`notification.personal_preference.muted_domains` as a fourth location.

## 2. `frontend/packages/apis/src/notification-preferences.ts` (NEW)

A new module beside `notification-status.ts` and `push-tokens.ts`, re-exported
from `index.ts`. Two functions and one type; both go through `rpcCall` and
`notificationClient`, like every other wrapper in the package.

```ts
export interface NotificationPreferences {
  inAppAlertsEnabled: boolean;
  mutedDomains: SourceDomain[];
  dndEnabled: boolean;
  /** "HH:MM", or "" when unset. */
  dndStart: string;
  dndEnd: string;
  updatedAt: Date | null;
  /** False when the server returned defaults because no record is stored. */
  exists: boolean;
}

export function getNotificationPreferences(): Promise<NotificationPreferences>;

/**
 * Replaces the whole record. Callers pass the preferences they read with the
 * one field they are changing, never a partial object — the server writes
 * every field, so an omitted one is written as false/empty.
 */
export function updateNotificationPreferences(
  next: Omit<NotificationPreferences, 'updatedAt' | 'exists'>,
): Promise<NotificationPreferences>;
```

The `Omit` in the update signature is the type system enforcing FR-009: there is
no shape a caller can pass that expresses a partial update.

Errors propagate as the package's existing `ConnectError`-derived errors. No new
error-detail type is introduced — `CodeInvalidArgument` with a message naming
the rejected domain is actionable on its own, and Principle X says to prefer
plain codes when they are.

## 3. `frontend/apps/mobile/src/hooks/use-notification-preferences.ts` (NEW)

One hook, used by exactly two call sites. No context and no provider: the theme
needed one because 98 modules read the palette; this is read twice.

```ts
export interface NotificationPreferencesState {
  /** Defaults until the first successful read. Never null, so callers can render. */
  preferences: NotificationPreferences;
  /** True until the server (or the persisted cache) has answered. */
  loading: boolean;
  /** True while a write is in flight. Disables the section's switches. */
  saving: boolean;
  isMuted(domain: SourceDomain): boolean;
  /** Both resolve when the write settles; both reject nothing — failure is reported via onError. */
  setInAppAlerts(enabled: boolean): Promise<void>;
  setDomainMuted(domain: SourceDomain, muted: boolean): Promise<void>;
}

export function useNotificationPreferences(): NotificationPreferencesState;
```

Behaviour, following the theme toggle's precedent exactly
(`apps/mobile/src/lib/theme.tsx`):

| Aspect | Contract |
|---|---|
| Query key | `["notification-preferences"]`. Persisted by `setupQueryPersistence` and cleared by `resetAuthenticatedAppState` on sign-out, which is what makes US1 scenario 2 (a colleague on the same handset) true without extra code. |
| Optimistic update | `onMutate` cancels in-flight fetches, snapshots the cache and applies the change, so the switch moves on the press (FR-021). |
| Rollback | `onError` restores the snapshot and shows the "Couldn't save that" `Alert` from [settings-copy.md §3](./settings-copy.md). |
| Settle | `onSettled` invalidates the key, so the server's canonical record (deduped, sorted) replaces the optimistic guess. |
| Offline | No queue, no retry beyond React Query's default. A refused write is reported, not deferred (spec assumption). |
| Whole-record write | Both setters read the current cached preferences and send all five fields. There is no code path that sends fewer. |
