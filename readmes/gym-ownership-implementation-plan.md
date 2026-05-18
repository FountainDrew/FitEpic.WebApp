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

- [ ] Extend [`MyAthleteProfileResponse`](../fitepic-web-app/src/app/core/api/generated/models/) handling in [ProfileService](../fitepic-web-app/src/app/core/profile/profile.service.ts) to read `IsGymOwner` (auto-generated after regen, but verify the field exists).
- [ ] Add an "Enable gym ownership" toggle in [settings-page](../fitepic-web-app/src/app/features/settings/settings-page.ts):
  - [ ] Calls `PUT /api/gyms/me/owner-flag` via the generated client.
  - [ ] Optimistic update with rollback on failure.
- [ ] Handle `GymsStillOwned` error: render the gym IDs returned and offer a "Manage gyms" link.
- [ ] Add a global "gym ownership required" interceptor / error handler:
  - [ ] When any gym-domain call returns `NotGymOwner` (403), surface a modal/snackbar that links to the settings toggle.
- [ ] Smoke test: toggle on → confirm gyms UI unlocks; toggle off while owning → confirm error UX.

---

## Phase 2 — Gym CRUD + navigation skeleton

Top-level gyms surface and the per-gym shell every other phase plugs into.

- [ ] Update [nav-items.ts](../fitepic-web-app/src/app/layout/admin-shell/nav-items.ts):
  - [ ] Replace the `/programming` placeholder with `/gyms` ("Gyms", icon `fitness_center`).
  - [ ] Decide on `/connections` and `/activity` fate (likely keep — they remain peer-driven per contract §7.5).
- [ ] Add routes in [app.routes.ts](../fitepic-web-app/src/app/app.routes.ts):
  - [ ] `/gyms` → `GymsListPage`
  - [ ] `/gyms/:gymId` → `GymDetailShell` with child routes for each tab
  - [ ] Child routes: `overview`, `members`, `groups`, `requests`, `invites`, `workouts`, `schedule`
- [ ] Build `GymsListPage`:
  - [ ] `GET /api/gyms?role=member` (single call covers owner+member union per contract).
  - [ ] Card grid with gym name, code, role badge, member count placeholder.
  - [ ] "Create gym" FAB visible only when `IsGymOwner = true`.
- [ ] Build `CreateGymDialog`:
  - [ ] Form: `Name` (required, 1–100), `Description` (optional).
  - [ ] `POST /api/gyms` → navigate to gym detail on success.
  - [ ] Handle `NotGymOwner` with the global handler.
- [ ] Build `GymDetailShell`:
  - [ ] Tab strip with role-gated tabs (Athletes see fewer tabs — see Phase 3).
  - [ ] Header: gym name, code (with rotate-code button for Admin/Owner), settings menu.
- [ ] Build `OverviewTab`:
  - [ ] Gym metadata (name, description, code, created).
  - [ ] Pending requests count (Admin/Owner only).
  - [ ] Member count, group count.
- [ ] Build `EditGymDialog` (Admin/Owner only):
  - [ ] `PATCH /api/gyms/{id}` with name/description.
- [ ] Build `RotateCodeAction` (Admin/Owner only):
  - [ ] `POST /api/gyms/{id}/regenerate-code` → show new code + reminder that pending requests still work with the old code.
- [ ] Build `DeleteGymDialog` (Owner only):
  - [ ] Strong confirmation (type gym name).
  - [ ] `DELETE /api/gyms/{id}` → navigate back to `/gyms`.
- [ ] Manual QA: create a gym, edit it, rotate code, delete it. Verify role badges.

---

## Phase 3 — Membership management

Roster, role changes, removal, leaving.

- [ ] Build `MembersTab` (Coach/Admin/Owner only — Athletes get a friendly "not authorized" inline message per contract):
  - [ ] `GET /api/gyms/{gymId}/members`.
  - [ ] Table: `AthleteDisplayName`, `AthleteEmail`, `Role`, `JoinedAt`, actions.
  - [ ] Note: Owner is NOT in this list — fetch the gym separately and render the Owner row at the top from `Gym.OwnerAthleteId`.
- [ ] Role change UX (Admin/Owner):
  - [ ] `PATCH /api/gyms/{gymId}/members/{athleteId}` with new role.
  - [ ] Admin can swap Athlete↔Coach; Owner can also grant/revoke Admin.
  - [ ] Hide unavailable transitions per role.
- [ ] Remove member UX (Admin/Owner):
  - [ ] `DELETE /api/gyms/{gymId}/members/{athleteId}` with confirmation.
  - [ ] Owner-only to remove an Admin.
- [ ] Leave-gym action (any member except Owner):
  - [ ] `POST /api/gyms/{gymId}/leave` from the gym detail header menu.
  - [ ] Handle `OwnerCannotLeave` (Owner sees a "delete the gym instead" hint).
- [ ] Wire error codes: `RoleChangeBlocked`, `RemovalBlocked`, `OwnerCannotLeave`, `InsufficientRole`, `NotOwner`.
- [ ] Manual QA across roles: try every transition, confirm UI hides unauthorized actions and shows correct errors when forced.

---

## Phase 4 — Join requests + invites

Both the staff-side queues and the athlete-side inboxes.

### Athlete-initiated requests

- [ ] Build `JoinGymPage` (or dialog) at `/gyms/join`:
  - [ ] Code entry + role selector (`Athlete` or `Coach` — `Admin` is rejected with 403 per contract).
  - [ ] `POST /api/gyms/join-requests` with a client-generated UUID for idempotency.
  - [ ] Handle `JoinRequestDuplicate`, `JoinRequestAlreadyMember`, `AdminNotRequestable`.
- [ ] Build `MyRequestsList` (on settings page or a dedicated `/gyms/my-requests`):
  - [ ] `GET /api/athletes/me/gym-join-requests`.
  - [ ] Show status badge; allow cancel for Pending rows (`POST /api/gyms/join-requests/{id}/cancel`).

### Staff-side requests queue

- [ ] Build `RequestsTab` (Admin/Owner only) on gym detail:
  - [ ] `GET /api/gyms/{gymId}/join-requests?status=Pending` (default), with filter toggle for all statuses.
  - [ ] Row: requester display name + email, requested role, created date.
  - [ ] Approve action: `POST /api/gyms/join-requests/{id}/approve` → use the returned `Membership` to optimistically prepend to the Members tab cache.
  - [ ] Deny action: `POST /api/gyms/join-requests/{id}/deny`.
  - [ ] Handle `JoinRequestNotPending`.

### Owner/Admin-initiated invites

- [ ] Build `SendInviteDialog`:
  - [ ] **Email input only** — no athlete picker, no "user not found" feedback (per Q3 — account-enumeration concern).
  - [ ] Offered role selector (`Athlete | Coach | Admin`; `Admin` shown only to Owner).
  - [ ] `POST /api/gyms/{gymId}/invites` with `{ Email, OfferedRole }`.
  - [ ] Success UX: confirm "Invite sent to {email}" on 202; **do not** branch UI on whether the address resolved server-side.
  - [ ] Surface the typed email in the outbox even if the invitee never appears (silent drops are by design).
  - [ ] Handle `InviteDuplicate`, `InviteAlreadyMember`, `InsufficientRole`, `NotOwner`.
- [ ] Build `InvitesTab` (Admin/Owner only) on gym detail:
  - [ ] `GET /api/gyms/{gymId}/invites?status=Pending` (default), with status filter.
  - [ ] Revoke action: `POST /api/gyms/invites/{id}/revoke`.
- [ ] Build `MyInvitesList`:
  - [ ] `GET /api/athletes/me/gym-invites`.
  - [ ] Accept: `POST /api/gyms/invites/{id}/accept` → reconcile the returned `Membership` into `/gyms?role=member` cache **by `(GymId, AthleteId)`, not by `Id`** (per Q7 — re-invite after a soft-deleted past membership issues a new row).
  - [ ] Reject: `POST /api/gyms/invites/{id}/reject`.
  - [ ] Handle `InviteNotPending`.

### Dashboard surfacing

- [ ] Add a "Pending invites (n)" badge to the admin shell user menu, polled on relevant navigation events (no notifications service per contract §10).
- [ ] Add a "Pending requests (n)" badge per gym on the gyms list, for caller's gyms with admin rights.

---

## Phase 5 — Training groups

CRUD plus rosters.

- [ ] Build `GroupsTab` on gym detail (visible to all gym members; mutation actions gated to Admin/Owner):
  - [ ] `GET /api/gyms/{gymId}/groups`.
  - [ ] Card list with name, description, member count, actions.
- [ ] Build `CreateTrainingGroupDialog` (Admin/Owner): `POST /api/gyms/{gymId}/groups`.
- [ ] Build `EditTrainingGroupDialog` (Admin/Owner): `PATCH /api/gyms/{gymId}/groups/{groupId}`.
- [ ] Build `DeleteTrainingGroupDialog` (Admin/Owner): `DELETE /api/gyms/{gymId}/groups/{groupId}` with confirmation noting that upcoming group-targeted scheduled workouts are cleared.
- [ ] Build `GroupDetailDrawer` or sub-route:
  - [ ] `GET /api/gyms/{gymId}/groups/{groupId}/members`.
  - [ ] Roster table with `AthleteDisplayName`, `AthleteEmail`, `AssignedAt`.
  - [ ] Assign athlete action (Admin/Owner): picker of gym members not yet in the group → `POST .../members` with `AthleteId`.
  - [ ] Remove athlete action (Admin/Owner): `DELETE .../members/{athleteId}` with confirmation noting they lose upcoming scheduled workouts but keep completed ones.
- [ ] Note in the UI when an athlete was assigned recently — backdated scheduled workouts will not appear (mid-flight rule, contract §4.6).

---

## Phase 6 — Workout authoring + scheduling

The core programming flow.

### Library + authoring

- [ ] Build `WorkoutsTab` on gym detail (visible to all gym members; author/edit gated to Coach/Admin/Owner):
  - [ ] `GET /api/gyms/{gymId}/workouts` to list the gym's workout library. Response is `List<WorkoutResponse>` with `GymId` and `IsArchived` populated.
  - [ ] By default the list excludes archived + soft-deleted rows. Add a "Show archived" toggle (Admin/Owner only) that re-fetches with `?includeArchived=true`. A "Show deleted" toggle behind the same admin gate uses `?includeDeleted=true`.
- [ ] Build `AuthorWorkoutPage` (Coach/Admin/Owner):
  - [ ] Reuse the existing workout authoring components if possible; otherwise scaffold fresh.
  - [ ] Submit via single-row batch to `POST /api/mobile/workouts/sync` with `GymId` set on the row.
  - [ ] Handle per-row `Forbidden` from the sync response shape.

### Archive + delete

- [ ] Build `ArchiveWorkoutAction` (Coach/Admin/Owner):
  - [ ] Single-row batch to `POST /api/mobile/workouts/sync` with `IsArchived: true` (or `false` to restore).
  - [ ] Never blocked. Archived workouts still resolve in historical scheduled-workout references.
  - [ ] After success, remove the row from the default library view (it remains accessible via "Show archived").
- [ ] Build `DeleteWorkoutDialog` (Coach/Admin/Owner) with explicit warning copy:
  - [ ] Confirm copy: "Delete this workout? Any scheduled instances that haven't been completed will also be removed. If athletes have already completed a session of this workout, the delete will be blocked — archive it instead."
  - [ ] Submit via single-row batch to `POST /api/mobile/workouts/sync` with `IsDeleted: true`.
  - [ ] If the per-row resolution comes back `"BlockedByHistory"`: show a follow-up dialog offering "Archive instead" (one click → re-submit with `IsArchived: true`).
  - [ ] On success, surface the cascade: "Removed N upcoming scheduled instances."

### Scheduling

- [ ] Build `ScheduleTab` on gym detail (Coach/Admin/Owner author; all gym members can read their visibility slice):
  - [ ] `GET /api/mobile/scheduled-workouts?from=<startOfView>&to=<endOfView>` scoped to the visible calendar window.
  - [ ] Filter client-side to the current gym's groups + own personal rows.
  - [ ] Calendar view (month/week) with each row tagged by group.
- [ ] Build `ScheduleWorkoutDialog`:
  - [ ] Pick group, workout (from gym library — exclude archived/deleted), date.
  - [ ] Submit via single-row batch to `POST /api/mobile/scheduled-workouts/sync` with `TrainingGroupId`, `WorkoutId`, `ScheduledDate`, `AthleteId = null`.
  - [ ] **Never set `ScoreResult` on a non-completed row** — the server now enforces "non-null `ScoreResult` ⇒ `Status == Completed`" and rejects violators per-row. The scheduling dialog only ever creates `Pending` rows so this is implicit; flag in code review if any future scheduling path tries to seed a score.
  - [ ] Reflect `IsLocked = true` returned on group rows (display as read-only after creation).
- [ ] Update any existing scheduled-workout rendering to handle nullable `AthleteId` + new `TrainingGroupId`:
  - [ ] Audit [features/dashboard](../fitepic-web-app/src/app/features/dashboard/) for callsites that assume `AthleteId` is non-null.
- [ ] Manual QA:
  - [ ] Author a workout → schedule it for a group → verify it appears for athletes in the group on next fetch; verify coaches/admins/owner see it via implicit participation.
  - [ ] Archive a workout → verify it disappears from the default library view, still resolves in historical references.
  - [ ] Try to delete a workout that has a completed scheduled instance → verify `BlockedByHistory` UX → choose "Archive instead" → verify archive succeeds.
  - [ ] Delete a workout with only pending instances → verify cascade-soft-delete count is correct.

---

## Phase 7 — Cleanup of removed surface

Tear down the legacy coach→athlete UI.

- [ ] Search for any UI that offers `ProgramWorkouts` as a connection-invite permission:
  - [ ] Audit [features](../fitepic-web-app/src/app/features/) and any uses of [connection-permission-level](../fitepic-web-app/src/app/core/api/generated/models/connection-permission-level.ts).
  - [ ] Remove the option from any selectors; the enum will go to single-value-or-deleted per API Phase K.
- [ ] Remove any callsite of `GET /api/athletes/{id}/scheduledworkouts` (deleted server-side per contract §7.1):
  - [ ] Check [athletes-id-scheduledworkouts-get.ts](../fitepic-web-app/src/app/core/api/generated/fn/scheduled-workouts/athletes-id-scheduledworkouts-get.ts) callers.
  - [ ] Replace with `GET /api/mobile/scheduled-workouts` (server-side union covers coach visibility now).
- [ ] Sanity-check the activity feed component: contract §7.5 confirms it's unchanged, but any copy that referenced "coach scheduled" relationships should be updated.

---

## Phase 8 — Polish + hardening

- [ ] Loading / empty / error states audited across new pages.
- [ ] Snackbar/toast wiring for every stable error code from contract §5.9.
- [ ] Responsive checks at common viewport widths (desktop-first per contract, but should not break on tablet).
- [ ] Accessibility pass: keyboard navigation through gym detail tabs, focus management on dialogs, ARIA labels on role badges.
- [ ] Update [README.md](../fitepic-web-app/README.md) with a "Gyms" section linking to this plan.
- [ ] Manual QA pass against a dev API instance:
  - [ ] Owner happy path: create gym → invite member → create group → schedule workout → verify athlete sees it.
  - [ ] Athlete happy path: join via code → accept invite → see scheduled workouts.
  - [ ] Error path: every code in §5.9 surfaces correctly.

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
