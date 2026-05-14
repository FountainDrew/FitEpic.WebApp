# Monthly Stats — Web App Requirements

Port the mobile **Monthly Stats** view to the FitEpic web app. The mobile page is a month-at-a-time comparison dashboard — five aggregated metrics (workouts, days worked out, time, weight, exercises), each shown alongside the previous month with progress bars, a delta, and (when the current month isn't over yet) a "paced" comparison against the previous month at the same calendar day.

## 1. Source of Truth

Mobile reference files (read in full before implementing):

- [MonthlyStatsPage.xaml](../../FitEpic.Mobile/FitEpic.Mobile/Views/MonthlyStatsPage.xaml) — layout
- [MonthlyStatsViewModel.cs](../../FitEpic.Mobile/FitEpic.Mobile/ViewModels/MonthlyStatsViewModel.cs) — orchestration, formatting, deltas
- [MonthlyStatItemUIModel.cs](../../FitEpic.Mobile/FitEpic.Mobile/Models/MonthlyStatItemUIModel.cs) — per-card UI model
- [DashboardService.cs](../../FitEpic.Mobile/FitEpic.Mobile.Services/DashboardService.cs) `GetMonthlyStatsAsync` (lines 53–88) + `CalculateMonthlyStats` (lines ~90–145) — aggregation logic
- [MonthlyStatsResult.cs](../../FitEpic.Mobile/FitEpic.Mobile.Services/Models/Dashboard/MonthlyStatsResult.cs) — service contract
- [MonthlyStats.cs](../../FitEpic.Mobile/FitEpic.Mobile.Services/Models/Dashboard/MonthlyStats.cs) — per-month record

Mobile computes this locally from SQLite. The web port will instead hit a new API endpoint (see §4).

## 2. What ships

### 2.1 Page: `MonthlyStatsPage`

- **Location:** [src/app/features/dashboard/monthly-stats/](../fitepic-web-app/src/app/features/dashboard/monthly-stats/) — new folder, three files (`monthly-stats-page.ts` / `.html` / `.scss`), following the [total-duration-details](../fitepic-web-app/src/app/features/dashboard/total-duration-details/) pattern from the recent weekly-duration work.
- **Route:** `'/dashboard/monthly-stats'`, lazy-loaded under the existing `authGuard`, added to [app.routes.ts](../fitepic-web-app/src/app/app.routes.ts) alongside the existing `dashboard/weekly-stats/duration` route.
- **Optional query params:** `?year=YYYY&month=MM` (1–12). When absent, defaults to "current month in the athlete's timezone." Used so that month nav can be deep-linked / refresh-safe.
- **Standalone component**, signals for state, `firstValueFrom(...)` for the API call — same idioms as `DashboardPage` and `TotalDurationDetailsPage`.

### 2.2 Entry points (how users get there)

Two affordances:

1. **From the dashboard:** add a `"Monthly view →"` text-button below the four weekly stat cards (or as a small link in the page header next to the "Week of…" range). Style consistent with existing dashboard secondary actions.
2. **Deep-linkable URL:** anyone with `/dashboard/monthly-stats?year=2026&month=4` can jump straight in.

Do **not** add a new top-level sidebar item — keep it as a drill-down off the dashboard, parallel to the Total Duration page.

### 2.3 Page layout (top → bottom)

```
┌───────────────────────────────────────────────────────────┐
│  ←  Monthly stats                                          │   page header (back to dashboard)
├───────────────────────────────────────────────────────────┤
│  [ ‹ ]      April 2026      [ › ]                         │   month navigator
│             Compared to March 2026                         │   (only if previous month exists)
├───────────────────────────────────────────────────────────┤
│  ┌─ Workouts Completed ───────────────────────────┐       │
│  │  12                                              │       │   big primary-colored value
│  │  ────────────────────────                        │       │
│  │  Apr ████████████████░░░░░░░ 12                  │       │   current bar
│  │  Mar ████████░░░░░░░░░░░░░░░ 7                   │       │   previous bar (desaturated)
│  │  +5 ↑   compared to last month                   │       │   delta (green/red/gray)
│  │  +2 ↑   compared to last month after 15 days     │       │   paced (only if HasPacedComparison)
│  └──────────────────────────────────────────────────┘       │
│  ┌─ Days Worked Out ───────────────────────────────┐       │
│  │  9 / 30                                          │       │
│  │  ...                                              │       │
│  └──────────────────────────────────────────────────┘       │
│  ... three more cards: Total Workout Time, Weight Lifted,   │
│  Exercises ...                                              │
└───────────────────────────────────────────────────────────┘
```

#### Page header
- Back button (`<button mat-icon-button routerLink="/">` with `arrow_back`) — same pattern as `TotalDurationDetailsPage`.
- Title: `"Monthly stats"`.

#### Month navigator
- Three-column row: prev button — month label — next button.
- Prev/next: `<button mat-icon-button>` with `chevron_left` / `chevron_right` Material Symbols (do **not** use unicode glyphs as mobile does — Material icons keep styling consistent on web).
- Month label: large (24–28 px), centered, e.g. `"April 2026"`.
- Subline beneath label (when previous month is present): `"Compared to March 2026"`, 13 px muted.
- **Next disabled** when current view is the athlete's current calendar month (the API tells us via `hasNextMonth`).
- **Prev never disabled** — users can scroll back arbitrarily far. The API responds with empty data for months before the athlete had any activity; the page should handle that gracefully (see Empty state, §2.5).
- Navigation updates the URL via `router.navigate(..., { queryParams: { year, month } })` so reload/share works.

#### Stat cards (one card per metric, stacked vertically on mobile, two-column grid on wide screens)

Each card contains:

1. **Title** (e.g., `"Workouts Completed"`) — 15 px, semi-bold, muted.
2. **Primary value** (e.g., `"12"`, `"9 / 30"`, `"5h 23m"`, `"12,345 lbs"`) — 28 px, bold, primary color. Renders `"—"` for time when the month has no recorded duration (mobile behavior, [MonthlyStatsViewModel.cs:209](../../FitEpic.Mobile/FitEpic.Mobile/ViewModels/MonthlyStatsViewModel.cs#L209)).
3. **Comparison bars** (only when previous month exists and either month has activity):
   - Current month: bar fills `currentProgress` of the row width, primary color.
   - Previous month: bar fills `previousProgress`, desaturated/lighter primary.
   - Each row labeled left (`"Apr"`, `"Mar"`) and right (the value).
   - **Both progresses are scaled to `max(current, previous)`** — the longer bar is full-width, the shorter is proportional. Apply a floor (e.g., `0.04`) so a non-zero value never renders as zero-width, matching mobile's `BarMinProgress`.
4. **Delta line** (only when comparison is shown): e.g., `"+5 ↑  compared to last month"`. Color-coded:
   - Up — `--fe-streak-pill-text` (green)
   - Down — `--fe-danger` (red)
   - Same — `--fe-text-muted`
   - Use `arrow_upward` / `arrow_downward` / `remove` Material icons (or unicode arrows — pick one and stay consistent).
5. **Paced delta line** (only when API returns `previousAtSameDay` data, i.e. mid-month): `"+2 ↑  compared to last month after 15 days"`. Same color coding.

#### Five cards, in this order (matches mobile)

| Card | Primary value formatting | Notes |
|---|---|---|
| Workouts Completed | integer | |
| Days Worked Out | `"{daysWorkedOut} / {daysInMonth}"` | Comparison bars use `daysWorkedOut` only — the `/ daysInMonth` is purely display. |
| Total Workout Time | `"Xh Ym"` or `"Ym"` | `"—"` when both months have zero recorded duration. Source-of-truth is `totalDurationMinutes` from the API (ceiling-rounded, see §4); do not sum a breakdown client-side. |
| Weight Lifted | `"12,345 lbs"` (thousands separator, no decimal) | |
| Exercises | integer | Counts exercises performed across completed workouts; a workout with 5 exercises completed twice = 10. |

### 2.4 Loading / error / empty states

- **Loading** — skeleton placeholders for the month nav and each card (mirror the `DashboardPage` skeleton approach). Mobile uses a centered spinner; the web should match the existing skeleton aesthetic instead.
- **Error** — `<mat-card class="error-card">` with message + Retry button. Reuse `getWebAppErrorCode(err)` + `ProfileService.ensureTimezone()` recovery, exactly like `DashboardPage` and `TotalDurationDetailsPage`.
- **Empty month** (current month has zero activity AND no previous-month data) — render all five cards with zero values and a thin note `"No workouts logged this month yet."` above them. **Do not** suppress the cards entirely (matches mobile).
- **No previous month** — hide the `"Compared to {previousMonth}"` subline, hide comparison bars, hide delta lines. Just show the primary value.

### 2.5 Computed display fields

Each card receives an API response and renders. Two small client-side computations are needed:

1. **Delta direction** — `up | down | same | none`:
   - If `previous == null` → `none`.
   - If `current > previous` → `up`; `current < previous` → `down`; equal → `same`.
2. **Progress fractions** — `currentProgress`, `previousProgress`:
   - `max = Math.max(current, previous, 0)`.
   - If `max === 0`: both = 0.
   - Else: `current/max`, `previous/max`, then floor each at `0.04` if the underlying value is non-zero.

Mirror these from [MonthlyStatsViewModel.cs:154–224](../../FitEpic.Mobile/FitEpic.Mobile/ViewModels/MonthlyStatsViewModel.cs#L154-L224). No need to extract a shared helper across cards — five card configs in a `computed()` is fine.

### 2.6 Accessibility

- Prev/next buttons get `aria-label="Previous month"` / `"Next month"`.
- Each comparison bar pair: wrap in `role="group"` with `aria-label="Workouts Completed comparison: April 12, March 7"` so screen-reader users get the comparison without relying on the bars.
- Delta lines should be visible text (not icon-only), so screen readers pick them up naturally.

## 3. Web App Changes — file checklist

- [ ] **New folder** [src/app/features/dashboard/monthly-stats/](../fitepic-web-app/src/app/features/dashboard/monthly-stats/):
  - `monthly-stats-page.ts` — standalone component, signals for `data`, `loading`, `error`, query-param-driven `year`/`month`, computed card configs.
  - `monthly-stats-page.html` — header, month nav, five cards (using `@for` over a computed card array, not five hand-written blocks).
  - `monthly-stats-page.scss` — uses `--fe-surface`, `--fe-border`, `--fe-text`, `--fe-text-muted`, `--fe-primary`, `--fe-streak-pill-text` (green), `--fe-danger` (red). Two-column grid above ~720 px breakpoint, single column below.
- [ ] **Optional small subcomponent** `monthly-stat-card.ts` if the card markup gets long — judgment call during implementation. Don't pre-create it.
- [ ] **Update** [app.routes.ts](../fitepic-web-app/src/app/app.routes.ts) — add the lazy route under the existing `authGuard` shell.
- [ ] **Update** [dashboard-page.html](../fitepic-web-app/src/app/features/dashboard/dashboard-page.html) — add a `"Monthly view →"` link/button near the stat cards. The handler in [dashboard-page.ts](../fitepic-web-app/src/app/features/dashboard/dashboard-page.ts) does `this.router.navigate(['/dashboard/monthly-stats'])`.
- [ ] **Regenerate OpenAPI client** after the API ships (`npm run gen:api`) — the generator will produce `api-webapp-dashboards-monthly-stats-v-1-get.ts` and the two response models listed in §4.4.
- [ ] **No new Material modules required** beyond what the dashboard already imports (`MatCardModule`, `MatButtonModule`, `MatIconModule`, `MatTooltipModule`). The mobile app uses a `MatSelect` nowhere; we don't need it either — chevron buttons drive navigation.

## 4. API Contract (delivered)

> **Status: shipped.** The endpoint is live and our OpenAPI client has been regenerated. See the API team's full plan in [`FitEpic.Api/readmes/monthly-stats-api-plan.md`](../../FitEpic.Api/readmes/monthly-stats-api-plan.md). This section now documents the **actual delivered contract**.

### 4.1 Endpoint

`GET /api/webapp/dashboards/monthly-stats/v1?year={YYYY}&month={1..12}`

- **Auth:** JWT bearer, athlete id from `ClaimTypes.NameIdentifier`, same as other `/api/webapp/dashboards/*` endpoints.
- **Caching:** `Cache-Control: private, max-age=30`, matching the other dashboard reads.

### 4.2 Query parameters

| Name | Type | Required | Default | Notes |
|---|---|---|---|---|
| `year` | int | no | current year (athlete tz) | `>= 1900`, `<=` athlete-tz current year |
| `month` | int | no | current month (athlete tz) | `1..12`; `(year, month)` must be `≤` athlete current month |

Either or both may be omitted; missing ones default to the athlete's current calendar year/month in their profile timezone.

### 4.3 Response shape

```jsonc
{
  "year": 2026,
  "month": 4,
  "hasNextMonth": true,
  "current":            { /* MonthlyStatsPeriodResponse */ },
  "previous":           { /* MonthlyStatsPeriodResponse */ } | null,
  "previousAtSameDay":  { /* MonthlyStatsPeriodResponse */ } | null
}
```

`MonthlyStatsPeriodResponse`:

```jsonc
{
  "year": 2026,
  "month": 4,
  "daysInMonth": 30,
  "daysElapsed": 15,
  "workoutsCompleted": 12,
  "workoutsScheduled": 18,
  "exercisesPerformed": 47,
  "totalWeightLiftedLbs": 12345,
  "totalDurationMinutes": 323,
  "workoutsWithDuration": 9,
  "daysWorkedOut": 9
}
```

### 4.4 Generated client paths

**Status: regenerated.** `npm run gen:api` has produced:

- [api-webapp-dashboards-monthly-stats-v-1-get.ts](../fitepic-web-app/src/app/core/api/generated/fn/web-app-dashboards/api-webapp-dashboards-monthly-stats-v-1-get.ts) — function takes `year?` and `month?` as typed `Params`.
- [monthly-stats-response.ts](../fitepic-web-app/src/app/core/api/generated/models/monthly-stats-response.ts) — top-level wrapper.
- [monthly-stats-period-response.ts](../fitepic-web-app/src/app/core/api/generated/models/monthly-stats-period-response.ts) — per-month inner record.

`MONTH_OUT_OF_RANGE` is now a recognized member of [WebAppErrorCode](../fitepic-web-app/src/app/core/api/generated/models/web-app-error-code.ts), so `getWebAppErrorCode(err)` will narrow correctly when comparing against it.

### 4.5 When each block is populated

- **`current`** — always present. For past months it covers the full month (`daysElapsed === daysInMonth`). For the current month it's truncated to "today inclusive" in the athlete's timezone.
- **`previous`** — `null` only when the previous month has **zero non-deleted scheduled workouts** for the athlete. Use this as the signal to hide comparison bars and the delta line.
- **`previousAtSameDay`** — `null` whenever any of: the requested month is a past complete month, the previous month has no data, or you're on the last day of the current month. Otherwise it's the previous month truncated to `min(current.daysElapsed, previous.daysInMonth)` days.
- **`hasNextMonth`** — server-authoritative; use it to enable/disable the chevron-right button. Don't recompute from `new Date()` — the browser's "now" and the athlete's profile timezone can diverge by hours.

### 4.6 Inclusion rules (semantics)

Same as the existing weekly card and duration-breakdown endpoint — no surprises:

- **`workoutsScheduled`** — every non-deleted scheduled-workout row in the window, **including Dismissed**. Bounded by "today" for the current month (so on April 15 the value reflects April 1–15, not the full month).
- **`workoutsCompleted`** — subset of above with `Status == Completed`.
- **`exercisesPerformed`** — sum of each completed workout's parent template's non-deleted exercise count. A workout with 5 exercises completed twice contributes 10.
- **`totalWeightLiftedLbs`** — sum of `actualWeight × parseInt(actualReps)` (or just `actualWeight` if reps don't parse to a positive integer). Logs without a positive recorded weight are skipped.
- **`totalDurationMinutes`** — broadened rule from the weekly-duration-breakdown endpoint: effective duration is the first positive of logged `Duration` → time-based `ScoreResult` (`TimeToComplete` / `TimeCapPlusReps` / `TimeAndLoad`) → prescribed parent `Workout.Duration`. Sum, then `Math.Ceiling` to the nearest whole minute.
- **`workoutsWithDuration`** — count of completed workouts whose effective duration resolved to a positive `TimeSpan`. **Broader than mobile** (mobile counts only logged `sw.Duration`). If the page surfaces a "Workouts with logged duration" label, **soften** it to something like *"Workouts with a recorded time"*.
- **`daysWorkedOut`** — distinct count of `ScheduledDate` values among completed workouts in the window.
- **`daysElapsed`** — `(effectiveEnd − monthStart) + 1` in the athlete's timezone. Equals `daysInMonth` for past months and for the `previous` block.

### 4.7 Subtleties worth knowing before wiring the page

These come from the API team's handoff notes and are easy to get wrong:

1. **`workoutsScheduled` mid-month is bounded by today**, not the full month. So on April 15 you'll see `"18 scheduled"` even if the athlete has 30 rows on the April calendar. This is deliberate — keeps the paced comparison apples-to-apples. If we ever need "X of 30 planned this month," that's a new field, not a client-side computation.
2. **Per-row duration totals don't exist on this endpoint.** Trust `totalDurationMinutes`; don't try to back-compute from elsewhere.
3. **`hasNextMonth` is server-authoritative.** Don't recompute from the browser's clock — profile tz and browser tz can differ by hours.
4. **Empty months are `200`, not `404`.** Render the cards with zeros + the helper note rather than treating it as an error.
5. **Cross-endpoint consistency.** The same `EffectiveDurationResolver` is used everywhere on this API, so weekly card → duration breakdown → monthly stats stay internally consistent.

### 4.8 Errors

| Code | HTTP | Recovery |
|---|---|---|
| `MONTH_OUT_OF_RANGE` | 400 | Show inline error. Don't retry. (Defends against malformed URL params — the chevron-right is disabled at the boundary so normal nav never triggers it.) |
| `PROFILE_TIMEZONE_REQUIRED` | 400 | `ProfileService.ensureTimezone()` then retry, same recovery path as the dashboard. |
| `INVALID_TIMEZONE` | 400 | Same. |
| `PROFILE_NOT_FOUND` | 404 | Route to `/settings`. |
| `UNAUTHENTICATED` | 401 | Existing global handling. |

## 5. Things the mobile app doesn't do, and we don't either

Out of scope for this port:

- No per-day calendar heatmap. The mobile page is monthly-aggregate only. If we want a heatmap later, that's a separate spec.
- No month picker calendar widget (`MatDatepicker`). Chevron navigation only. Direct URL is the alternative for jumping.
- No swipe gestures.
- No CSV/PDF export.

## 6. Verification checklist

Manual verification once the API ships and the page is built:

- [ ] `/dashboard/monthly-stats` (no params) loads the current month in athlete tz.
- [ ] Reload with `?year=2026&month=2` brings back the exact same view.
- [ ] Prev navigates to the previous month and updates the URL.
- [ ] Next disabled when current month is the athlete's current month.
- [ ] Each card's primary value matches the equivalent rollup computed by spot-checking the data.
- [ ] Card / page values stay consistent with the dashboard's weekly card when overlap is meaningful (same inclusion rule).
- [ ] Empty month renders cards with zeros + the helper note, not a blank screen.
- [ ] Missing profile timezone triggers the existing recovery flow (same as Dashboard).
- [ ] Skeletons appear on load; error card appears on a forced 500; retry restores the page.
- [ ] Dark mode renders correctly across all colors (bars, deltas, muted text).
- [ ] Tab navigation reaches both chevron buttons and the back arrow; tooltips appear on focus.

---

## Appendix — Mobile field → API field mapping

| Mobile `MonthlyStats` field | API field | Notes |
|---|---|---|
| `Year` | `year` | |
| `Month` | `month` | |
| `DaysInMonth` | `daysInMonth` | |
| `DaysElapsed` | `daysElapsed` | |
| `WorkoutsCompleted` | `workoutsCompleted` | |
| `WorkoutsScheduled` | `workoutsScheduled` | |
| `ExercisesPerformed` | `exercisesPerformed` | |
| `TotalWeightLifted` | `totalWeightLiftedLbs` | rename adds units, matches existing weekly DTO |
| `TotalDuration` (`TimeSpan`) | `totalDurationMinutes` (int) | ceiling-rounded; matches existing weekly DTO |
| `WorkoutsWithDuration` | `workoutsWithDuration` | |
| `DaysWorkedOut` | `daysWorkedOut` | |

`MonthlyStatsResult.Current/Previous/PreviousAtSameDay/HasNextMonth` map directly onto the response root.
