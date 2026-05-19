# Gym Ownership — Web App Implementation Plan

**Date:** 2026-05-18
**Status:** Draft v2 — all open questions resolved by API team on 2026-05-16; ready to start.
**Audience:** FitEpic.WebApp team
**Companion docs:**
- `FitEpic.Api/readmes/gym-ownership-requirements.md` — product requirements
- `FitEpic.Api/readmes/gym-ownership-webapp-contract.md` — living API contract for the web app

---

## Scope

Implement the web-app side of the Gym → Training Group → Athlete model described in the requirements + contract. The web app is desktop-first and skewed toward gym administration (Owner / Admin / Coach workflows), but also implements the athlete-facing flows (join a gym, accept invites, view scheduled workouts).

The plan is sequenced so each phase ships a usable slice and can be QA'd against a real dev API instance before moving on. Phases 2–6 are the core delivery; phases 0/1/7/8 are scaffolding and cleanup.

---

## Resolutions baked into this plan (from contract §12, 2026-05-16)

- **Q1 — Error envelope.** `GymErrorResponse { code, error }` stays. Web app builds a small adapter normalizing the three shapes (`GymErrorResponse`, `WebAppErrorEnvelope`, `ParseWorkoutErrorResponse`) into one internal type.
- **Q2 — Endpoint prefix.** No `/api/webapp/...` mirror for the gym surface. Consume `/api/gyms/...` directly.
- **Q3 — Athlete lookup.** No lookup endpoint will be built (account-enumeration concern). Invite is by `Email`, response is **always 202 Accepted with an identical body** whether the email resolves or not. UI must not show "user not found" — echo the email and let the user send.
- **Q4 — Gym workouts response.** `List<WorkoutResponse>` with new `GymId` and `IsArchived` fields. Default excludes archived + soft-deleted; admin backdoor via `?includeArchived=true` / `?includeDeleted=true`. No pagination today.
- **Q5 — Date filtering.** `GET /api/mobile/scheduled-workouts` accepts optional `from: DateOnly?` / `to: DateOnly?`. Use these for the calendar view.
- **Q6 — Archive + delete semantics.** Workouts gain `IsArchived` (toggle via the same sync endpoint; never blocked). Soft-delete on a gym workout is **rejected per-row with `"BlockedByHistory"`** if any `ScheduledWorkout` with `Status == Completed` references it. When delete is allowed, server cascade-soft-deletes non-completed scheduled instances in the same transaction. New invariant: a `ScheduledWorkout` sync row with non-null `ScoreResult` must have `Status == Completed`.
- **Q7 — Invite accept reconciliation.** In-place update preserves `Id` when the invitee already holds a lower-role active membership — **but** if the prior membership was soft-deleted (athlete previously left), accept issues a new `Id`. Reconcile defensively by `(GymId, AthleteId)`, not by `Id`.
- **Q8 — Idempotency keys on other mutating endpoints.** Not added. Web app guards with disable-on-pending in the UI for every mutating call.
- **Q9 — Stale projected names.** Re-fetch `GET /api/gyms/{gymId}/members`. No special endpoint.

---

## Phase 0 — Foundation

Set up the generated client and shared plumbing every later phase depends on.

- [x] Confirm API team has shipped Phase A–E of their implementation plan and `swagger.json` renders cleanly.
- [x] Run `npm run gen:api` against the updated swagger; review the diff in `src/app/core/api/generated/`.
- [x] Refactor [error-code.ts](../fitepic-web-app/src/app/core/api/error-code.ts) into a unified error adapter:
  - [x] Define an internal `NormalizedApiError { code: string | null, message: string | null }` type.
  - [x] Parse `GymErrorResponse` (flat `{ code, error }`), `WebAppErrorEnvelope` (nested `{ error: { code, message } }`), and `ParseWorkoutErrorResponse` into the same shape.
  - [x] Export `getApiErrorCode(err)` / `getApiErrorMessage(err)` as the single callsite for all consumers; keep the legacy helpers as thin wrappers during migration.
- [x] Add `GymRole` enum + `GymRoleService` under `src/app/core/gyms/`:
  - [x] Combines `Gym.OwnerAthleteId` (Owner has no membership row) and `GymMembership.Role` to return `Owner | Admin | Coach | Athlete | null`.
  - [x] Exposes `signal<Record<gymId, GymRole>>` keyed by gym for components to read reactively.
- [x] Add `GymsService` under `src/app/core/gyms/` as the thin RxJS wrapper over the generated `Gyms` service (mirroring `ProfileService` style).
- [x] Add a shared `gymErrorSnackbar()` helper that maps stable codes from [contract §5.9](../../FitEpic.Api/readmes/gym-ownership-webapp-contract.md) to user-facing toasts.
- [x] Add a small `disableOnPending` directive or signal utility for use on every mutating button (no server-side idempotency per Q8 — UI guards against double-submit).

---

## Phase 1 — Profile flag (`IsGymOwner`)

Unlock gym-management UI for the caller.

- [x] Extend [`MyAthleteProfileResponse`](../fitepic-web-app/src/app/core/api/generated/models/) handling in [ProfileService](../fitepic-web-app/src/app/core/profile/profile.service.ts) to read `IsGymOwner` (resolved by Q10 — field added to the profile response).
- [x] Add an "Enable gym ownership" toggle in [settings-page](../fitepic-web-app/src/app/features/settings/settings-page.ts):
  - [x] Calls `PUT /api/gyms/me/owner-flag` via the generated client.
  - [x] Optimistic update with rollback on failure.
- [x] Handle `GymsStillOwned` error: surface the server message in a snackbar with a "Manage gyms" action that links to `/gyms`.
- [x] Add a global "gym ownership required" interceptor / error handler:
  - [x] When any gym-domain call returns `NotGymOwner` (403), surface a snackbar that links to the settings toggle.
- [ ] Smoke test: toggle on → confirm gyms UI unlocks; toggle off while owning → confirm error UX.

---

## Phase 2 — Gym CRUD + navigation skeleton

Top-level gyms surface and the per-gym shell every other phase plugs into.

- [x] Update [nav-items.ts](../fitepic-web-app/src/app/layout/admin-shell/nav-items.ts):
  - [x] Replace the `/programming` placeholder with `/gyms` ("Gyms", icon `fitness_center`).
  - [x] Keep `/connections` and `/activity` (peer-driven per contract §7.5).
- [x] Add routes in [app.routes.ts](../fitepic-web-app/src/app/app.routes.ts):
  - [x] `/gyms` → `GymsListPage`
  - [x] `/gyms/:gymId` → `GymDetailShell` with child routes for each tab
  - [x] Child routes: `overview`, `members`, `groups`, `requests`, `invites`, `workouts`, `schedule`
- [x] Build `GymsListPage` with role-badge card grid and "Create gym" FAB gated on `IsGymOwner`.
- [x] Build `CreateGymDialog`.
- [x] Build `GymDetailShell` with role-gated tab strip.
- [x] Build `OverviewTab` with gym details, edit/rotate/delete actions.
- [x] Build `EditGymDialog`.
- [x] Build rotate-code action with reminder copy and visual highlight on the new code.
- [x] Build `DeleteGymDialog` with type-the-name confirmation.
- [ ] Manual QA: create a gym, edit it, rotate code, delete it. Verify role badges.

---

## Phase 3 — Membership management

Roster, role changes, removal, leaving.

- [x] Build `MembersTab` (Coach/Admin/Owner only — Athletes get an inline "Only gym staff can see the member roster" message):
  - [x] `GET /api/gyms/{gymId}/members`.
  - [x] Table: `AthleteDisplayName`, `AthleteEmail`, `Role`, `JoinedAt`, actions.
  - [x] Owner rendered at the top from `Gym.OwnerAthleteId` (not in the membership list).
- [x] Role change UX with hide-unavailable-transitions per role.
- [x] Remove member UX with confirmation dialog; Owner-only to remove Admin.
- [x] Leave-gym action surfaced as a row-level menu item on the caller's own row.
- [x] Error codes wired via `showGymError` helper (`RoleChangeBlocked`, `RemovalBlocked`, `OwnerCannotLeave`, `InsufficientRole`, `NotOwner`).
- [ ] Manual QA across roles: try every transition, confirm UI hides unauthorized actions and shows correct errors when forced.

---

## Phase 4 — Join requests + invites

Both the staff-side queues and the athlete-side inboxes.

### Athlete-initiated requests

- [x] Build `JoinGymPage` at `/gyms/join` with code entry + role selector, idempotent submit, error handling.
- [x] Athlete-side requests/invites combined into a single `MyInboxPage` at `/gyms/my-inbox` with cancel for pending requests.

### Staff-side requests queue

- [x] Build `RequestsTab` (Admin/Owner only) with status filter, approve/deny actions, optimistic row updates.

### Owner/Admin-initiated invites

- [x] Build `SendInviteDialog` — email-only input, no picker, no "user not found" UX (per Q3).
- [x] Build `InvitesTab` with status filter, send-invite button, revoke action. Reloads outbox after send rather than relying on response (per Q3 — response is intentionally identical for known/unknown emails).
- [x] Athlete-side invite accept reloads `gyms`/`memberships` and navigates to the gym; reject/cancel update in place.

### Dashboard surfacing

- [x] "My inbox" entry-point added to the gyms list header.
- [ ] Per-gym "Pending requests (n)" badge on the gyms list — deferred to Phase 8 (would require N extra API calls; better implemented behind a single aggregate endpoint or accepted as a lazy fetch on hover).

---

## Phase 5 — Training groups

CRUD plus rosters.

- [x] Build `GroupsTab` (visible to all gym members; mutation actions gated to Admin/Owner) with card grid + new-group/edit/delete actions.
- [x] Build shared `TrainingGroupDialog` (create + edit modes).
- [x] Delete confirmation via `ConfirmActionDialog` noting upcoming scheduled workouts are cleared.
- [x] Build `GroupDetail` sub-route with roster table, assign-member picker (filters out already-assigned), remove action with retention note.
- [ ] Surface "assigned-since" hint when explaining why a backdated scheduled workout doesn't appear — deferred to Phase 8 / scheduling UI in Phase 6.

---

## Phase 6 — Workout authoring + scheduling

The core programming flow.

### Library + authoring

- [x] Build `WorkoutsTab` with `GET /api/gyms/{gymId}/workouts`, "Show archived" toggle, role-gated author button.
- [x] Build minimal `CreateGymWorkoutDialog` (name / type / instructions / raw text). Full exercise editing deferred — the dialog explains that exercises round-trip through the mobile authoring flow for now.
- [x] Submit via single-row batch through `GymsService.syncWorkout` (`POST /api/mobile/workouts/sync` with `gymId`). Per-row `Forbidden` resolution handled.

### Archive + delete

- [x] Archive / Restore action via the same sync endpoint with `isArchived` toggled. Never blocked.
- [x] Delete action with explicit warning copy. `BlockedByHistory` per-row resolution → follow-up "Archive instead" dialog.
- [ ] Surface the "Removed N upcoming scheduled instances" count on successful delete — the sync response shape doesn't carry that count; deferred to a polish pass.

### Scheduling

- [ ] **Blocked on contract Q11.** The current `ScheduledWorkoutRequest` schema still has `athleteId` as `required` and no `trainingGroupId` field. The endpoint description references group scheduling but the schema doesn't yet match. Filed as Q11; `ScheduleTab` ships as a placeholder explaining the wait.
- [ ] Once Q11 lands and the schema is updated: build calendar fetch using `from`/`to`, `ScheduleWorkoutDialog`, lock-state rendering, ScoreResult invariant audit.
- [ ] Audit [features/dashboard](../fitepic-web-app/src/app/features/dashboard/) for callsites that assume `AthleteId` is non-null once `ScheduledWorkoutResponse.athleteId` is consumed for nullable scheduling.

### Manual QA (deferred until Q11)

- [ ] Author a workout → archive → verify hidden from default view.
- [ ] Try to delete a workout with completed history → confirm `BlockedByHistory` UX → "Archive instead" → succeed.
- [ ] Delete a workout with only pending instances once scheduling lands.

---

## Phase 7 — Cleanup of removed surface

Tear down the legacy coach→athlete UI.

- [x] Search for any UI offering `ProgramWorkouts` as a connection-invite permission — **none found**. App code never surfaced the enum. The generated `ConnectionPermissionLevel` will narrow when the API team removes it in their Phase K; no web-app action required.
- [x] Search for callsites of `GET /api/athletes/{id}/scheduledworkouts` — **none in app code**. The stale generated client file was already removed in Phase 0.
- [x] Activity feed copy reviewed — no references to coach-scheduled relationships; feed text is peer-driven and reads correctly under the new model.

---

## Phase 8 — Polish + hardening

- [x] Loading / empty / error states baked into every Phase 2–6 tab and page.
- [x] Snackbar wiring via `showGymError` covers every stable error code from contract §5.9.
- [x] Update [README.md](../fitepic-web-app/README.md) with a Gyms section linking to this plan and noting deferred items.
- [ ] Responsive checks at common viewport widths — deferred to manual review once a real reviewer can exercise the UI.
- [ ] Accessibility pass — deferred to manual review.
- [ ] Per-gym pending-request badges on the gyms list — deferred (needs aggregate endpoint or N+1 fetch).
- [ ] Manual QA pass against a dev API instance:
  - [ ] Owner happy path: create gym → invite member → create group → schedule workout (once Q11 lands) → verify athlete sees it.
  - [ ] Athlete happy path: join via code → accept invite → see scheduled workouts.
  - [ ] Error path: every code in §5.9 surfaces correctly.

## Change log

- **2026-05-19 — v3.** Phases 0–5 + 7 complete; Phase 6 partial (library + archive/delete live, group scheduling deferred to Q11); Phase 8 polish landed README + error wiring, manual QA + responsive/a11y still to do.

---

## Out of scope (per contract §10)

- Notifications service (refresh on navigation).
- Ownership transfer.
- Gym search/discovery (code-only join).
- Per-group coach scoping.
- Multi-gym scheduling conflict surfacing.
- Gym-internal social feed.
- Dedicated web-app REST verbs for workout/scheduled-workout writes — we use `/api/mobile/...` single-row batches for now.

---

## Change log

- **2026-05-16 — v1 draft.** Initial phased plan pending resolution of contract §12 questions.
- **2026-05-18 — v2.** API team resolved Q1–Q9 on 2026-05-16. Plan updated:
  - Phase 0: error-envelope step collapsed into a single normalization adapter (Q1); added `disableOnPending` utility (Q8).
  - Phase 4: invite UX rewritten — email-only input, no picker, no "user not found" feedback (Q3); accept reconciliation by `(GymId, AthleteId)` not `Id` (Q7).
  - Phase 6: added `IsArchived` library toggle and archive action; rewrote delete flow to handle the `BlockedByHistory` per-row resolution and offer "Archive instead"; switched calendar fetch to use `from`/`to`; noted the new `ScoreResult` ⇒ `Status == Completed` server invariant (Q4/Q5/Q6).
  - Status flipped from "pending" to "ready to start".
