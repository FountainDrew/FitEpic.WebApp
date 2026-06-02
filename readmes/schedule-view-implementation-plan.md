# Schedule View — Web App Implementation Plan

**Date:** 2026-05-28
**Status:** Draft v1 — API contract accepted; spec verified against `http://localhost:5244/swagger/v1/swagger.json`. Ready to start.
**Audience:** FitEpic.WebApp team
**Companion docs:**
- [schedule-view-requirements.md](./schedule-view-requirements.md) — product / UX requirements
- [schedule-view-api-requirements.md](./schedule-view-api-requirements.md) — web app's API proposal + Appendix A (decisions)
- [FitEpic.Api/readmes/schedule-view-webapp-contract.md](../../FitEpic.Api/readmes/schedule-view-webapp-contract.md) — locked API contract

---

## Spec verification (2026-05-28)

Pulled swagger from `http://localhost:5244/swagger/v1/swagger.json`. Both endpoints match the contract exactly:

| Endpoint | Tag | Status |
|---|---|---|
| `GET /api/webapp/schedule/calendar/v1` | `WebApp - Schedule` | ✅ shape matches contract §4 |
| `GET /api/webapp/schedule/list/v1` | `WebApp - Schedule` | ✅ shape matches contract §6 |

Schema deltas vs the dashboard surface:

- `DashboardWorkoutCardResponse` gains `programmedByAthleteId: string \| null` and `isLocked: boolean`. The docstring on `isLocked` confirms the scope clarified in contract Appendix A.2.1: *"this flag gates schedule-shape mutations only. Per-athlete result writes — logging, marking complete, scoring, notes, duration, exercise logs — remain allowed regardless of this flag."*
- New models: `CalendarScheduleResponse`, `CalendarDayResponse` (42 entries, includes `inDisplayMonth` flag), `ScheduleListResponse`.
- `WebAppErrorCode` enum gains `INVALID_CURSOR`.
- Past/future cursors are query params `pastCursor` / `futureCursor`; response fields are `pastNextCursor` / `futureNextCursor`. Both nullable.
- `pastLimit` / `futureLimit` are optional (server defaults 50, clamps to ≤ 200).

No changes to the contract are needed. Proceeding with implementation.

---

## Resolutions baked into this plan

From [contract Appendix A](../../FitEpic.Api/readmes/schedule-view-webapp-contract.md) and Appendix A of the web app's [API requirements](./schedule-view-api-requirements.md):

- **Past UX:** infinite scroll using `pastNextCursor`, default `pastLimit = 50` per fetch. Debounce / in-flight guard prevents request chaining.
- **Selected-date reset on month nav:** if `response.today` is inside the new `[windowStart, windowEnd]`, select today; otherwise select the 1st of the displayed month.
- **Coach-on-behalf:** **not** exposed on `/schedule`. Athlete-self only; coach surface stays on gym oversight pages.
- **Dot colors:** mobile parity — `#FF9500` (Pending), `#34C759` (Completed).
- **`isLocked` semantics:** drives drawer reschedule/unschedule visibility only. Logging, completion, scoring, notes, duration, exercise logs remain available on locked rows. The drawer must switch from its current `trainingGroupName`-based proxy ([workout-drawer.ts:69](../fitepic-web-app/src/app/features/dashboard/workout-drawer/workout-drawer.ts#L69)) to `isLocked`.
- **No coach-icon affordance.** `programmedByAthleteId` is consumed off the wire (so the regen + types stay correct) but **not rendered**. Every current-day path that populates the field is a coach scheduling through a gym/group, and those rows already show the `"{Gym}: {Group}"` chip from `trainingGroupName` — a coach icon next to it would be redundant. The personal Schedule page is not the right surface to grow gym-specific affordances.

---

## Phase 0 — Foundation

Regenerate the client and wire the two new card fields through existing surfaces so nothing else has to special-case them.

- [ ] Run `npm run gen:api` against the live spec. Review the diff in `src/app/core/api/generated/` — expect:
  - New service functions under `fn/web-app-schedule/`.
  - New models: `calendar-schedule-response.ts`, `calendar-day-response.ts`, `schedule-list-response.ts`.
  - Updated `dashboard-workout-card-response.ts` (added `programmedByAthleteId`, `isLocked`).
  - `web-app-error-code.ts` adds `'INVALID_CURSOR'`.
- [ ] Commit the regen as its own commit before any hand-written changes, so the rest of the diff is small.
- [ ] Update [workout-drawer.ts](../fitepic-web-app/src/app/features/dashboard/workout-drawer/workout-drawer.ts):
  - [ ] Rename `isGroupWorkout` → `isLocked`, source from `card.isLocked` instead of `Boolean(card.trainingGroupName)`.
  - [ ] Audit every consumer of `isGroupWorkout` in the drawer template/scss; the new field has the same intent (hide reschedule/unschedule) but is contract-canonical.
  - [ ] Keep `trainingGroupName` for the *display* chip — it is still the source of truth for the "{Gym}: {Group}" label.
- [ ] **No changes to [workout-card.ts](../fitepic-web-app/src/app/features/dashboard/workout-card/workout-card.ts).** The new `programmedByAthleteId` field is on the wire but the personal-surface cards (dashboard + schedule) deliberately do not render it — the `"{Gym}: {Group}"` chip from `trainingGroupName` already conveys gym/coach context where it matters. See [Resolutions](#resolutions-baked-into-this-plan).
- [ ] Smoke-test the existing Dashboard page: the two new fields are now present on every card; the dashboard's visual output should be unchanged. The only behavior change is the drawer's reschedule/unschedule gate, which is now sourced from `isLocked` rather than inferred from `trainingGroupName`.

---

## Phase 1 — Routes, nav, page scaffold, data service

Get the route live, a nav item visible, and a thin data service in place so subsequent phases just fill in the view.

- [ ] Add the route in [app.routes.ts](../fitepic-web-app/src/app/app.routes.ts) under the auth-guarded shell:
  ```ts
  {
    path: 'schedule',
    pathMatch: 'full',
    loadComponent: () => import('./features/schedule/schedule-page').then((m) => m.SchedulePage),
  }
  ```
- [ ] Add a nav item in [nav-items.ts](../fitepic-web-app/src/app/layout/admin-shell/nav-items.ts) between Dashboard and Gyms:
  ```ts
  { label: 'Schedule', icon: 'event', route: '/schedule' },
  ```
- [ ] Create the feature directory:
  ```
  src/app/features/schedule/
    schedule-page.ts
    schedule-page.html
    schedule-page.scss
    schedule.service.ts
  ```
- [ ] `schedule.service.ts` — thin Angular service wrapping the generated functions:
  - [ ] Inject `HttpClient` + `ApiConfiguration`.
  - [ ] `loadCalendar(year: number, month: number)` → returns a Promise of `CalendarScheduleResponse`, wraps `apiWebappScheduleCalendarV1Get`.
  - [ ] `loadList(opts: { pastCursor?; futureCursor?; pastLimit?; futureLimit? })` → returns `ScheduleListResponse`, wraps `apiWebappScheduleListV1Get`.
  - [ ] Centralize timezone-required recovery the same way [dashboard-page.ts:190](../fitepic-web-app/src/app/features/dashboard/dashboard-page.ts#L190) `handleTimezoneRequired` does (or extract that into a shared helper if it's the second consumer).
- [ ] `schedule-page.ts` — top-level component (signals-based, no NgModule, follows the dashboard-page pattern):
  - [ ] State: `viewMode = signal<'calendar' | 'list'>('calendar')` (per requirements §4.1, calendar is the default on first entry — note this matches the **mobile** default, not what the requirements doc text said earlier; verify with design if unsure).
  - [ ] State: `selectedDate = signal<string | null>(null)`.
  - [ ] State: `calendar = signal<CalendarScheduleResponse | null>(null)`, `calendarLoading = signal(true)`, `calendarError = signal<string | null>(null)`.
  - [ ] State: `list = signal<ScheduleListResponse | null>(null)`, similar loading/error signals plus `pastLoading`, `futureLoading` for the infinite-scroll guard.
  - [ ] Subscribe to `WorkoutDrawerService.actionCompleted` in the constructor with `takeUntilDestroyed()` to refresh whichever view is active (parallel to dashboard).
  - [ ] Render the `WorkoutDrawer` component at the page level so card taps open the drawer (parallel to dashboard).
- [ ] Add a `routeRef` constant so the dashboard's `openDrawer` query-param pattern can be replicated later if needed (out of scope for v1).

---

## Phase 2 — Calendar view

Render the grid, indicators, selected-date list, and month navigation off a single calendar response.

- [ ] **Month state** in `schedule-page.ts`:
  - [ ] `displayedYear = signal(today.getFullYear())`, `displayedMonth = signal(today.getMonth() + 1)`.
  - [ ] `effect()` triggers `loadCalendar()` whenever the displayed year/month changes; discard late responses whose `(year, month)` does not match the current state.
  - [ ] On first load, after calendar arrives, initialize `selectedDate` to the response's `today` field.
- [ ] **Month-nav controls** in template:
  - [ ] Header `mat-icon-button` for `‹` (`chevron_left`) and `›` (`chevron_right`) flanking a centered month label `MAY 2026` (formatted from `displayedYear`/`displayedMonth`, uppercase via SCSS `text-transform`).
  - [ ] On click, decrement / increment `displayedMonth`, rolling year as needed.
  - [ ] Disable both buttons while `calendarLoading()` is true (prevent rapid clicks chaining requests).
- [ ] **Day-of-week header row** (`SU MO TU WE TH FR SA`) above the grid. Static labels, no signals.
- [ ] **42-cell grid** rendered from `calendar()?.days ?? []`:
  - [ ] Use CSS Grid with 7 columns; each cell ~48px tall.
  - [ ] Per cell, render a circular button with the day number.
  - [ ] Class flags driven by template bindings:
    - `--today` when `day.date === calendar().today` → filled primary background, white text.
    - `--selected` when `day.date === selectedDate()` → secondary outline / fill.
    - `--adjacent-month` when `!day.inDisplayMonth` → dimmed text.
  - [ ] **Indicator dots** under the day number, inline row of two ellipses:
    - Orange `#FF9500` when `day.hasPending`.
    - Green `#34C759` when `day.hasCompleted`.
    - Both can render together.
  - [ ] Clicking a cell sets `selectedDate.set(day.date)`. No re-fetch needed — selected-date workouts are filtered from `calendar()?.workouts` in a `computed`.
  - [ ] `aria-label` per cell: `"{full date}, {Today | Selected | empty}, {Has pending workouts | Has completed workouts}"` (mirrors mobile [CalendarDayUIModel.cs:50](../../FitEpic.Mobile/FitEpic.Mobile/Models/CalendarDayUIModel.cs#L50)).
- [ ] **Selected-date pane** below the grid:
  - [ ] `selectedDateWorkouts = computed(() => calendar()?.workouts.filter(w => w.scheduledDate === selectedDate()).sort(pendingFirst) ?? [])`.
  - [ ] Heading: full date display, e.g. `Friday, May 29` (use `DatePipe` with `'EEEE, MMMM d'`).
  - [ ] List renders `<app-workout-card [card]="w" />` per item.
  - [ ] Empty state: `No workouts scheduled for this date.`
- [ ] **Selected-date reset on month nav** (per the resolved A.3 Q2):
  - [ ] In the calendar `effect()`, after `calendar.set(response)`:
    - If `selectedDate()` is already inside `[response.windowStart, response.windowEnd]`, keep it.
    - Else if `response.today` is inside the window, set `selectedDate.set(response.today)`.
    - Else set `selectedDate.set(firstOfMonth(response.year, response.month))`.
- [ ] **Loading state** — first load only:
  - [ ] Show a skeleton matching the calendar shape (month-header skeleton, day-of-week labels, 6×7 grid of skeleton circles). Reuse `.skeleton` from `styles.scss`.
  - [ ] Subsequent month navigations show a subtle overlay or do nothing — the data is in flight but the grid stays interactive; debounce-disabled chevrons cover the race.
- [ ] **Month transition animation** (optional v1):
  - [ ] Add a CSS class `--sliding-left` / `--sliding-right` toggled when month changes; transitions `transform: translateX(...)` on the grid container.
  - [ ] If this proves fiddly, ship without — the requirements doc explicitly says the animation is a follow-up if costly.

---

## Phase 3 — List view

Render the five buckets with infinite scroll on Past.

- [ ] **Initial fetch** in `schedule-page.ts`: when `viewMode()` becomes `'list'` for the first time, call `scheduleService.loadList({})` and set `list.set(response)`.
- [ ] **Bucket rendering** in template — order top-to-bottom:
  1. `Today` — heading `Today`, cards from `list().today`.
  2. `Tomorrow` — heading `Tomorrow`, cards from `list().tomorrow`.
  3. `Yesterday` — heading `Yesterday`, cards from `list().yesterday`.
  4. `Future` — heading `Future`, cards from `list().future`. Within the bucket, sub-headings (`Wednesday, June 3`) appear above the first card of each new date; use a small client helper `groupByDate()`.
  5. `Past` — heading `Past`, same sub-heading rule as Future.
- [ ] **Empty bucket handling:** hide the heading entirely when the bucket is empty. If *every* bucket is empty, show the global empty state: heading `No scheduled workouts`, subtext `Open a workout and tap 'Schedule' to add it here.`
- [ ] **Infinite scroll for Past:**
  - [ ] Use a sentinel `<div #pastSentinel>` at the bottom of the past list.
  - [ ] Set up an `IntersectionObserver` in the page's `afterNextRender` callback that fires when the sentinel enters the viewport.
  - [ ] On intersection: if `list().pastNextCursor` is non-null AND `pastLoading()` is false, call `scheduleService.loadList({ pastCursor: list().pastNextCursor })` and append the returned `past` array onto the existing list, replacing `pastNextCursor` with the new value.
  - [ ] Show a small skeleton row at the bottom while `pastLoading()` is true.
- [ ] **Future pagination:** same pattern with a sentinel at the bottom of the Future bucket. (Future is bounded in practice but the contract gives us a cursor — wire it.)
- [ ] **Error handling:** if a cursor fetch fails with `INVALID_CURSOR`, drop the cursor, reset the bucket to its current contents, and show an inline retry. (Should not happen in practice — cursors are stateless — but the code path needs to exist.)

---

## Phase 4 — View toggle

- [ ] Pill toggle component at the top of the content area, two segments: **Calendar** (left, `mat-icon` `calendar_month`) and **List** (right, `mat-icon` `format_list_bulleted`).
  - [ ] Use `mat-button-toggle-group` with custom styling to get the pill look, OR a small custom component (the dashboard does not have a precedent; either is fine).
  - [ ] Bound to `viewMode()` signal.
- [ ] On toggle, do **not** re-fetch already-loaded data. Each view has its own state and they live independently for the page's lifetime.
- [ ] Toggle state is **not** persisted across full page exits — fresh navigation always lands on Calendar (per requirements §4.1 and mobile parity).
- [ ] Keyboard support: tablist semantics on the toggle (arrow keys move focus, Enter / Space activates). `mat-button-toggle-group` provides this out of the box.

---

## Phase 5 — FAB / entry points

Match the mobile UX with two action entry points: **Schedule Workout** and **Create Workout**, both pre-filling the selected date when present.

- [ ] Add a floating action button (or header-button pair — design's call; defer to the dashboard's pattern if there is one).
- [ ] **Schedule Workout** action: open the existing [dashboard-schedule-dialog.ts](../fitepic-web-app/src/app/features/dashboard/dashboard-schedule-dialog.ts) flow.
  - [ ] Pre-fill the dialog's date when `viewMode() === 'calendar'` and `selectedDate()` is non-null.
  - [ ] After successful scheduling, refresh whichever view is currently active.
- [ ] **Create Workout** action: navigate to `/workouts/new` with `?scheduleDate={selectedDate}&returnUrl=/schedule` when a date is selected; otherwise plain navigation (parallel to [dashboard-page.ts:255](../fitepic-web-app/src/app/features/dashboard/dashboard-page.ts#L255)).
- [ ] On mobile / narrow viewports, the FAB stays bottom-right with the same backdrop behavior the mobile app uses; on desktop it can also sit in a header bar — match the existing app shell's convention.

---

## Phase 6 — Polish, accessibility, dark theme

- [ ] **Light + dark themes:** every new color value comes from theme tokens. The two hard-coded indicator-dot colors (`#FF9500` / `#34C759`) are intentional — design-locked by Q4 — and live in the SCSS as named variables `$schedule-pending-dot` / `$schedule-completed-dot` for easy redirection later.
- [ ] **Calendar a11y:**
  - Keyboard navigation: arrow keys move focus between days, Home/End to start/end of week, PgUp/PgDn between months, Enter selects.
  - Day cells use `role="gridcell"` inside a `role="grid"` container with the day-of-week header row carrying `role="row"`.
- [ ] **List a11y:** each bucket heading is a heading element (`<h2>`); date sub-headings are `<h3>`. Cards remain keyboard-activatable via the existing `WorkoutCard`.
- [ ] **Toggle a11y:** if hand-rolled, expose `role="tablist"` + `role="tab"`; `mat-button-toggle-group` already handles this.
- [ ] **Empty / error states:** verify all three (no workouts, network error, profile-timezone-required) render and the retry path works.
- [ ] **Late response discard:** add a unit test for the `(year, month)` mismatch case in the calendar effect.
- [ ] **Drawer refresh contract:** verify that completing / unscheduling / rescheduling from inside the drawer triggers `WorkoutDrawerService.actionCompleted`, which the page must consume and refresh accordingly.

---

## Phase 7 — Cleanup

- [ ] Remove the `isGroupWorkout` shim in the drawer if anything still references it.
- [ ] Search the codebase for any other place that derives "is locked" from `trainingGroupName` and switch to `isLocked`.
- [ ] Confirm `npm run lint` and `npm run test` pass.
- [ ] Run the dev server and exercise the golden path in a browser: open `/schedule`, navigate months, select dates, toggle to list, scroll past, open a card, complete / reschedule / unschedule.
- [ ] Verify the dashboard still works — Phase 0 changes the card shape system-wide.

---

## Files touched (preview)

| File | Action | Phase |
|---|---|---|
| `fitepic-web-app/api/swagger.json` | regen | 0 |
| `src/app/core/api/generated/**` | regen | 0 |
| `src/app/features/dashboard/workout-drawer/workout-drawer.ts` | edit (`isLocked` rewire) | 0 |
| `src/app/features/dashboard/workout-card/workout-card.{ts,html,scss}` | no change (field on wire, not rendered) | 0 |
| `src/app/app.routes.ts` | edit | 1 |
| `src/app/layout/admin-shell/nav-items.ts` | edit | 1 |
| `src/app/features/schedule/schedule.service.ts` | create | 1 |
| `src/app/features/schedule/schedule-page.{ts,html,scss}` | create | 1–6 |
| `src/app/features/schedule/calendar-view/*` | create (optional split) | 2 |
| `src/app/features/schedule/list-view/*` | create (optional split) | 3 |
| `src/app/features/schedule/group-by-date.ts` | create | 3 |

(Splitting calendar-view / list-view into child components is recommended once the page exceeds ~300 lines; not required by the contract.)

---

## Risks & follow-ups

- **Bundled `workouts[]` payload size** for power-user months (100+ scheduled). Contract §8 estimates ~200 KB upper bound; we'll keep an eye on Lighthouse / network panel during integration testing. If problematic, the API team has a fallback ready (`?includeWorkouts=false` + range endpoint per contract §5).
- **Month-transition animation** is best-effort v1. Ship without if the implementation is fragile; reopen as a polish ticket.
- **FAB vs. header-button** treatment on desktop — defer to the existing design system convention; the mobile-style FAB is portable but may not match the rest of the web app.

---

## Acceptance

- [ ] All checkboxes in Phases 0–7 are closed.
- [ ] The page passes the acceptance checklist in [schedule-view-requirements.md §13](./schedule-view-requirements.md#13-acceptance-checklist).
- [ ] No regressions on the Dashboard page after Phase 0 ships.
- [ ] Lint + unit tests pass; manual smoke test of the golden path documented in the PR description.
