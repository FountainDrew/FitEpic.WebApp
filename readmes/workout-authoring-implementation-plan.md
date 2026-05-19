# Workout Authoring — Web App Implementation Plan

**Date:** 2026-05-19
**Status:** Draft v1 — pending user review before implementation.
**Audience:** FitEpic.WebApp team.
**Related:**
- Mobile reference: `FitEpic.Mobile/FitEpic.Mobile/Views/CreateWorkoutPage.xaml(.cs)`, `WorkoutEditorPage.xaml(.cs)`, `ExerciseConfigPage.xaml(.cs)` and the matching view models in `FitEpic.Mobile/FitEpic.Mobile/ViewModels/`.
- Existing web-app placeholder being replaced: `CreateGymWorkoutDialog` in [fitepic-web-app/src/app/features/gyms/create-gym-workout-dialog.ts](../fitepic-web-app/src/app/features/gyms/create-gym-workout-dialog.ts).

---

## 1. Goal

Replace the stub `CreateGymWorkoutDialog` with a real, reusable workout-authoring surface that:

- Matches the mobile flow's parse-and-edit pattern (paste raw text → server parses → editable result, plus a manual-build path).
- Captures every field the `WorkoutRequest` payload supports — name, instructions, type, score type, round count (Intervals), workout duration, full exercise list with per-exercise metrics.
- Drops into multiple entry points without duplication: dashboard FAB (personal workouts), gym workouts tab (gym-scoped), and any future calendar-slot quick-create.
- Supports both **create** (`/workouts/new`) and **edit** (`/workouts/:id/edit`) modes.

The flow must respect the gym contract: setting `gymId` on a `WorkoutRequest` requires Coach/Admin/Owner of that gym, and the API will return per-row `Forbidden` if violated.

---

## 2. UX decisions (locked in 2026-05-19)

- **Surface:** routed feature module. The editor is a full page at `/workouts/new` and `/workouts/:id/edit`. Browser back works; the route is deep-linkable. Sub-flows (exercise picker, per-exercise config) remain dialogs.
- **Parse step:** single-screen editor. The raw-text textarea lives at the top of the editor with an inline "Analyze" button. There's no separate intro screen — paste-and-go users hit Analyze, manual-build users just skip it. This collapses the mobile's CreateWorkoutPage + WorkoutEditorPage into one screen, which suits desktop better.

---

## 3. Component & route architecture

```
/workouts/new                          → WorkoutEditorPage (create mode)
/workouts/:id/edit                     → WorkoutEditorPage (edit mode)

WorkoutEditorPage  (route component)
├── RawTextSection
│   └── inline "Analyze" button → calls WorkoutsService.parse()
├── MetadataSection
│   ├── Name input (required)
│   ├── Instructions textarea
│   ├── Workout type select
│   ├── Score type select
│   ├── Rounds input        (visible only when type === 'Intervals')
│   └── Workout duration (MM:SS or hh:mm:ss)
├── ExerciseListSection
│   ├── ExerciseRow × N     (name, sets×reps summary, edit/delete/reorder controls)
│   ├── soft-deleted rows render struck-through with a Restore button
│   └── "Add exercise" button → opens ExercisePickerDialog
└── FooterSection
    ├── Save-to (Gym / "My personal library") select
    │      (hidden when there's nothing to pick — i.e., the user has no staff role
    │       in any gym AND the URL didn't pre-select a gym)
    ├── Cancel button (with unsaved-changes confirm)
    └── Save button (disabled while pending; shows `Forbidden` / `BlockedByHistory`
       per-row resolution from the sync response)

Dialogs:
- ExercisePickerDialog        — search standard exercises; "Add custom" path
- ExerciseConfigDialog        — per-exercise fields (sets, reps, measurement type,
                                target weight/duration/distance/cals, per-round metric
                                if the parent workout is Intervals)
- ConfirmReanalyzeDialog      — confirms the merge before re-running parse
- UnsavedChangesDialog        — cancel/back guard
```

---

## 4. Services & state

Three new injectables under `src/app/core/workouts/`:

- **`WorkoutsService`** — thin wrapper over the generated workouts client.
  - `parse(rawText): Promise<ParseWorkoutResponse>`
  - `syncWorkout(payload): Promise<SyncItemResult | null>` (single-row batch; mirrors `GymsService.syncWorkout`)
  - `getWorkout(id): Promise<WorkoutResponse>` (for edit mode)
  - `listMyWorkouts()` for the dashboard quick-pick (future)

- **`StandardExercisesService`** — wraps `GET /api/standard-exercises` for the picker, with simple in-memory caching and search.

- **`WorkoutAuthoringService`** — holds the draft state for the in-progress workout. **Component-scoped** (not `providedIn: 'root'`) so each editor instance has its own draft and there's no leak between create→cancel→create cycles.
  - Signals: `name`, `instructions`, `rawText`, `workoutType`, `scoreType`, `roundCount`, `duration`, `exercises`, `gymId`, `dirty`.
  - Methods:
    - `loadFromResponse(workout)` (edit mode hydration)
    - `loadFromParseResult(parseResult)` (initial parse hydration)
    - `mergeFromParseResult(parseResult)` (re-analyze: match by `StandardExerciseId` then by normalized name; update matched, add new, soft-delete missing).
    - `addExercise(stub)`, `updateExercise(id, patch)`, `softDeleteExercise(id)`, `restoreExercise(id)`, `moveExercise(id, direction)`.
    - `toRequestPayload(): WorkoutRequest` for the save call.
  - Internal model: `DraftExercise extends WorkoutExerciseRequest with { isRemoved: boolean; isNew: boolean }` — `isRemoved` differs from `isDeleted` because soft-deletion-with-restore is a UI-only state until save; only rows still `isRemoved` at save become `isDeleted: true` in the payload.

---

## 5. Reusability contract

`WorkoutEditorPage` is the reusable unit. Callers don't embed a component — they navigate.

**Inputs via route + query params:**

| Param        | Where        | Behavior                                                                                                      |
|--------------|--------------|---------------------------------------------------------------------------------------------------------------|
| `id`         | path         | Edit mode. Hydrates from `GET /workouts/{id}`.                                                                |
| `gymId`      | query        | Pre-selects the gym in the "Save to" picker and locks it (the picker shows only that gym). Validated against role. |
| `returnUrl`  | query        | Where to navigate on save/cancel. Defaults to `/`.                                                            |
| `rawText`    | query (rare) | Pre-fills the raw-text field. Useful for "quick-create from clipboard" entry points. (Future.)                |

**Outputs:** navigation to `returnUrl` on success, with a snackbar from the calling context if needed.

**Entry-point integrations (Phase F below):**

- Dashboard `+` FAB → `router.navigate(['/workouts/new'])`
- Gym workouts tab "New workout" → `router.navigate(['/workouts/new'], { queryParams: { gymId, returnUrl: '/gyms/' + gymId + '/workouts' } })`. The existing buggy `CreateGymWorkoutDialog` is deleted.
- Gym workouts tab edit-row action (new) → `router.navigate(['/workouts', workout.id, 'edit'], { queryParams: { gymId, returnUrl: '/gyms/' + gymId + '/workouts' } })`
- Future: schedule-tab quick-create slot → `router.navigate(['/workouts/new'], { queryParams: { gymId, date: 'YYYY-MM-DD', returnUrl: ... } })` (the `date` param is wired into the future `Schedule for...` integration once Q11 lands).

---

## 6. Parse + merge logic

**Initial parse (raw text non-empty, no exercises yet):**
1. User pastes text, taps Analyze.
2. `WorkoutsService.parse(rawText)` posts to `/workouts/parse`.
3. On success → `WorkoutAuthoringService.loadFromParseResult(...)` populates name, type, score type, rounds, duration, exercises (all new, none removed).
4. On parse failure → snackbar with reason-specific copy (see §6.2).

**Re-analyze (exercise list non-empty when Analyze is tapped):**
1. Show `ConfirmReanalyzeDialog`: "Analyzing will update matched exercises, add new ones, and mark missing ones for removal. Continue?"
2. On confirm → `WorkoutsService.parse(rawText)` then `WorkoutAuthoringService.mergeFromParseResult(parseResult)`:
   - For each parsed exercise:
     - Match against current draft by `StandardExerciseId` if set, else by normalized lowercase name.
     - Match found → update target fields (reps, sets, weight, duration, distance, calories, per-round metric), keep `id`, clear `isRemoved` if it was set.
     - No match → push as a new draft exercise with `isNew: true`.
   - For each draft exercise not present in the parse result → set `isRemoved: true`. The row stays in the list with a Restore button.
3. Save only emits `isDeleted: true` on rows that are still `isRemoved` (intersected with rows that already exist server-side; brand-new client-side rows that get marked removed are simply dropped from the payload).

**6.2 Parse-failure UX**

Mirror the mobile copy by mapping `WorkoutParseFailureReason` to user messages. Specific cases:
- `NoExercisesIdentified` → "We couldn't find any exercises in that text. Try describing your workout differently, or build it manually."
- Network errors → "Couldn't reach the parser. Check your connection and try again."
- Timeouts → "The request timed out. Try again."
- Anything else → server-supplied message via `getApiErrorMessage`.

---

## 7. Sub-flows

**7.1 ExercisePickerDialog**
- Loads `/api/standard-exercises` once (cached for the editor's lifetime).
- Search input filters by name client-side.
- Tap a result → closes picker, opens `ExerciseConfigDialog` with `standardExerciseId` and `userEnteredExerciseName` pre-filled.
- "Add custom" path: closes picker, opens `ExerciseConfigDialog` with `standardExerciseId: null` and a text-entry for the name.

**7.2 ExerciseConfigDialog**
- Fields (matching mobile):
  - `userEnteredExerciseName` (required)
  - `sets` (numeric, default 1)
  - `reps` (free text, e.g., "21-15-9", "max")
  - `measurementType` select — **hidden when parent workout type is `Intervals`** (Intervals uses `perRoundMetric` instead)
  - `targetWeight` (decimal)
  - `duration` (mm:ss)
  - `targetDistance` + `targetDistanceUnit` (Meters / Kilometers / Miles / Feet)
  - `targetCalories` (decimal)
  - `perRoundMetric` select — **visible only when parent workout type is `Intervals`**
- Cancel returns nothing; Done returns the patched `DraftExercise`.

**7.3 Reorder**
- For first cut: up/down buttons on each row (matches mobile, simpler than DnD).
- Phase 8 polish: swap to `@angular/cdk/drag-drop` for drag-to-reorder.

---

## 8. Phased implementation

Each phase ships a working slice and ends with a clean build.

### Phase A — Foundation (no UI)
- [x] Created `src/app/core/workouts/`:
  - [x] `workouts.service.ts` (parse, syncWorkout, getWorkout).
  - [x] `standard-exercises.service.ts` (full catalog paged + cached on first request).
  - [x] `workout-authoring.service.ts` + `draft-models.ts`.
- [x] Routes registered for `/workouts/new` and `/workouts/:id/edit`.

### Phase B — Basic metadata + save
- [x] Editor shell with Cancel, Save, page header.
- [x] Metadata section: name, instructions, type, score, conditional rounds, duration.
- [x] Gym picker honoring `?gymId=` (locks to a single library).
- [x] Save with `Forbidden` per-row handling + navigation to `returnUrl`.
- [x] Cancel with in-component `dirty` confirm dialog.

### Phase C — Exercise list
- [x] Exercise rows inline (name, sets×reps summary, edit/remove/restore, up/down).
- [x] `ExercisePickerDialog` with search + "Add custom" path.
- [x] `ExerciseConfigDialog` with conditional Measurement Type vs Per-Round Metric.
- [x] Soft-delete / restore semantics; never-saved rows that were removed are dropped from the payload.

### Phase D — Parse integration
- [x] Raw-text textarea + inline Analyze button.
- [x] Initial parse → `loadFromParseResult`.
- [x] Re-analyze with confirm → `mergeFromParseResult` (match by `standardExerciseId` then by normalized name; update / add / mark-removed).
- [x] No-exercises and generic parse-failure copy surfaced via snackbar.

### Phase E — Edit existing workout
- [x] `/workouts/:id/edit` fetches via `getWorkout` and hydrates the draft.
- [x] Loading skeleton + "no longer available" error state.
- [x] Soft-deleted existing exercises emit `isDeleted: true` on save.

### Phase F — Integration
- [x] Dashboard header "New workout" button → `/workouts/new`.
- [x] Gym workouts tab "New workout" → `/workouts/new?gymId=...&returnUrl=...`.
- [x] Gym workouts tab row "Edit" action → `/workouts/:id/edit?gymId=...`.
- [x] `CreateGymWorkoutDialog` deleted; no remaining callers.

### Phase G — Polish & QA
- [x] `CanDeactivate` route guard (`workoutEditorCanDeactivate`) prompts on back / sidebar nav when dirty; component-driven navigation bypasses the prompt.
- [x] Drag-to-reorder via `@angular/cdk/drag-drop` with a dedicated handle. Up/down buttons kept as keyboard-friendly fallback.
- [x] Loading skeleton for edit-mode hydrate.
- [ ] Manual QA matrix (deferred to a human reviewer in the browser):
  - [ ] Personal create (no gym) → save → appears wherever the personal workouts list lands (open Q13).
  - [ ] Gym create (gymId pre-selected) → save → appears in gym workouts library.
  - [ ] Edit existing personal workout → save → see updated row.
  - [ ] Edit existing gym workout (Coach/Admin/Owner) → save.
  - [ ] Edit gym workout as a non-staff member → expect `Forbidden` per-row resolution.
  - [ ] Parse happy path: paste valid text → analyze → save.
  - [ ] Parse failure (paste garbage) → see fallback copy → build manually → save.
  - [ ] Re-analyze with edits in the list → confirm merge → verify update / add / remove behavior.
  - [ ] Soft-delete + restore a freshly-added exercise (no `isDeleted` leak to server).
  - [ ] Cancel with unsaved changes → confirm dialog.
  - [ ] Browser-back with unsaved changes → guard prompt.

---

## 9. Open questions

- **Q12 — Standard exercises endpoint location for the web.** The `StandardExercises` tag group exists, plus a `mobile-standard-exercises` variant. Which is the canonical path for the web app to fetch the standard exercise list? (I'll default to `/api/standard-exercises` if both serve the same data; calling out in case there's a divergence.)
- **Q13 — Existing personal-workout list.** Once the editor saves a personal workout, where does it appear in the dashboard today? There's a workout-card / workout-drawer pair but I don't see a "my library" page. Confirm whether building such a list is in scope here or part of a follow-up.
- **Q14 — Exercise picker custom-name path.** Mobile lets the user type a custom exercise name with no `standardExerciseId`. Is that still the intended flow, or does product want the web app to require a standard match? (I'll assume the former matches mobile.)

These don't block Phase A or Phase B; flagging now so they're resolved before Phase C lands.

---

## 10. Out of scope (call out, don't build)

- Bulk workout import / CSV.
- Templates from other gyms / cross-gym workout sharing.
- Per-round notes on individual exercises.
- Workout duplication / save-as.
- Mobile-style "Recent & Upcoming" context strip — desktop has a calendar surface coming in Phase 6 of the gym plan; the editor doesn't need to duplicate that context here.
- Authoring while offline (web app has no sync engine).

---

## 11. Change log

- **2026-05-19 — v1 draft.** Initial plan after exploring mobile flow + selecting routed-page + single-screen-parse UX.
- **2026-05-19 — v2.** Phases A–G implemented end-to-end. Manual QA matrix is the remaining open item; Q12 / Q13 / Q14 still need API + product input before they impact polish work.
