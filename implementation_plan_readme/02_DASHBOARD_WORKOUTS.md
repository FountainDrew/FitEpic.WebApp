# Phase 2: Dashboard Workouts

**Status:** Ready for API team review.

This phase brings the workout-centric portions of the Mobile dashboard to the Web App: today's and tomorrow's scheduled workouts, plus completed workouts from earlier in the current week. Together with the weekly stats and streak shipped in Phase 1, this gives the Web App dashboard parity with the core "what am I doing this week" view from Mobile.

For overarching architectural rules (route prefixes, conventions, separation principle), see [WEB_APP_API_REQUIREMENTS.md](./WEB_APP_API_REQUIREMENTS.md). This document specifies only what is unique to the Workouts slice.

Open questions in §5 should be confirmed with the Web App team before implementation begins.

---

## Addendum — 2026-04-28 (API team)

**`completedAt` removed from the response.** The `ScheduledWorkout` row has no completion timestamp — only `ScheduledDate` (a calendar `DateOnly` in the athlete's timezone), `CreatedAt`, and `UpdatedAt`. Adding a real `CompletedAt` column would be a schema migration the Web App's needs don't justify, and `UpdatedAt` is unsafe to use as a proxy because it advances on any later edit.

The Web App agreed that `scheduledDate` is sufficient for retrospective rendering. As a result:

- `completedAt` is **dropped from `DashboardWorkoutCard`**.
- The **yesterday sort order** no longer references `completedAt`. See §2.1 for the updated rule.

If the Web App later needs a precise completion time (e.g. a "completed at 7:42 PM" sub-label), we'll add a real `CompletedAt` column at that point and a follow-up phase will surface it.

---

## Addendum — 2026-04-29 (API team — athlete logs on completed cards)

Completed scheduled workouts now expose the athlete's logged sets so the Web App can render results alongside the prescription. The shape:

- A new `logs` array hangs off each entry in the existing `exercises` array. Populated only when the parent card has `status === "Completed"` and at least one log exists for that exercise. Omitted (or `null`) otherwise.
- **Ad-hoc logs** — if the athlete logged an exercise that wasn't in the prescription (no `WorkoutExerciseId`), the server appends a synthetic entry to the `exercises` array with `summary: ""` and the logs attached. `exerciseCount` reflects the union of prescribed + ad-hoc, matching what the athlete actually did.
- **No truncation.** A long EMOM might produce 60+ log rows; the full list is returned. UI design has accounted for this.

Each log entry:

```json
{
  "setNumber": 1,
  "roundNumber": null,
  "summary": "8 @ 135 lbs",
  "notes": "felt heavy"
}
```

- `setNumber` / `roundNumber` are the raw values from the log row (`SetNumber` / `RoundNumber`). Either may be `null`. `roundNumber` is mainly relevant for AMRAP/EMOM workouts.
- `summary` is server-formatted from the actuals; format mirrors the prescription summary rules (per `MeasurementType`) but applied to the `Actual*` fields and **without** the `sets ×` prefix — each log line is one set/round.
- `notes` is the athlete-entered free-text note for that set, or `null`.

See §1.1 for the per-log summary format, §2.1 for the full updated schema, and §6.10 for the API implementation plan.

---

## Addendum — 2026-04-28 (Web App team — body-picker flipped)

**Body-picker priority is reversed.** The previous spec preferred the parsed `exercises` list and fell back to `rawText`. That order is now flipped:

1. **Raw text** — when `rawText` is non-empty, render it verbatim (line breaks preserved). This is the primary body for any workout that has a freestyle description.
2. **Exercise list (inline)** — rendered only when `rawText` is empty *and* `exercises` is non-empty.
3. **Placeholder** — rendered when both are empty (unchanged).

**`exercises` is always included in the response regardless.** Even when `rawText` wins the body slot, the full `exercises` array is still serialized so the Web App can offer an "View parsed exercises" affordance (e.g. a disclosure toggle, modal, or sub-section) for athletes who want the structured view in addition to the raw description.

No API contract change beyond the rendering rule — the response shape, sort rules, and `exerciseCount` semantics are unchanged.

---

## 1. Web App UI Scope

The Web App is intended primarily as a programming tool, expected to be checked less frequently than Mobile and used to plan and review workouts rather than execute them in the moment. The dashboard's workout sections reflect that — they're built around the **calendar**, not around "what should I do right now." There are no time-of-day section relabels.

The dashboard will gain four new sections below the existing Weekly Stats panel:

- **Yesterday** — workout cards for yesterday (the athlete's local previous calendar day). Any status. Suppressed when empty.
- **Today** — workout cards for today. Always rendered, with an empty-state body when there are none.
- **Tomorrow** — workout cards for tomorrow. Always rendered, with an empty-state body when there are none.
- **Future** — workout cards scheduled in the seven calendar days after tomorrow (i.e. day-after-tomorrow through day-after-tomorrow + 6). Suppressed when empty. Cards include their `scheduledDate` so the Web App can render date sub-headings within the section.

Each section renders one or more **Workout Cards** (described in §1.1). Empty states are described in §1.2.

Out of scope for this phase: click-through to workout detail (no detail endpoint exists yet), social reactions / comments on workout cards, drag-reorder, inline mark-complete, FAB or quick-create-workout actions, and any time-of-day-driven label changes (these are Mobile UX concerns and don't apply to the Web App's programming-tool use case).

### 1.1 Workout Card layout

Each card shows, top to bottom (mirroring Mobile's `WorkoutCardView`):

- **Workout name** (e.g. "Upper Body").
- **Status badge** — only `Completed` and `Pending` are rendered:
  - `Completed` → green badge labelled "Completed" (Mobile uses `#34C759`).
  - `Pending` → orange badge labelled "Pending" (Mobile uses `#FF9500`).
  - `Dismissed` cards are **excluded server-side** and never reach the Web App, so the client never has to render them.
- **Meta line** — `{workoutType} · {duration} · {N exercise(s)}`, with a center dot (` · `) separator. Mobile literally renders the string `"exercise(s)"`; the Web App will pluralize properly ("1 exercise" / "5 exercises") as a small intentional polish divergence. Segments are suppressed when the underlying value is missing — e.g. no recorded duration drops the duration segment entirely.
- **Body** — picked from the response data in this priority order:
  1. **Raw text** — rendered when `rawText` is non-empty (e.g. an unparsed freestyle WOD description, an AMRAP description, etc.). Rendered verbatim with line breaks preserved. This is the primary body for any workout that has a freestyle description.
  2. **Exercise list (inline)** — rendered when `rawText` is empty *and* `exercises` is non-empty. No truncation; the card grows to fit.
  3. **Placeholder** — rendered when both `rawText` is empty *and* `exercises` is empty. Body text: "No additional workout info available." This shouldn't happen under normal circumstances; the placeholder exists so we can spot bad data in production rather than render a silently broken card.

  Note: even when `rawText` wins the body slot, the full `exercises` array is still serialized in the response. The Web App should offer a way to view the parsed exercise list alongside the raw text (e.g. a disclosure toggle or sub-section) so athletes can see the structured view when one exists.

  This is a deliberate divergence from Mobile's `IsStraightSets`-driven logic: the Web App picks based on what the response actually contains, which is simpler to reason about.
- **Score line** (completed workouts with a score only) — server-formatted as `Score: {scoreResult} {scoreTypeLabel}`, e.g. "Score: 23:45 Time to Complete," "Score: 12+7 Rounds + Reps," "Score: 225 Heaviest Load." The Web App renders the pre-formatted string as-is.

Cards are static in this phase (no click handler / no hover-link). They are presentational only.

#### Exercise summary format

Each exercise's per-line summary is built server-side and delivered as a string. Mobile's logic in `DashboardExerciseCardItemUIModel` produces:

- **Reps (default)**: `{sets} × {reps}`, optionally `{sets} × {reps} @ {weight} lbs`. Examples: `3 × 8`, `3 × 8 @ 225 lbs`. When `reps` is empty: `1 set` or `{sets} sets`.
- **Time**: `{sets} × {h:mm:ss or m:ss}`. Examples: `3 × 4:32`, `3 × 1:23:45`.
- **Distance**: `{sets} × {targetDistance} {unit}`. Examples: `3 × 5.5 mi`, `3 × 2.5 km`.
- **Calories**: `{sets} × {targetCalories} cal`. Example: `3 × 50 cal`.

Driven by the exercise's `MeasurementType` (`Reps` | `Time` | `Distance` | `Calories`) plus the populated target field.

**Empty `summary`.** When the exercise has no recorded set count (`Sets` is null or `0`), the server returns `summary: ""`. The Web App should suppress the summary line entirely in that case rather than rendering an empty pill — the exercise still appears in the list (its `name` is shown), just without a per-line summary underneath.

#### Per-log summary format (Completed cards only)

When the parent card is `Completed`, each exercise entry may carry a `logs` array. Each log's `summary` is server-formatted from the recorded actuals using the same `MeasurementType`-driven rules as the prescription summary, but **without** the `sets ×` prefix — each log line represents one set/round:

- **Reps (default)**: `{actualReps}`, optionally `{actualReps} @ {actualWeightLbs} lbs`. Examples: `8`, `8 @ 135 lbs`.
- **Time**: `{h:mm:ss or m:ss}` formatted from `ActualDurationSeconds`. Examples: `4:32`, `1:23:45`.
- **Distance**: `{actualDistance} {unit}` (unit from `ActualDistanceUnit`). Examples: `5.5 mi`, `500 m`.
- **Calories**: `{actualCalories} cal`. Example: `50 cal`.

Measurement type detection: when the log row has a `WorkoutExerciseId`, the server uses the parent exercise's `MeasurementType`. For ad-hoc logs (no `WorkoutExerciseId`), the server falls back to detection by which `Actual*` field is populated.

If none of the actuals are populated, the per-log `summary` is `""`. The `notes` (if any) and `setNumber` / `roundNumber` are still returned and the row should still render.

### 1.2 Empty states

- **Today** — always renders. Empty body text: "No workouts scheduled today."
- **Tomorrow** — always renders. Empty body text: "No workouts scheduled for tomorrow."
- **Yesterday** — section is suppressed entirely when there are no workouts.
- **Future** — section is suppressed entirely when there are no workouts in the seven-day window.

---

## 2. Required Endpoints

All endpoints live under `/api/webapp/...` per the routing conventions in `WEB_APP_API_REQUIREMENTS.md` §2.2–§2.3.

### 2.1 `GET /api/webapp/dashboards/workouts/v1`

Returns the four workout sections in a single response.

**Response shape:**
```json
{
  "yesterdayDate": "2026-04-27",
  "todayDate": "2026-04-28",
  "tomorrowDate": "2026-04-29",
  "futureWindowEnd": "2026-05-06",
  "yesterday": [ /* DashboardWorkoutCard[] */ ],
  "today":     [ /* DashboardWorkoutCard[] */ ],
  "tomorrow":  [ /* DashboardWorkoutCard[] */ ],
  "future":    [ /* DashboardWorkoutCard[] */ ]
}
```

`DashboardWorkoutCard`:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Upper Body",
  "workoutType": "Straight Sets",
  "durationMinutes": 45,
  "exerciseCount": 5,
  "status": "Pending",
  "scheduledDate": "2026-04-28",
  "score": null,
  "rawText": null,
  "exercises": [
    {
      "name": "Bench Press",
      "summary": "3 × 8 @ 135 lbs",
      "logs": [
        { "setNumber": 1, "roundNumber": null, "summary": "8 @ 135 lbs", "notes": null },
        { "setNumber": 2, "roundNumber": null, "summary": "8 @ 135 lbs", "notes": null },
        { "setNumber": 3, "roundNumber": null, "summary": "6 @ 145 lbs", "notes": "felt heavy" }
      ]
    },
    { "name": "Pull-ups", "summary": "3 × 10", "logs": null }
  ]
}
```

Field types:
- `yesterdayDate` / `todayDate` / `tomorrowDate` — ISO dates in the athlete's timezone. Returned for client convenience (rendering date sub-labels) so the client doesn't redo timezone math.
- `futureWindowEnd` — ISO date in the athlete's timezone. Inclusive end of the future window: seven calendar days after `tomorrowDate`.
- `yesterday` — cards for `scheduledDate === yesterdayDate`, any status. Sort order: completed cards first, then non-completed; within each group, by workout `name` ascending (case-insensitive). May be empty. (`ScheduledWorkout` has no completion timestamp; see Addendum.)
- `today` / `tomorrow` — cards for `scheduledDate === todayDate` / `tomorrowDate`. Any status. Sort order: by workout `name` ascending (case-insensitive).
- `future` — cards for workouts where `scheduledDate > tomorrowDate` AND `scheduledDate <= futureWindowEnd`. Sort order: by `scheduledDate` ascending, then by workout `name` ascending (case-insensitive) within each date. The Web App will render with date sub-headings.
- `id` — GUID of the scheduled workout.
- `name` — string.
- `workoutType` — string; may be `null`. Server-formatted human-readable label derived from the `WorkoutType` enum on `Workout`. Mapping:

  | Enum | `workoutType` string |
  |---|---|
  | `StraightSets` | `"Straight Sets"` |
  | `AMRAP` | `"AMRAP"` |
  | `ForTime` | `"For Time"` |
  | `EMOM` | `"EMOM"` |
  | `Tabata` | `"Tabata"` |
  | `Circuit` | `"Circuit"` |
  | `Chipper` | `"Chipper"` |
  | `Intervals` | `"Intervals"` |
  | `Other` | `"Other"` |
- `durationMinutes` — integer; `null` if no duration recorded. Sourced from `ScheduledWorkout.Duration` (the athlete-logged actual duration) when present, otherwise from `Workout.Duration` (the prescribed value). In practice this means Completed cards show the actual time the athlete logged, and Pending cards show the prescribed/planned duration.
- `exerciseCount` — integer; equal to `exercises.length` *after* any synthetic ad-hoc entries (Completed cards) are appended — i.e. the count of distinct exercises the athlete actually performed (or that were prescribed for Pending cards). Even raw-text / freestyle workouts that happen to have parsed exercises report a non-zero count. The meta line drops the segment when `0`.
- `status` — `"Pending"` | `"Completed"`. The underlying `ScheduledWorkoutStatus` enum also has `Dismissed`, but those cards are filtered out server-side (see §2.1 behavior) and never appear in any of the four sections.
- `scheduledDate` — ISO date in athlete timezone. For Completed cards this is also the date the workout was performed; the response does not include a precise completion timestamp (see Addendum).
- `score` — object or `null`. Populated **only** when `status === "Completed"`, `scoreResult` is non-empty, and `scoreType !== "None"`. Otherwise `null`.
  ```json
  {
    "scoreType": "TimeToComplete",
    "scoreResult": "23:45",
    "displayValue": "Score: 23:45 Time to Complete"
  }
  ```
  - `scoreType` — value from the existing `WorkoutScoreType` enum (already in `FitEpic.Api.ServiceModels`): `None | TimeToComplete | TimeCapPlusReps | TotalReps | RepsPerRound | HeaviestLoad | TotalLoad | TimeAndLoad | RepsAndLoad | PointsSystem | RoundsAndReps | Meters | Calories | Miles | Feet | TieBreakTime | CustomNumeric`.
  - `scoreResult` — the raw value as stored on `ScheduledWorkout.ScoreResult` (a free-form string whose interpretation depends on `scoreType` — e.g. `"23:45"` for `TimeToComplete`, `"12+7"` for `RoundsAndReps`, `"225"` for `HeaviestLoad`).
  - `displayValue` — server-formatted, ready to render verbatim. Format: `Score: {scoreResult} {scoreTypeDisplay}`, where `scoreTypeDisplay` is the human-readable label per the mapping below.

    | `WorkoutScoreType` | `scoreTypeDisplay` |
    |---|---|
    | `None` | *(score object is `null`; this row never serializes)* |
    | `TimeToComplete` | `"Time to Complete"` |
    | `TimeCapPlusReps` | `"Time Cap + Reps"` |
    | `TotalReps` | `"Total Reps"` |
    | `RepsPerRound` | `"Reps per Round"` |
    | `HeaviestLoad` | `"Heaviest Load"` |
    | `TotalLoad` | `"Total Load"` |
    | `TimeAndLoad` | `"Time + Load"` |
    | `RepsAndLoad` | `"Reps + Load"` |
    | `PointsSystem` | `"Points"` |
    | `RoundsAndReps` | `"Rounds + Reps"` |
    | `Meters` | `"Meters"` |
    | `Calories` | `"Calories"` |
    | `Miles` | `"Miles"` |
    | `Feet` | `"Feet"` |
    | `TieBreakTime` | `"Tie-Break Time"` |
    | `CustomNumeric` | `Workout.ScoreLabel` (free-form unit label set on the workout); falls back to `"Custom"` if `ScoreLabel` is missing |
- `rawText` — string or `null`. The freestyle / unparsed description of a workout (e.g. an AMRAP description). Used as a body fallback when `exercises` is empty.
- `exercises` — array of `{ "name": string, "summary": string, "logs": DashboardWorkoutLog[] | null }`; may be empty. List ordering matches `WorkoutExercise.OrderIndex` ascending. Soft-deleted exercises (and soft-deleted logs) are excluded. The prescription summary is pre-formatted server-side per the rules in §1.1. **No truncation** — the API returns the full list (prescribed exercises + ad-hoc logs + every log row) and the client renders it all.
  - `name` — prefer the linked standard exercise's name when `WorkoutExercise.StandardExerciseId` is populated; otherwise fall back to `WorkoutExercise.UserEnteredExerciseName`. For synthetic ad-hoc entries (logs that have no `WorkoutExerciseId`), `name` is the `ExerciseName` recorded on the log row.
  - `summary` — prescription summary, server-formatted per §1.1. Empty string (`""`) for ad-hoc entries (no prescription) or when `Sets` is null/0.
  - `logs` — populated only when the parent card has `status === "Completed"` and at least one log exists for the exercise. `null` (or omitted) otherwise. Each log entry: `{ "setNumber": int|null, "roundNumber": int|null, "summary": string, "notes": string|null }`. Logs are ordered by `OrderIndex` ascending (then `SetNumber` ascending as a tiebreaker). Per-log `summary` is server-formatted per §1.1's per-log rules. Empty string when no actuals were recorded (the row should still render so `notes` and `setNumber`/`roundNumber` are visible).

The Web App's body-picking rule is documented in §1.1 (prefer `exercises`, fall back to `rawText`, fall back to a placeholder).

**Behavior:**
- "Yesterday," "today," "tomorrow," and the future-window boundaries are calendar dates in the athlete's profile timezone — no time-of-day cutoffs.
- If the profile has no timezone, return `400 PROFILE_TIMEZONE_REQUIRED` (same recovery flow as the weekly-stats endpoint — the Web App auto-sets from the browser and retries).
- Soft-deleted scheduled workouts are excluded.
- Workouts with `status === "Dismissed"` are excluded from all four sections.

**Caching:** `Cache-Control: private, max-age=30`.

---

## 3. Web App Behavior

1. The dashboard issues `GET /api/webapp/dashboards/weekly-stats/v1` and `GET /api/webapp/dashboards/workouts/v1` in parallel after the existing profile/timezone check has succeeded.
2. If `dashboards/workouts/v1` returns `400 PROFILE_TIMEZONE_REQUIRED`, the existing recovery flow handles it (profile auto-set, retry — same as Phase 1).
3. The Web App renders the three workout sections beneath the Weekly Stats panel using the labels and cards from the response. No client-side date math is required.
4. On any other error (network, 5xx), each section falls back to a generic "Could not load workouts" message and a retry button. The Weekly Stats panel remains independent — failure of one endpoint does not blank out the other.

---

## 4. Out of Scope (this phase)

- **Click-through to workout detail** — depends on `GET /api/webapp/scheduledworkouts/{id}/v1`, which is its own future phase.
- **Social reactions on workout cards** — Mobile loads these asynchronously per card via `/api/social/reactions/batch`. Web equivalent is a separate phase.
- **Mark complete / edit logs from the card** — workout mutation flows are out of phase scope.
- **Drag-reorder / reschedule from the card.**
- **FAB-style quick actions** ("Create Workout," "Schedule Workout") — separate phase.
- **Trainer-programmed workout indicators** — to be specified when trainer flows are designed.
- **Pagination** — `recentCompletions` returns the full set for the current week. If the volume becomes large enough to matter, pagination will be added in a follow-up.
- **Mobile controller rename + re-mount under `/api/mobile/...`** — required by [WEB_APP_API_REQUIREMENTS.md](./WEB_APP_API_REQUIREMENTS.md) §2.5, but deferred from this phase. It's a sweeping refactor that's better as its own change and is not a prerequisite for the Phase 2 Web App work. The new `/api/webapp/dashboards/workouts/v1` endpoint added here lives under the Web App surface and is unaffected.

---

## 5. Open Questions

None outstanding — all decisions captured below in Resolved.

### Resolved

- ~~Score shape~~ — resolved per §2.1: `score` is `{ scoreType, scoreResult, displayValue }`, populated only when displayable; uses the existing `WorkoutScoreType` enum.
- ~~Exercise list truncation cap~~ — resolved: no truncation; full list returned and rendered (matches Mobile).
- ~~Status enum~~ — resolved: only `Pending` and `Completed` ever reach the Web App. `Dismissed` cards are filtered out server-side. The Web App renders a badge for both of the remaining statuses.
- ~~`completedAt` always populated~~ — superseded: `completedAt` removed from the response; the schema has no completion timestamp. See Addendum.
- ~~`exerciseCount` for raw-text workouts~~ — resolved: `exerciseCount` equals `exercises.length`. Raw-text workouts can still have parsed exercises; if so, they are rendered. The meta-line drops the segment when count is `0`.
- ~~`exercises = []` AND `rawText = null` semantics~~ — resolved: shouldn't happen, but if it does the card body renders the placeholder text "No additional workout info available" (per §1.1) so the bad data is visible rather than silently rendering an empty card.
- ~~`isStraightSets` flag~~ — resolved: not needed in the response. The Web App's body picker is data-driven (prefer `rawText`, fall back to `exercises`, fall back to placeholder). When `rawText` wins, the parsed `exercises` array is still returned so the UI can surface it via a secondary affordance. Mobile's `IsStraightSets` flag is a Mobile-internal concern.
- ~~Evening-mode cutoff / time-of-day relabel~~ — resolved: not applicable. The Web App is a programming tool checked less frequently than Mobile. Sections are calendar-based with static labels — yesterday, today, tomorrow, future. Mobile's 8 PM flip is a Mobile-only UX concern.
- ~~Empty `recentCompletions` early in the week~~ — resolved: section structure changed. There is no longer an "earlier this week" section; "yesterday" is the only retrospective section, and it suppresses entirely when empty.

---

## 6. API Implementation Plan

This plan mirrors the Phase 1 weekly-stats slice and follows the conventions in [WEB_APP_API_REQUIREMENTS.md](./WEB_APP_API_REQUIREMENTS.md). All paths are relative to the `FitEpic.Api` solution root.

### 6.1 File layout

**New files**

| Layer | File |
|---|---|
| Service model (result) | `FitEpic.Api.ServiceModels/WebApp/DashboardWorkoutsResult.cs` |
| Service model (card) | `FitEpic.Api.ServiceModels/WebApp/DashboardWorkoutCard.cs` |
| Service model (score) | `FitEpic.Api.ServiceModels/WebApp/DashboardWorkoutScore.cs` |
| Service model (exercise line) | `FitEpic.Api.ServiceModels/WebApp/DashboardWorkoutExercise.cs` |
| Response DTO | `FitEpic.Api/Models/WebApp/Response/DashboardWorkoutsResponse.cs` |
| Workout-type label helper | `FitEpic.Services/WebApp/WorkoutTypeDisplay.cs` |
| Score-type label helper | `FitEpic.Services/WebApp/WorkoutScoreTypeDisplay.cs` |
| Exercise summary builder | `FitEpic.Services/WebApp/DashboardExerciseSummaryBuilder.cs` |

**Edits to existing files**

| File | Change |
|---|---|
| `FitEpic.Services/Abstractions/Repositories/WebApp/IWebAppDashboardRepository.cs` | Add `GetDashboardWorkoutsAsync(athleteId, yesterday, futureWindowEnd)` returning a flat list of scheduled-workout rows projected with everything needed (workout, exercises with standard-exercise name, soft-delete-filtered). |
| `FItEpic.Api.Repositories/Repositories/WebApp/WebAppDashboardRepository.cs` | Implement the method above. |
| `FitEpic.Services/Abstractions/Services/WebApp/IWebAppDashboardService.cs` | Add `GetDashboardWorkoutsAsync(athleteId)` returning `DashboardWorkoutsResult`. |
| `FitEpic.Services/WebApp/WebAppDashboardService.cs` | Implement the method: timezone check (reuse same `PROFILE_TIMEZONE_REQUIRED` logic), compute yesterday/today/tomorrow/future-window-end in athlete TZ, call repo, bucket cards, sort, format scores/durations/types/exercises. |
| `FitEpic.Api/Controllers/WebApp/WebAppDashboardsController.cs` | Add `GET workouts/v1` action; map result → response; emit `Cache-Control: private, max-age=30`. |

### 6.2 Repository query

A single EF query per request, returning a flat list scoped to the four-day-plus-window range:

```
ScheduledWorkouts
  .Where(sw => sw.AthleteId == athleteId)
  .Where(sw => !sw.IsDeleted)
  .Where(sw => sw.Status != ScheduledWorkoutStatus.Dismissed)
  .Where(sw => sw.ScheduledDate >= yesterdayDate
            && sw.ScheduledDate <= futureWindowEnd)
  .Include(sw => sw.Workout)
      .ThenInclude(w => w!.Exercises.Where(e => !e.IsDeleted))
      // join to StandardExercise for name fallback
  .AsNoTracking()
```

Project to a repository-internal POCO carrying everything the service needs (workout name, type, raw text, prescribed duration, score label; scheduled status, score type/result, athlete-logged duration, scheduled date; the exercise list with standard-exercise name resolved). The service layer never touches `_table` types.

### 6.3 Service-layer responsibilities

1. Look up `ApplicationUser.Timezone`; throw `WebAppApiException(PROFILE_TIMEZONE_REQUIRED)` if missing — same code path as weekly stats.
2. Compute four anchor dates (`yesterday`, `today`, `tomorrow`, `futureWindowEnd = tomorrow + 7 days`) using the athlete's timezone, **not** the server's.
3. Call repo with `[yesterday, futureWindowEnd]`.
4. Bucket cards into the four sections by `ScheduledDate`.
5. Sort:
   - `today`, `tomorrow` → workout `name` ascending (case-insensitive).
   - `yesterday` → completed first, then pending; within each group, name ascending.
   - `future` → `scheduledDate` ascending, then name ascending.
6. Build each card via the helpers in §6.4.

### 6.4 Mapping helpers

- **`WorkoutTypeDisplay.For(WorkoutType)`** — pure switch over the 9 enum values per the table in §2.1.
- **`WorkoutScoreTypeDisplay.For(WorkoutScoreType, string? customLabel)`** — pure switch over the 17 values; `CustomNumeric` returns `customLabel ?? "Custom"`.
- **`DashboardExerciseSummaryBuilder.Build(WorkoutExercise)`** — implements the §1.1 exercise summary rules:
  - `Reps` (default): `"{sets} × {reps}"` ± ` @ {targetWeight} lbs`; `"1 set"` / `"{sets} sets"` when reps empty.
  - `Time`: `"{sets} × {h:mm:ss or m:ss}"` formatted from `Duration`.
  - `Distance`: `"{sets} × {targetDistance} {unit}"` (unit from `TargetDistanceUnit`).
  - `Calories`: `"{sets} × {targetCalories} cal"`.
- **Card score block** — populated **only** when `Status == Completed`, `ScoreType != None`, and `ScoreResult` is non-empty. Otherwise `null`. `displayValue` is `$"Score: {ScoreResult} {WorkoutScoreTypeDisplay.For(...)}"`.
- **`durationMinutes`** — `ScheduledWorkout.Duration ?? Workout.Duration`, rounded to whole minutes; `null` if both null or zero.
- **Exercise `name`** — standard exercise name when `StandardExerciseId` populated; otherwise `UserEnteredExerciseName`.

These helpers live under `FitEpic.Services/WebApp/` and are unit-testable in isolation.

### 6.5 Controller

```
[HttpGet("workouts/v1")]
[ProducesResponseType(typeof(DashboardWorkoutsResponse), StatusCodes.Status200OK)]
[ProducesResponseType(typeof(WebAppErrorEnvelope), StatusCodes.Status400BadRequest)]
public async Task<IActionResult> GetDashboardWorkoutsV1(CancellationToken ct)
```

- Resolve athlete id from JWT (same helper used by weekly-stats).
- Call `IWebAppDashboardService.GetDashboardWorkoutsAsync`.
- Map result → `DashboardWorkoutsResponse` using a `Map()` static like Phase 1.
- Emit `Cache-Control: private, max-age=30` via `Response.Headers`.
- `WebAppApiException` is converted to `400` by the existing `WebAppExceptionFilter`.

### 6.6 Serialization

- `WorkoutScoreType` and `ScheduledWorkoutStatus` must serialize as enum names (`"TimeToComplete"`, `"Pending"`), not integers. Verify the WebApp-surface JSON options apply `JsonStringEnumConverter`; if Phase 1 already configures this globally, no change needed.
- All other shape rules (camelCase, ISO-8601 UTC, GUID strings) are inherited from the WebApp surface conventions.

### 6.7 Swagger

- Tag the action `WebApp / Dashboards` consistent with Phase 1.
- Provide `summary` + `description` on the action and on each response DTO type so `ng-openapi-gen` produces sensible TypeScript names.

### 6.8 Tests

- **Service unit tests** covering: bucketing by date in athlete TZ (incl. timezone with non-zero UTC offset), Dismissed exclusion, soft-delete exclusion, score-block null vs populated, sort order across all four sections, `durationMinutes` precedence, exercise-name fallback, summary formatting per `MeasurementType`.
- **Controller integration test** for the timezone-missing 400 path and a green-path 200 with a seeded fixture spanning yesterday/today/tomorrow/future.

### 6.9 Out of scope for the implementation PR

- The Mobile rename + re-mount (§4) — separate change.
- Any new schema columns. The existing `ScheduledWorkout`/`Workout`/`WorkoutExercise` columns are sufficient given the decisions above.

### 6.10 Athlete logs on completed cards (incremental)

Adds the `logs` array on each `exercises` entry per the 2026-04-29 addendum. Layered on top of the §6.1–§6.4 implementation; no schema changes.

**New files**

| Layer | File |
|---|---|
| Service model | `FitEpic.Api.ServiceModels/WebApp/DashboardWorkoutLog.cs` |
| Per-log summary helper | `FitEpic.Services/WebApp/WorkoutLogSummaryBuilder.cs` |

**Edits to existing files**

| File | Change |
|---|---|
| `FitEpic.Api.ServiceModels/WebApp/DashboardWorkoutExercise.cs` | Add `List<DashboardWorkoutLog>? Logs { get; set; }`. |
| `FitEpic.Api/Models/WebApp/Response/DashboardWorkoutsResponse.cs` | Add `DashboardWorkoutLogResponse` type and a nullable `Logs` list on `DashboardWorkoutExerciseResponse`. |
| `FitEpic.Services/Abstractions/Repositories/WebApp/IWebAppDashboardRepository.cs` | Add `DashboardScheduledWorkoutLogRaw` POCO; widen `DashboardScheduledWorkoutRaw` to optionally carry the raw log rows for that scheduled workout (or return them as a sibling `Dictionary<string, List<…>>` keyed by `ScheduledWorkoutId` from the same method). |
| `FItEpic.Api.Repositories/Repositories/WebApp/WebAppDashboardRepository.cs` | Add a fourth roundtrip: pull `WorkoutExerciseLogs` where `!IsDeleted` and `ScheduledWorkoutId` is in the set of *Completed* scheduled workouts in the date range. Project to `DashboardScheduledWorkoutLogRaw` (id, scheduledWorkoutId, workoutExerciseId, exerciseName, set/round/order, all `Actual*` fields, notes). Attach to the matching `DashboardScheduledWorkoutRaw` rows. |
| `FitEpic.Services/WebApp/WebAppDashboardService.cs` | In `BuildCard`, when status is Completed: group logs by `WorkoutExerciseId`; attach to the matching `DashboardWorkoutExercise`; for logs with no `WorkoutExerciseId`, group by `ExerciseName` and append synthetic `DashboardWorkoutExercise` entries (`Summary = ""`). Recompute `ExerciseCount` after appending. |

**`WorkoutLogSummaryBuilder` rules**

- Inputs: `(MeasurementType? parentType, DashboardScheduledWorkoutLogRaw log)`.
- Selects measurement type via:
  1. `parentType` when the log has a `WorkoutExerciseId` and we found the parent.
  2. Detection fallback: `ActualDurationSeconds` populated → `Time`; `ActualDistance` populated → `Distance`; `ActualCalories` populated → `Calories`; otherwise `Reps` (default).
- Formats per §1.1 per-log rules — no `sets ×` prefix, single-set form:
  - `Reps`: `"{actualReps} @ {weight} lbs"` if weight present, else `"{actualReps}"`. Empty if `actualReps` blank and weight 0.
  - `Time`: `"{m:ss}"` or `"{h:mm:ss}"` from `ActualDurationSeconds`.
  - `Distance`: `"{actualDistance} {unitLabel}"` (units `m`/`km`/`mi`/`ft`).
  - `Calories`: `"{actualCalories} cal"`.
- Returns `""` when no relevant actuals were recorded.

**Sort order within `logs`**

Per the spec: `OrderIndex` ascending, then `SetNumber` ascending as a tiebreaker. `RoundNumber` is preserved as-is on the wire and not used for sort.

**Repo query notes**

- The existing query already filters scheduled workouts down to a small date window. The logs query is keyed by the same `ScheduledWorkoutId` set, so the additional roundtrip is bounded.
- `dbContext.WorkoutExerciseLogs` is the DbSet (already used by Phase 1 for weight totals).
- Soft-deleted logs (`IsDeleted == true`) are excluded.
- Only fetch logs for *Completed* scheduled workouts to avoid pointless joins on Pending rows.

**Out of scope for this incremental change**

- Editing logs from the card (mutation) — Phase TBD.
- Detail pages that aggregate logs across many sessions — Phase TBD.

---

## 7. Change log

| Date | Author | Change |
|---|---|---|
| 2026-04-28 | Web App team | Initial draft |
| 2026-04-28 | Web App team | Mirrored Mobile rendering specifics: WorkoutScoreType enum + ScoreResult string + pre-formatted displayValue; exercise summary builder rules; raw-text fallback for non-straight-sets; Dismissed status; no truncation |
| 2026-04-28 | Web App team | Resolved completedAt guarantee, exerciseCount for raw-text workouts, empty-body placeholder; dropped `isStraightSets` in favor of a data-driven body picker |
| 2026-04-28 | Web App team | Replaced today/tomorrow/recent-completions structure with four calendar-based sections (yesterday, today, tomorrow, future). Removed all time-of-day relabel logic — Web App is a programming tool, not a real-time companion |
| 2026-04-28 | Web App team | Hide Dismissed workouts: filtered server-side and never delivered to the Web App. Locked future-window length at 7 days. Phase 2 ready for API team review |
| 2026-04-28 | API team | Removed `completedAt` from `DashboardWorkoutCard`; `ScheduledWorkout` has no completion timestamp and `UpdatedAt` isn't a safe proxy. Updated yesterday sort order to drop the `completedAt`-based key. See Addendum at top. |
| 2026-04-28 | API team | Documented `durationMinutes` source: `ScheduledWorkout.Duration` (athlete-logged) when present, falling back to `Workout.Duration` (prescribed). |
| 2026-04-28 | API team | Locked `workoutType` enum → display-string map (StraightSets → "Straight Sets", ForTime → "For Time", etc.). |
| 2026-04-28 | API team | Locked `scoreTypeDisplay` map for all 17 `WorkoutScoreType` values; `CustomNumeric` uses `Workout.ScoreLabel`. |
| 2026-04-28 | API team | Locked within-date sort tiebreaker: workout `name` ascending, case-insensitive. Applies to all four sections (yesterday/today/tomorrow as primary; future as tiebreaker after `scheduledDate`). |
| 2026-04-28 | API team | Deferred the Mobile controller rename + re-mount (architectural doc §2.5) out of this phase. Tracked separately. |
| 2026-04-28 | API team | Locked exercise `name` source: prefer linked standard exercise name, fall back to `UserEnteredExerciseName`. List ordering by `OrderIndex` ascending; soft-deleted excluded. |
| 2026-04-28 | API team | Added §6 API Implementation Plan: file layout, repo query, service responsibilities, mapping helpers, controller, serialization, Swagger, tests. |
| 2026-04-28 | API team | Implemented §§6.1–6.4 (file layout, repo query, service orchestration, helper mappings) and verified §§6.5–6.7 (controller wired in §6.1; enums already carry `[JsonStringEnumConverter]` so serialization is correct; Swagger inherits `[Tags("WebApp - Dashboards")]` and picks up XML doc from the API project). Tests (§6.8) deferred. |
| 2026-04-28 | API team | When `Sets` is null or 0, the server now returns `summary: ""` (was rendering a misleading `"1 set"`). Web App should suppress the summary line in that case. |
| 2026-04-28 | Web App team | Flipped body-picker priority: prefer `rawText` over `exercises`. When `rawText` wins, the `exercises` array is still returned so the UI can offer a secondary view of the parsed list. See Addendum at top. No API contract change. |
| 2026-04-29 | API team | Added athlete logs on completed cards. New `logs` array on each `exercises` entry; ad-hoc logs surface as synthetic exercise entries; `notes`, `setNumber`, `roundNumber` included; per-log `summary` formatted server-side via parent `MeasurementType` with detection fallback. Implementation plan in §6.10. |
