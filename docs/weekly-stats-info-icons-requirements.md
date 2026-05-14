# Weekly Stats Info Icons — Web App Requirements

Port the dashboard weekly-stats info icons from FitEpic.Mobile to FitEpic.WebApp.

## 1. Overview

The mobile dashboard renders a small circled-info glyph (ⓘ) at the top-right of three of the four weekly-stat cards. Tapping the glyph either pops a short explanatory dialog or navigates to a full breakdown page. The four cards on the mobile dashboard are:

| Card | Info icon? | Activation behavior |
|---|---|---|
| Workouts Completed | No | — |
| Total Workout Time | Yes | Navigate to a **Total Duration Details** page (week total + per-day breakdown) |
| Weight Lifted | Yes | Show short **modal/alert** with static explanatory text |
| Exercises | Yes | Show short **modal/alert** with static explanatory text |

Source files reviewed:
- [DashboardPage.xaml](../../FitEpic.Mobile/FitEpic.Mobile/DashboardPage.xaml) — info icon markup (lines 321, 366, 397)
- [DashboardViewModel.cs](../../FitEpic.Mobile/FitEpic.Mobile/ViewModels/DashboardViewModel.cs) — info commands (lines 478–500)
- [TotalDurationDetailsPage.xaml](../../FitEpic.Mobile/FitEpic.Mobile/Views/TotalDurationDetailsPage.xaml) — breakdown page
- [TotalDurationDetailsViewModel.cs](../../FitEpic.Mobile/FitEpic.Mobile/ViewModels/TotalDurationDetailsViewModel.cs) — breakdown VM
- [DashboardService.cs](../../FitEpic.Mobile/FitEpic.Mobile.Services/Implementations/DashboardService.cs) — `GetWeeklyDurationBreakdownAsync` (lines 23–51)

## 2. Exact Copy (must match mobile verbatim)

### Weight Lifted — modal
- **Title:** `Weight lifted this week`
- **Body:**
  > Total volume lifted across every set you've logged this week, calculated as weight × reps for each set. Sets without a logged weight are not counted.
- **Dismiss button:** `Got it`

### Exercises — modal
- **Title:** `Exercises this week`
- **Body:**
  > The total number of exercises across every workout you've completed this week. If a workout has 5 exercises and you complete it twice, that counts as 10.
- **Dismiss button:** `Got it`

### Total Workout Time — detail page (info banner at top)

> The total time you've spent on completed workouts this week. We use your logged duration when you set one, otherwise we fall back to the workout's time-based score or its prescribed length. Workouts without any time signal aren't counted — log a duration or a finish-time score to make sure your workout shows up here.

> **Note:** the mobile app's wording is narrower ("only workouts with a recorded duration are counted"). The web copy intentionally diverges because the API's inclusion rule is broader than mobile's local calculation — see §4.3.

Empty state on the detail page: `No completed workouts contributed to this week's time.`

## 3. Web App Changes

### 3.1 Icon affordance on stat cards

File: [fitepic-web-app/src/app/features/dashboard/dashboard-page.html](../fitepic-web-app/src/app/features/dashboard/dashboard-page.html) (stat-cards block, lines 48–89)

Add an info icon button to the **Total Workout Time**, **Weight Lifted**, and **Exercises** cards (do **not** add one to Workouts Completed). Each icon button:

- `<button mat-icon-button>` containing `<mat-icon fontSet="material-symbols-outlined">info</mat-icon>` (use the outlined Material Symbol — closest visual match to the mobile `ⓘ` glyph; an alternative is `help_outline`).
- Positioned absolutely in the card's top-right corner. Stat cards will need `position: relative` in [dashboard-page.scss](../fitepic-web-app/src/app/features/dashboard/dashboard-page.scss).
- Size: 16–18 px icon, ~32 px hit target.
- Color: a subdued token consistent with existing secondary text (e.g. `var(--fe-text-muted)` if available; otherwise reuse the same gray used for the stat label text). Should respect dark mode.
- `matTooltip="How is this calculated?"` and `aria-label="How is this calculated?"` for accessibility (parallels the mobile `SemanticProperties.Description`).
- Click on Weight Lifted / Exercises opens an info dialog; click on Total Workout Time navigates to the breakdown route.

### 3.2 Reusable info dialog

Two of the three icons (Weight Lifted, Exercises) show identical UX: short title + paragraph + single dismiss button. Implement a single reusable component to avoid duplication.

- **Location:** `fitepic-web-app/src/app/features/dashboard/info-dialog/info-dialog.ts` (and `.html`, `.scss`).
- **Implementation:** Angular Material `MatDialog` (`@angular/material/dialog`). This is the first dialog usage in the dashboard feature; `WorkoutDrawer` uses a custom backdrop, not a dialog, so `MatDialog` is a new addition for this work. Verify it is already a project dependency (Material v21 is installed).
- **Inputs:** `{ title: string; body: string; dismissLabel?: string }` via `MAT_DIALOG_DATA`. Default `dismissLabel` to `"Got it"`.
- **Open call:** `this.dialog.open(InfoDialogComponent, { data: { title, body }, autoFocus: 'dialog', restoreFocus: true, panelClass: 'fe-info-dialog' })`.
- **A11y:** dialog must trap focus, restore focus to the originating icon button on close, and be dismissable with `Escape`. `MatDialog` handles all of this by default.
- **Styling:** match existing surface tokens (`--fe-surface`, `--fe-text`). Constrain width to ~400 px on desktop, full-width minus margins on mobile.

In [dashboard-page.ts](../fitepic-web-app/src/app/features/dashboard/dashboard-page.ts):

```ts
private readonly dialog = inject(MatDialog);

protected openWeightLiftedInfo() {
  this.dialog.open(InfoDialogComponent, {
    data: {
      title: 'Weight lifted this week',
      body: "Total volume lifted across every set you've logged this week, calculated as weight × reps for each set. Sets without a logged weight are not counted.",
    },
  });
}

protected openExercisesInfo() { /* same pattern */ }
```

### 3.3 Total Duration Details page (new route)

New lazy-loaded route, mirroring how other dashboard pages are wired in [app.routes.ts](../fitepic-web-app/src/app/app.routes.ts).

- **Route path:** `/dashboard/weekly-stats/duration` (under the existing `authGuard`).
- **Component path:** `fitepic-web-app/src/app/features/dashboard/total-duration-details/total-duration-details-page.ts` (+ `.html`, `.scss`).
- **Navigation trigger:** the Total Workout Time info icon calls `this.router.navigate(['/dashboard/weekly-stats/duration'])`.
- **Back navigation:** breadcrumb or a back arrow (`<button mat-icon-button>` with `arrow_back`) in the page header, returning to `/`.

#### Page layout (top → bottom)

1. **Page header:** back button + page title `"Total workout time"`.
2. **Info banner** (Material card or `<div>` with the existing surface token): the explanatory paragraph from §2 above. Visually distinct from the stat tile (lighter background, smaller font, info icon next to text).
3. **Week total:** large heading showing the week's aggregate, formatted in long form — `"2 hours and 15 minutes"` (or `"45 minutes"` when under an hour, `"0 minutes"` when zero). Sub-label `"This week"`. **Always render `response.totalDurationMinutes` directly — do not sum `items[].durationMinutes` and display that** (ceiling-rounding makes the two diverge; see §4.4). This number must agree with the value on the dashboard card.
4. **Grouped list** of workouts that contributed to the total:
   - Group header per date, formatted like `"Monday, May 12"` (athlete's local timezone, parsed from `scheduledDate`).
   - Each row inside a group: workout name (bold) on the left, duration (e.g. `"45m"` or `"1h 10m"`) on the right in the primary brand color.
   - Sort: trust the API order (`scheduledDate` DESC, then `workoutName` ASC case-insensitive) — no client-side resort needed.
5. **Empty state:** if `workoutCount === 0`, show only the info banner and the empty-state line from §2.

#### Loading & error states
- Initial: skeleton placeholder for the banner, total, and 2–3 list rows, matching the pattern in the existing dashboard.
- Error: Material card with a short message and a retry button, mirroring the error handling already present in [dashboard-page.ts](../fitepic-web-app/src/app/features/dashboard/dashboard-page.ts) (lines 88–96), including the `getWebAppErrorCode` + `ProfileService.ensureTimezone()` recovery path for timezone errors.

### 3.4 API client wiring

**Status: client regenerated.** `npm run gen:api` against the locally-running API has already produced:

- [api-webapp-dashboards-weekly-stats-duration-breakdown-v-1-get.ts](../fitepic-web-app/src/app/core/api/generated/fn/web-app-dashboards/api-webapp-dashboards-weekly-stats-duration-breakdown-v-1-get.ts)
- [weekly-stats-duration-breakdown-response.ts](../fitepic-web-app/src/app/core/api/generated/models/weekly-stats-duration-breakdown-response.ts)
- [weekly-stats-duration-breakdown-item-response.ts](../fitepic-web-app/src/app/core/api/generated/models/weekly-stats-duration-breakdown-item-response.ts)

Call the generated function from `TotalDurationDetailsPage` using the same `firstValueFrom(...)` + `signal()` pattern used in `DashboardPage` (see [dashboard-page.ts](../fitepic-web-app/src/app/features/dashboard/dashboard-page.ts) lines 88–96 for the timezone-error recovery pattern to copy).

### 3.5 State / signals

`TotalDurationDetailsPage` should expose three signals:

- `loading = signal(true)`
- `errorCode = signal<string | null>(null)`
- `data = signal<WeeklyStatsDurationBreakdownResponse | null>(null)`

A `computed()` should bucket items by `scheduledDate` and produce display-formatted strings (long date header, short duration cell). Mirror the mobile [TotalDurationGroupUIModel](../../FitEpic.Mobile/FitEpic.Mobile/Models/TotalDurationGroupUIModel.cs).

### 3.6 Tests / verification (manual)

- Tooltip + click both work and are keyboard-accessible (Tab + Enter/Space).
- Dialog text matches the copy in §2 exactly.
- Detail page total equals the Total Workout Time card on the dashboard for the same week.
- Empty week → only banner + empty-state line.
- Refresh on the detail page survives a hard reload (no reliance on transient state from the dashboard).
- Dark mode renders correctly.

## 4. API Contract (delivered)

> **Status: shipped.** The endpoint is live in the API and our OpenAPI client has been regenerated (see §3.4). This section now documents the **actual delivered contract** for the web team's reference. See the API team's full plan in [`FitEpic.Api/readmes/weekly-stats-duration-breakdown-api-plan.md`](../../FitEpic.Api/readmes/weekly-stats-duration-breakdown-api-plan.md).

Two of the three icons need **no API support** — the dialog copy for Weight Lifted and Exercises is static client-side text. Only the Total Workout Time breakdown is backed by an endpoint.

### 4.1 Endpoint

`GET /api/webapp/dashboards/weekly-stats/duration-breakdown/v1`

- **Auth:** JWT bearer, same as other `/api/webapp/dashboards/*` endpoints (athlete id from `ClaimTypes.NameIdentifier`).
- **Inputs:** none. Week is "the current week in the athlete's profile timezone" — Monday 00:00 through Sunday 23:59:59, identical to the existing weekly-stats endpoint.
- **Caching:** `Cache-Control: private, max-age=30`, matching the other dashboard reads.

### 4.2 Response shape

```jsonc
{
  "weekStart": "2026-05-11",         // Monday, athlete tz, ISO date
  "weekEnd":   "2026-05-17",         // Sunday, athlete tz, ISO date
  "totalDurationMinutes": 135,       // SOURCE OF TRUTH for the week total
  "workoutCount": 4,                 // count of items
  "items": [
    {
      "scheduledWorkoutId": "…",
      "workoutName": "Upper Body A",
      "scheduledDate": "2026-05-12", // athlete tz, ISO date
      "durationMinutes": 45
    }
    // …
  ]
}
```

### 4.3 Inclusion rule (broader than mobile)

The API team broadened the inclusion rule beyond what the original requirements proposed. A scheduled workout is in the result iff:

- It is `Completed`.
- Its parent `Workout` is not soft-deleted.
- At least one of these resolves to a strictly-positive duration, **in priority order**:
  1. The athlete-logged `ScheduledWorkout.Duration`.
  2. A time embedded in `ScoreResult` when `ScoreType` is one of:
     - `TimeToComplete` — `mm:ss`
     - `TimeCapPlusReps` — leading `mm:ss` before the `+`
     - `TimeAndLoad` — leading `mm:ss` before the `|`
     Each accepts `m:ss`, `mm:ss`, or `h:mm:ss`.
  3. The prescribed `Workout.Duration` (covers AMRAP/EMOM/Tabata/Intervals where the athlete completed the prescribed window without separately logging time).

**Implication for web copy:** the original info-banner text ("only workouts with a recorded duration are counted") is now inaccurate — a workout with no logged duration but a parseable time-based score, or a prescribed parent duration, **will** show up. §2 of this doc has already been updated with softened copy.

### 4.4 Rounding — read carefully

Both `totalDurationMinutes` and each `items[].durationMinutes` are `Math.Ceiling` to the nearest whole minute.

**Per-item ceilings do NOT always sum to `totalDurationMinutes`.** Example: three workouts of 24 seconds each → three `1m` items but a total of `2m` (the total ceilings the raw `1m12s` sum, not the rounded items).

- Always display `response.totalDurationMinutes` for the week total.
- Display each item's `durationMinutes` per row.
- Never compute the total by client-side summing of items.

### 4.5 Card / detail invariant

`weekly-stats/v1.Stats.TotalDurationMinutes` and `duration-breakdown/v1.totalDurationMinutes` are guaranteed to be equal for the same week — the API team updated the card endpoint to share the new effective-duration resolver and ceiling rounding. **If they ever disagree, that is a bug — flag to the API team.**

### 4.6 Errors

Standard `WebAppErrorEnvelope` with the same codes the other dashboard endpoints emit:

| Code | HTTP | Recovery |
|---|---|---|
| `PROFILE_TIMEZONE_REQUIRED` | 400 | Call `ProfileService.ensureTimezone()` then retry (same flow as `DashboardPage`). |
| `INVALID_TIMEZONE` | 400 | As above. |
| `PROFILE_NOT_FOUND` | 404 | Route to `/settings`. |
| `UNAUTHENTICATED` | 401 | Existing global handling. |

Empty week → `200 OK` with `items: []`, `workoutCount: 0`, `totalDurationMinutes: 0`, and correct `weekStart`/`weekEnd`. Never `404`, never `null` items.

## 5. Out of Scope

- No analytics/event tracking on icon clicks unless requested separately.
- No persisted "user has seen this tooltip" state — the dialog is always available.
- No breakdowns for Weight Lifted or Exercises beyond the static modal copy (mobile parity).
- No changes to the four stat values themselves; this work only adds the info affordance.
