# Feature Specification: Production Safety Defaults

**Feature Branch**: `060-production-safety-defaults`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Production safety defaults. Fail startup outside a development profile when SSO audience validation is off, when the JWT signing key is ephemeral, or when CORS allows all origins. All three are logged as dev-only and nothing stops a hosted deployment shipping that way."

## Problem

The server has three convenience defaults that make local development frictionless and a
hosted deployment unsafe. Today each one is a warning line in the startup log and nothing
more:

1. **SSO audience validation is off when no client IDs are configured.** The server
   accepts *any* Google- or Apple-signed identity token regardless of which application it
   was issued for. Anyone holding a token minted for an unrelated app can exchange it for a
   session in this workspace.
2. **The JWT signing key is ephemeral when no key path is configured.** Every session token
   is invalidated on restart, and two replicas of the same deployment sign with different
   keys, so a signed-in person is randomly signed out depending on which replica answers.
3. **CORS allows all origins, unconditionally.** There is no configuration for it at all —
   every deployment, hosted or not, answers cross-origin requests from any website.

All three are logged as "dev only", and a log line is not a control. A deployment can ship
with any combination of them and nothing will say so after the first ten lines of the log
scroll past. The fix is to make the unsafe state unreachable outside an explicitly declared
development profile.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An insecure deployment refuses to serve traffic (Priority: P1)

An operator brings up the server for a real workspace without having configured a durable
signing key, or with cross-origin access left wide open. Instead of starting and logging a
warning nobody reads, the server refuses to start. It exits with a message that lists
*every* problem it found at once — not just the first — and for each one names the setting
to change, what the setting does, and what the current state exposes.

**Why this priority**: This is the whole feature. Without it, the other stories improve a
system that still ships insecurely by default. It is also the slice that alone closes the
"nothing stops a hosted deployment shipping that way" gap.

**Independent Test**: Start the server with the production profile selected and a
deliberately unsafe configuration; confirm it exits non-zero without binding a port, and
that the message names every violation present. Then start it with a safe configuration and
confirm it serves normally.

**Acceptance Scenarios**:

1. **Given** the production profile and no durable signing key configured, **When** the
   server starts, **Then** it exits with a non-zero status, binds no listening port, and
   the failure message names the signing-key setting and states that all sessions would be
   destroyed on restart and would differ between replicas.
2. **Given** the production profile and a cross-origin policy that permits every origin,
   **When** the server starts, **Then** it exits with a non-zero status and the failure
   message names the origin setting and the workspace address the allowed origin is
   normally derived from.
3. **Given** the production profile and an identity provider that is configured for use but
   whose accepted-audience list is empty or contains only blank entries, **When** the server
   starts, **Then** it exits with a non-zero status and the failure message names that
   provider's audience setting.
4. **Given** the production profile and *three* simultaneous violations, **When** the server
   starts, **Then** the failure message describes all three in one report rather than
   failing on the first and hiding the rest.
5. **Given** the production profile and a safe configuration, **When** the server starts,
   **Then** it serves requests exactly as it does today and logs a one-line confirmation of
   which profile is active.
6. **Given** no profile has been declared at all, **When** the server starts, **Then** it is
   treated as production and the checks apply.

---

### User Story 2 - An unconfigured identity provider is refused, not trusted (Priority: P2)

A workspace is signed into with workspace passwords and worker PINs and does not use Google
or Apple sign-in. Today, leaving those providers unconfigured does not disable them — it
disables their *audience check*, so the server still accepts their tokens and just stops
caring which app the token was minted for. After this change, a provider with no configured
audience is simply not an accepted way to sign in: the exchange is refused with a clear
error saying that provider is not enabled for this workspace.

**Why this priority**: This is what makes "audience validation is off" an unreachable state
rather than a state we merely refuse to boot into. It also means a password-and-PIN-only
deployment — a legitimate configuration — is not forced to invent credentials for providers
it does not use just to satisfy story 1.

**Independent Test**: With no audience configured for a provider, attempt to sign in with a
validly signed token from that provider and confirm the attempt is refused with a
provider-not-enabled error rather than succeeding. Confirm password and PIN sign-in are
unaffected.

**Acceptance Scenarios**:

1. **Given** a provider with no configured audiences, **When** someone exchanges a validly
   signed token from that provider, **Then** the exchange is refused with an error that
   identifies the provider as not enabled for this deployment, and no account is created or
   linked.
2. **Given** a provider with configured audiences, **When** someone exchanges a token whose
   audience is not in that list, **Then** the exchange is refused, as it is today.
3. **Given** a provider with no configured audiences, **When** someone signs in with a
   workspace password or a worker PIN, **Then** sign-in succeeds unchanged.
4. **Given** a provider with no configured audiences, **When** an already-signed-in person
   tries to link that provider to their account, **Then** the link is refused with the same
   provider-not-enabled error.
5. **Given** a provider with no configured audiences, **When** the server starts in any
   profile, **Then** it logs which providers are enabled and which are disabled, so a
   missing setting is visible rather than silent.

---

### User Story 3 - The local development loop keeps working and previews the verdict (Priority: P3)

A contributor runs the project's documented development commands and the server starts as
it always has, with the same permissive defaults, because those commands declare the
development profile. The startup log still reports every setting that *would* have failed in
production, as warnings, so the contributor sees the production verdict on their own machine
long before a deploy discovers it.

**Why this priority**: It protects contributor velocity and turns the check into a habit
rather than a deploy-time surprise. It is last because the feature is already correct
without it — this story is about keeping it pleasant.

**Independent Test**: Run the repository's documented backend development command with no
extra configuration and confirm the server starts, permits all origins, and logs the three
would-fail-in-production warnings.

**Acceptance Scenarios**:

1. **Given** the development profile, **When** the server starts with all three unsafe
   defaults active, **Then** it starts normally and logs each one as a warning that names
   the setting and states it would prevent startup in production.
2. **Given** the repository's documented development commands and scripts, **When** a
   contributor uses them without any additional setup, **Then** the development profile is
   selected for them.
3. **Given** the production profile is selected but the configured workspace address is
   still a local development address, **When** the server starts, **Then** it fails, because
   that address is what the allowed cross-origin list is derived from and a local address
   there means no real browser client could ever be allowed.

---

### Edge Cases

- **An explicitly wide-open origin setting in production.** An operator sets the allowed
  origins to the wildcard. This fails startup; the wildcard is only accepted in the
  development profile.
- **An unrecognised profile value.** A typo such as `prod` or `Production` must not be
  silently read as "not development" *or* silently read as development. The server fails
  startup with a message listing the accepted values.
- **Whitespace-only configuration.** An audience list of `","` or an origin list of `" "`
  must be treated as empty, not as a configured value that happens to match nothing.
- **A signing key path that is set but unreadable.** This already fails startup today and
  must continue to; it is a misconfiguration, not a fallback to ephemeral.
- **Health and metrics probes.** Container health probes and the metrics scrape send no
  origin header and must keep working under a restricted cross-origin policy.
- **Native mobile clients.** Native mobile requests carry no origin header; restricting
  origins must not affect them. Only browser clients are constrained.
- **Long-lived streams.** Existing notification streams and streaming calls must keep
  working under the restricted policy for an allowed origin.
- **The metrics listener.** It is reachable on the internal network only and must not
  become unreachable as a side effect of tightening the main listener's policy.

## Requirements *(mandatory)*

### Functional Requirements

**Runtime profile**

- **FR-001**: The system MUST expose exactly one runtime-profile setting with exactly two
  accepted values, one meaning development and one meaning production.
- **FR-002**: The system MUST treat an absent profile setting as production, so that
  forgetting to declare the profile is safe rather than permissive.
- **FR-003**: The system MUST refuse to start when the profile setting holds a value that is
  neither accepted value, and the failure message MUST list the accepted values.
- **FR-004**: The system MUST log the active profile once at startup, at a level that is
  visible in default production logging.
- **FR-005**: The repository's documented development entry points MUST select the
  development profile without requiring the contributor to configure anything.
- **FR-006**: The deployment configuration and its example file MUST declare the production
  profile explicitly, so an operator reading it can see the profile exists.

**Startup safety report**

- **FR-007**: The system MUST evaluate every safety check at startup before binding any
  listening port, in every profile.
- **FR-008**: In the production profile, the system MUST refuse to start if any safety check
  fails, exiting with a non-zero status and binding no port.
- **FR-009**: In the development profile, the system MUST start despite failing checks and
  MUST log each failing check as a warning that names the setting and states that it would
  prevent startup in production.
- **FR-010**: The system MUST report every failing check in a single message rather than
  aborting on the first, so one restart surfaces the complete list of work.
- **FR-011**: Each reported violation MUST name the specific setting to change, describe
  what the current state exposes, and state what a correct value looks like — enough for an
  operator to fix it without reading source code.
- **FR-012**: The safety report MUST NOT include the value of any secret in its output.

**Check: durable signing key**

- **FR-013**: The system MUST fail the signing-key check in the production profile when no
  durable signing key is configured and a per-process key would be generated instead.
- **FR-014**: The violation message MUST state that sessions would not survive a restart and
  would not be accepted across replicas.
- **FR-015**: A configured-but-unreadable or invalid key MUST continue to fail startup in
  every profile, including development, because it is a mistake rather than an opt-out.

**Check: cross-origin policy**

- **FR-016**: The system MUST derive its allowed browser origins for the production profile
  from configuration rather than permitting every origin.
- **FR-017**: The system MUST fail the cross-origin check in the production profile when the
  effective policy would permit every origin, including when a wildcard is configured
  explicitly.
- **FR-018**: The system MUST fail the cross-origin check in the production profile when the
  configured workspace address — the source of the default allowed origin — is absent or is
  a loopback or local development address.
- **FR-019**: The system MUST allow an operator to declare additional allowed origins beyond
  the workspace address, for deployments serving more than one browser origin.
- **FR-020**: In the development profile, the system MUST keep permitting every origin, so
  that local web and Expo web clients on arbitrary ports keep working.
- **FR-021**: Requests carrying no origin header — native mobile clients, health probes,
  metrics scrapes, server-to-server calls — MUST be unaffected by the restricted policy.
- **FR-022**: Streaming and long-lived responses MUST keep working for an allowed origin
  under the restricted policy.

**Check: SSO audience validation**

- **FR-023**: The system MUST treat an identity provider with no configured accepted
  audiences as **not enabled**, and MUST refuse any token exchange or identity link for that
  provider, in every profile.
- **FR-024**: The refusal MUST carry an error that identifies the provider as not enabled
  for this deployment, distinguishable by a client from "this token was rejected".
- **FR-025**: The system MUST NOT accept a token from any identity provider without checking
  its audience against a configured list, in any profile. There is no longer a state in
  which a provider is accepted with the audience check skipped.
- **FR-026**: The system MUST fail the audience check at startup in the production profile
  when a provider is configured but its audience list resolves to no usable entries — for
  example a list of blank or whitespace-only values.
- **FR-027**: The system MUST log, once at startup, which identity providers are enabled and
  which are disabled for lack of configured audiences.
- **FR-028**: Workspace-password and worker-PIN sign-in MUST be unaffected by identity
  providers being disabled; a deployment using neither Google nor Apple MUST start and
  operate normally in the production profile.

**Documentation**

- **FR-029**: The living domain documentation MUST be updated to describe the profile, the
  three checks, and the new meaning of an unconfigured identity provider, and MUST delete
  the statements that describe these as warnings that "must not ship that way".
- **FR-030**: The deployment example configuration MUST document each setting the checks
  read, including what happens when it is left unset.

### Key Entities

- **Runtime profile**: A single declared value stating whether this process is a developer's
  machine or a real deployment. Absent means production. It is the only input that decides
  whether a failing safety check is fatal.
- **Safety check**: A named startup-time assertion about configuration, with a verdict
  (pass/fail), the setting it reads, a description of what failure exposes, and guidance on
  a correct value. Three exist at introduction: durable signing key, restricted cross-origin
  policy, and enforced SSO audience validation.
- **Startup safety report**: The complete set of check verdicts for this process, emitted
  once as a single message. Fatal in production if it contains any failure; informational in
  development.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A deployment configured with any of the three unsafe defaults and no
  development profile declared serves zero requests — the process exits before a port is
  bound.
- **SC-002**: An operator presented with the startup failure can identify and correct every
  flagged setting using only the failure message, without opening source code or searching
  documentation.
- **SC-003**: An operator fixing a fully misconfigured deployment learns about all three
  problems from one start attempt, not three.
- **SC-004**: A contributor following the repository's documented setup runs the backend
  locally with zero additional configuration steps compared to today.
- **SC-005**: No token issued by an external identity provider is accepted for any audience
  the deployment has not declared, in any profile — verified by a test that presents a
  correctly signed token with a foreign audience and observes refusal.
- **SC-006**: A deployment that uses only workspace passwords and worker PINs starts and
  operates normally under the production profile with no identity-provider configuration.
- **SC-007**: Browser requests from the deployment's own workspace address continue to
  succeed, including long-lived notification streams; requests from an unlisted origin are
  refused by the browser.
- **SC-008**: The living domain documentation contains no remaining claim that these three
  settings are enforced only by a log line.

## Assumptions

- [ASSUMPTION: The profile is a single new environment setting rather than being inferred
  from an existing signal such as the presence of a TLS certificate or a hostname. Inferring
  it would make the security posture depend on an unrelated value and would be hard for an
  operator to reason about. A single explicit declaration is the industry-standard shape and
  the easiest to test.]
- [ASSUMPTION: The default when the profile is undeclared is **production**, not
  development. Secure-by-default is the point of the feature; a default of development would
  reproduce exactly today's failure mode, where the unsafe state is the one you get by not
  thinking about it. The cost is that a contributor invoking the server binary directly,
  outside the documented commands, now sees a startup failure — which is acceptable because
  the message names the one setting to add, and the documented commands (per the
  project's convention of using supported tooling) are updated to declare the profile.]
- [ASSUMPTION: Exactly two profile values exist. A third value such as "staging" or "test"
  is not introduced, because every non-development deployment should hold to the same
  standard and a third value would immediately raise the question of which checks it
  relaxes. A staging deployment declares production.]
- [ASSUMPTION: An identity provider with no configured audiences is treated as **disabled**
  rather than as a startup failure. Failing startup would block a legitimate
  password-and-PIN-only deployment from ever booting, and disabling is strictly safer than
  today's behaviour of accepting the provider's tokens with no audience check. This also
  aligns the backend with the mobile client, which already decides a provider's availability
  from whether its client identifier is present. The literal reading of the request — "fail
  startup when SSO audience validation is off" — is honoured in the sense that matters: in
  the production profile there is no reachable state in which a provider is accepted without
  audience validation. The remaining startup failure covers the misconfiguration case, where
  a provider is configured but its audience list resolves to nothing usable.]
- [ASSUMPTION: The production allowed-origin list is derived from the already-configured
  workspace address, with an optional additional-origins setting for deployments serving
  more than one browser origin. Reusing the existing address avoids a second place to state
  the same hostname and means an existing deployment needs no new configuration to pass the
  check.]
- [ASSUMPTION: The production check on the workspace address rejects loopback and local
  development addresses. That default value is itself a dev-only leak of the same class as
  the other three, and it is load-bearing here because it is the source of the allowed
  origin — a production deployment that still holds it would allow no real browser client
  at all. It is therefore treated as part of the cross-origin check rather than as separate
  scope.]
- [ASSUMPTION: The development profile keeps permitting all origins rather than listing
  localhost ports. Local web, Expo web, and device-LAN-IP clients use arbitrary and changing
  origins, and constraining them would break the documented cross-platform development
  commands for no security benefit on a developer's machine.]
- [ASSUMPTION: Other dev-only fallbacks in the same family — notably the voice service's
  default development credentials, and push notifications being silently disabled without
  credentials — are **out of scope**. The request named three checks. The report is designed
  to take further checks without restructuring, and adding those is a natural follow-up.]
- [ASSUMPTION: No backward-compatibility path is provided for a deployment relying on the
  permissive behaviour. The project is in early development and all clients ship together,
  so this lands as one coordinated breaking change. This is a breaking change for any
  existing deployment that has not configured a durable signing key, a real workspace
  address, or identity-provider audiences.]
- [ASSUMPTION: Existing deployments already configure a durable signing key and a real
  workspace address through the deployment stack, so the practical migration burden is
  limited to declaring the profile and, for deployments using Google or Apple sign-in,
  populating the audience lists that were previously optional.]
