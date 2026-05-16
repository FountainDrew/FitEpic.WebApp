# Gym Ownership — Web App Implementation Plan

**Date:** 2026-05-16
**Status:** Draft v1 — pending resolution of open questions in [gym-ownership-webapp-contract.md §12](../../FitEpic.Api/readmes/gym-ownership-webapp-contract.md)
**Audience:** FitEpic.WebApp team
**Companion docs:**
- `FitEpic.Api/readmes/gym-ownership-requirements.md` — product requirements
- `FitEpic.Api/readmes/gym-ownership-webapp-contract.md` — living API contract for the web app

---

## Scope

Implement the web-app side of the Gym → Training Group → Athlete model described in the requirements + contract. The web app is desktop-first and skewed toward gym administration (Owner / Admin / Coach workflows), but also implements the athlete-facing flows (join a gym, accept invites, view scheduled workouts).

The plan is sequenced so each phase ships a usable slice and can be QA'd against a real dev API instance before moving on. Phases 2–6 are the core delivery; phases 0/1/7/8 are scaffolding and cleanup.

---

## Blocking questions

Implementation does not start until the open questions in [contract §12](../../FitEpic.Api/readmes/gym-ownership-webapp-contract.md) are resolved. The phases below note which questions gate which work:

- **Phase 0** blocks on Q1 (error envelope shape), Q2 (web-app endpoint mirrors).
- **Phase 4** blocks on Q3 (athlete-lookup endpoint for the invite picker).
- **Phase 6** blocks on Q4 (gym workouts response shape), Q5 (scheduled-workouts date filtering), Q6 (gym workout deletion).

---

## Phase 0 — Foundation

Set up the generated client and shared plumbing every later phase depends on.

- [ ] Confirm API team has shipped Phase A–E of their implementation plan and `swagger.json` renders cleanly.
- [ ] Run `npm run gen:api` against the updated swagger; review the diff in `src/app/core/api/generated/`.
- [ ] Decide on gym-domain error envelope handling (depends on contract Q1):
  - [ ] If gym endpoints use `GymErrorResponse { code, error }` as-is: extend [error-code.ts](../fitepic-web-app/src/app/core/api/error-code.ts) with `getGymErrorCode()` / `getGymErrorMessage()` helpers that read the alternate shape.
  - [ ] If gym endpoints are re-shaped to match `WebAppErrorEnvelope`: no change needed beyond regen.
- [ ] Add `GymRole` enum + `GymRoleService` under `src/app/core/gyms/`:
  - [ ] Combines `Gym.OwnerAthleteId` (Owner has no membership row) and `GymMembership.Role` to return `Owner | Admin | Coach | Athlete | null`.
  - [ ] Exposes `signal<Record<gymId, GymRole>>` keyed by gym for components to read reactively.
- [ ] Add `GymsService` under `src/app/core/gyms/` as the thin RxJS wrapper over the generated `Gyms` service (mirroring `ProfileService` style).
- [ ] Add a shared `gymErrorSnackbar()` helper that maps stable codes from [contract §5.9](../../FitEpic.Api/readmes/gym-ownership-webapp-contract.md) to user-facing toasts.

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
  - [ ] Athlete picker (email lookup — depends on Q3).
  - [ ] Offered role selector (`Athlete | Coach | Admin`; `Admin` shown only to Owner).
  - [ ] `POST /api/gyms/{gymId}/invites`.
  - [ ] Handle `InviteDuplicate`, `InviteAlreadyMember`, `InsufficientRole`, `NotOwner`.
- [ ] Build `InvitesTab` (Admin/Owner only) on gym detail:
  - [ ] `GET /api/gyms/{gymId}/invites?status=Pending` (default), with status filter.
  - [ ] Revoke action: `POST /api/gyms/invites/{id}/revoke`.
- [ ] Build `MyInvitesList`:
  - [ ] `GET /api/athletes/me/gym-invites`.
  - [ ] Accept: `POST /api/gyms/invites/{id}/accept` → optimistically add the returned `Membership` to `/gyms?role=member` cache.
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

- [ ] Build `WorkoutsTab` on gym detail (visible to all gym members; author/edit gated to Coach/Admin/Owner):
  - [ ] `GET /api/gyms/{gymId}/workouts` to list the gym's workout library (depends on Q4 for response shape).
- [ ] Build `AuthorWorkoutPage` (Coach/Admin/Owner):
  - [ ] Reuse the existing workout authoring components if possible; otherwise scaffold fresh.
  - [ ] Submit via single-row batch to `POST /api/mobile/workouts/sync` with `GymId` set on the row.
  - [ ] Handle per-row `Forbidden` from the sync response shape.
- [ ] Build `DeleteWorkoutAction` (depends on Q6 — confirm whether `IsDeleted: true` on a sync row deletes a gym workout, and whether non-staff can do this).
- [ ] Build `ScheduleTab` on gym detail (Coach/Admin/Owner author; all gym members can read their visibility slice):
  - [ ] `GET /api/mobile/scheduled-workouts` (depends on Q5 for date range filtering).
  - [ ] Filter client-side to the current gym's groups + own personal rows.
  - [ ] Calendar view (month/week) with each row tagged by group.
- [ ] Build `ScheduleWorkoutDialog`:
  - [ ] Pick group, workout (from gym library), date.
  - [ ] Submit via single-row batch to `POST /api/mobile/scheduled-workouts/sync` with `TrainingGroupId`, `WorkoutId`, `ScheduledDate`, `AthleteId = null`.
  - [ ] Reflect `IsLocked = true` returned on group rows (display as read-only after creation).
- [ ] Update any existing scheduled-workout rendering to handle nullable `AthleteId` + new `TrainingGroupId`:
  - [ ] Audit [features/dashboard](../fitepic-web-app/src/app/features/dashboard/) for callsites that assume `AthleteId` is non-null.
- [ ] Manual QA: author a workout → schedule it for a group → verify it appears for athletes in the group on next fetch; verify coaches/admins/owner see it via implicit participation.

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
