# Schedule View — API Requirements

> Companion to [schedule-view-requirements.md](./schedule-view-requirements.md). This document tells the API team what new (or modified) endpoints the web app needs to ship the athlete-facing `/schedule` page.

## 1. Why we need new endpoints

The web app today consumes `GET /api/webapp/dashboards/workouts/v1` ([WebAppDashboardsController.cs:77](../../FitEpic.Api/FitEpic.Api/Controllers/WebApp/WebAppDashboardsController.cs#L77)), which returns four fixed buckets — yesterday / today / tomorrow / future (7-day window). That endpoint is purpose-built for the dashboard and is **not** sufficient for the new Schedule page, which needs:

- An arbitrary **calendar month window** (could be the current month, several months in the past, or several months ahead).
- **Per-day indicator flags** for every visible day in the calendar grid (6 weeks = up to 42 days, often spanning two adjacent months) so we can render orange/green dots without loading full card data for every day.
- A **flat list** (List view) of every scheduled workout the athlete has — past and future — to produce the Today / Tomorrow / Yesterday / Future / Past buckets per [schedule-view-requirements.md §4.3](./schedule-view-requirements.md#43-list-view). This list cannot be unbounded; we need server-side bounds with the option to paginate or window.

The existing **mobile** endpoints (`POST /scheduledworkouts/sync`, delta pull) are unsuitable because they're offline-first sync surfaces that return raw `ScheduledWorkout` rows without the workout-name, exercise-summary, score-display, gym/group hydration the card needs. The dashboard already does this hydration server-side via `IWebAppDashboardService` → `DashboardWorkoutCard` ([DashboardWorkoutCard.cs](../../FitEpic.Api/FitEpic.Api.ServiceModels/WebApp/DashboardWorkoutCard.cs)) — we want the same hydration pattern here.

## 2. Endpoints requested

### 2.1 `GET /api/webapp/schedule/calendar/v1`

**Purpose.** Drive the Calendar view's month grid + selected-date list in a single round-trip.

**Query parameters.**

| Name | Type | Required | Notes |
|---|---|---|---|
| `year` | int | yes | Calendar year in the athlete's profile timezone. |
| `month` | int (1..12) | yes | Calendar month in the athlete's profile timezone. |

**Date-range semantics.** The server computes the visible 6-row × 7-column grid for `(year, month)` in the athlete's profile timezone, identically to how the web client lays it out. That window is `[firstSunday(month), firstSunday(month) + 41 days]` (Sunday-start, 42 cells). Indicator + card data covers every date in that window — including leading/trailing days from adjacent months — so a single request hydrates the whole grid plus the user's selected day on first load.

**Response shape.**

```jsonc
{
  "year": 2026,
  "month": 5,
  "windowStart": "2026-04-26",   // first cell (could be in prior month)
  "windowEnd":   "2026-06-06",   // last cell (could be in next month)
  "today":       "2026-05-28",   // resolved in athlete profile timezone
  "days": [
    { "date": "2026-04-26", "hasPending": false, "hasCompleted": false },
    { "date": "2026-04-27", "hasPending": true,  "hasCompleted": false },
    // ...exactly 42 entries, one per cell, in date order
  ],
  "workouts": [
    // Every non-dismissed scheduled workout whose ScheduledDate falls inside
    // [windowStart, windowEnd]. Same DashboardWorkoutCard shape as today.
    { "id": "...", "name": "...", "workoutType": "AMRAP", "scheduledDate": "2026-05-12", ... }
  ]
}
```

**Why `days[]` and `workouts[]` are both included.** The grid only needs the boolean indicators (`days[]`) to render the dots — sending it as a compact array means we don't bloat the response when the month has dozens of workouts. The `workouts[]` array drives the selected-date list below the grid; co-locating it in the same response avoids a second round-trip when the user lands on the page (they always land on a selected day) and means month navigation only fetches once per month, not once for the grid and once for each tap.

If the workout volume in a month is high enough that returning every card is a concern, an acceptable alternative is to make `workouts[]` opt-in via a `?includeWorkouts=true` flag and add a separate endpoint per §2.3 — but the simpler bundled shape is preferred.

**Hydration rules.** Each card in `workouts[]` is the same `DashboardWorkoutCardResponse` shape that `GET /api/webapp/dashboards/workouts/v1` returns. That means:
- `trainingGroupName` already includes the gym name in the same `"{Gym}: {Group}"` format the dashboard uses ([WebAppDashboardService](../../FitEpic.Api/FitEpic.Services/WebApp/WebAppDashboardService.cs)).
- Exercises are summarized via `DashboardWorkoutExercise` (we don't need exercise-log detail at the list level — that's loaded by the drawer).
- `status` excludes `Dismissed` rows (matches dashboard behavior).
- Group rows have their per-athlete completion fields merged in (mobile equivalent: v6 group-workout-results model — same merge required here so the Pending/Completed badge reflects *this athlete's* state, not the group template).

**Errors.** Same `error.code` set as the dashboard endpoints:

- `PROFILE_TIMEZONE_REQUIRED` (400)
- `INVALID_TIMEZONE` (400)
- `PROFILE_NOT_FOUND` (404)
- `UNAUTHENTICATED` (401)
- `MONTH_OUT_OF_RANGE` (400) — `month` outside 1..12, `year` below 1900. Unlike monthly-stats, future months **are** allowed for the schedule view (the athlete may want to plan ahead).

### 2.2 `GET /api/webapp/schedule/list/v1`

**Purpose.** Drive the List view's five buckets (Today / Tomorrow / Yesterday / Future / Past).

**Why a dedicated endpoint** rather than reusing the calendar endpoint or the dashboard endpoint:
- The dashboard endpoint's future window is 7 days; the list view's "Future" bucket has no upper bound short of "all upcoming work".
- The dashboard endpoint has no "Past" bucket; the list view does.
- Bucketing server-side keeps the client trivial and lets the API team apply pagination on the open-ended buckets (past, future) without the client having to merge ranges.

**Query parameters.**

| Name | Type | Required | Notes |
|---|---|---|---|
| `pastLimit` | int | no, default 50 | Max items in the `past[]` bucket, newest-first. |
| `futureLimit` | int | no, default 50 | Max items in the `future[]` bucket, soonest-first. |
| `pastCursor` | string | no | Opaque cursor for paging further into the past. |
| `futureCursor` | string | no | Opaque cursor for paging further into the future. |

Today / Yesterday / Tomorrow are unbounded — they cover at most a few rows.

**Response shape.**

```jsonc
{
  "todayDate": "2026-05-28",
  "yesterday": [ /* DashboardWorkoutCardResponse[] */ ],
  "today":     [ /* ... */ ],
  "tomorrow":  [ /* ... */ ],
  "future":    [ /* ... */ ],
  "past":      [ /* ... */ ],
  "pastNextCursor":   "...",   // null when no more
  "futureNextCursor": "..."
}
```

**Ordering rules** (server enforces; client trusts the order):

- `yesterday`, `today`, `tomorrow`: Pending first, then Completed; within each, stable order by `scheduledDate` then `id`.
- `future`: ascending `scheduledDate`, then Pending before Completed.
- `past`: descending `scheduledDate`, then Pending before Completed.

**Errors.** Same set as §2.1, minus `MONTH_OUT_OF_RANGE`.

### 2.3 (Optional) `GET /api/webapp/schedule/range/v1`

Only needed if the response shape in §2.1 turns out to be too heavy for high-volume athletes (e.g., the answer to "should `workouts[]` be opt-in" is "yes"). In that case, expose a thin range endpoint that takes `from` and `to` (`DateOnly`) and returns the same `DashboardWorkoutCardResponse[]`, so the client can fetch just the selected day's workouts on demand.

Defer building this until §2.1 is in use and we know whether the bundled shape causes pain.

## 3. Mutating endpoints (already covered)

The schedule page does **not** introduce new mutations. All write paths — log workout, mark complete, reschedule, unschedule — are already triggered from inside the existing **workout drawer**, which uses these endpoints today:

- Reschedule / unschedule: existing webapp endpoints behind `WorkoutDrawer.unschedule()` and `WorkoutDrawer.reschedule()` ([workout-drawer.ts](../fitepic-web-app/src/app/features/dashboard/workout-drawer/workout-drawer.ts)).
- Logging / completion: drawer-owned.

After any drawer mutation succeeds, `WorkoutDrawerService.notifyActionCompleted()` fires and the schedule page will re-fetch its current view (same pattern the dashboard uses). **No API change needed** to support this.

## 4. Cross-cutting requirements

### 4.1 Timezone

Every date math operation — `today`, calendar grid boundaries, list-view bucket boundaries, ordering — runs in the athlete's profile timezone. This is the same rule already enforced on the dashboard endpoints; the schedule endpoints must use the existing helpers in `WebAppDashboardService` / `EffectiveDurationResolver` rather than relying on the request's wall clock.

### 4.2 Caching

`Cache-Control: no-store` on every response, matching the API's global policy. The schedule page is real-time-ish — coaches and athletes both expect a fresh completion to show up immediately.

### 4.3 Dismissed workouts

Excluded from every response. Same rule as the dashboard endpoint.

### 4.4 Group-targeted rows

Treated identically to the dashboard:

- The athlete sees rows targeting any training group they are a current member of.
- Per-athlete completion fields (`status`, `scoreResult`, `notes`, `duration`, exercise logs) reflect *this* athlete, not the group template.
- `trainingGroupName` is set to `"{Gym}: {Group}"` and is the signal the client uses to render the group header.
- `isLocked` is always `true` for group rows — the client uses this to hide the inline reschedule/unschedule actions in the drawer for these rows.

Athletes who join a group mid-program follow the existing §7.1 "mid-flight" rule (no API change required — same as today).

### 4.5 Pagination cursors

If pagination is added per §2.2, cursors are opaque server-controlled strings. The client treats them as black boxes and never parses them. Cursors expire after `7 days` (or whatever the existing convention is for similar endpoints).

### 4.6 OpenAPI / generated clients

All new endpoints must show up in the OpenAPI document with full request/response schemas, the same `WebAppErrorEnvelope` shape on error, and discriminated `error.code` values. The web client regenerates its typed API from this spec, so completeness here directly unblocks the implementation.

## 5. Performance & sizing

- A typical athlete who trains 4×/week has ~17 scheduled workouts in a month → `workouts[]` in §2.1 is in the low double digits per request.
- A power user (multiple programs, group + personal) could plausibly hit 100+ per month. The bundled response size should still be acceptable, but the API team should sanity-check against representative production data before merging.
- The List view's `past`/`future` buckets are the only ones with an upper bound concern; the defaults in §2.2 (50 each) keep the initial payload small while letting users paginate.

## 6. Out of scope for the API team

- Coach-facing oversight schedules (gym/group endpoints already exist under `GymsController` / `TrainingGroupsController`).
- Workout *creation* and *scheduling* mutations — the FAB on the new page reuses the existing `POST /scheduledworkouts/sync` flow via the existing client services.
- The workout drawer's load endpoint — it already loads details from existing surfaces.

## 7. Acceptance checklist for the API team

- [ ] `GET /api/webapp/schedule/calendar/v1?year={y}&month={m}` returns the 42-day window per §2.1 with `days[]` indicators, `workouts[]` cards, and `today` resolved in the athlete's profile timezone.
- [ ] `GET /api/webapp/schedule/list/v1` returns the five buckets per §2.2 in the documented order with pagination cursors on `past` and `future`.
- [ ] Group-targeted rows are merged with this-athlete completion state (parallel to dashboard behavior).
- [ ] Dismissed rows are excluded from every response.
- [ ] All error responses use `WebAppErrorEnvelope` and the documented `error.code` values.
- [ ] `Cache-Control: no-store` on every 2xx response.
- [ ] OpenAPI spec updated; types regenerate cleanly in the web app's `core/api/generated/` directory.
- [ ] Integration tests cover: month with no workouts, month spanning a daylight-savings transition, group + personal rows in the same month, athlete on the calendar's leading/trailing days, pagination cursor round-trip on `past`/`future`.

---

# Appendix A — Clarifications after the API team's contract review

This appendix captures the web app team's response to [schedule-view-webapp-contract.md](../../FitEpic.Api/readmes/schedule-view-webapp-contract.md) (API team draft). It is part of the same contract negotiation — anything below is the web app's confirmation / clarification on a point the API team raised.

## A.1 Responses to the API team's §9 open questions

| § | Question | Web app response |
|---|---|---|
| 9.1 | Adding `programmedByAthleteId` and `isLocked` to the shared `DashboardWorkoutCardResponse` — additive, no breaking change. | **Confirmed.** The existing dashboard card component (`features/dashboard/workout-card/`) silently ignores fields it doesn't render. After regen, both fields will be present on every dashboard response too — no consumer change required. |
| 9.2 | Bundled `days[] + workouts[]` for v1 (no `?includeWorkouts=` flag). | **Confirmed.** The reasoning in contract §5 matches the web app's own position. |
| 9.3 | 42-element `days[]` with `inDisplayMonth` flag. | **Confirmed — keep `inDisplayMonth`.** The cost is trivial and it prevents every client (web + any future mobile parity) from re-deriving the value from `windowStart`. |
| 9.4 | Cursor opacity — clients never parse, mutate, or compare. | **Confirmed.** The web client treats `pastNextCursor` / `futureNextCursor` as black-box strings and only sends them back unchanged on the next request. |
| 9.5 | Hard cap of `200` on `pastLimit` / `futureLimit`. | **See A.3 Q1** — depends on the past-pagination UX choice. The default `50` is fine; the cap may or may not matter. |
| 9.6 | `INVALID_CURSOR` joins the shared `WebAppErrorCode` enum. | **Confirmed.** That's the right home — it's an envelope-level concern, not endpoint-specific. |

## A.2 Behavioral clarifications the contract leaves implicit

These were not in the contract but the web client needs them pinned down before implementation.

### A.2.1 `isLocked` scope

`isLocked = true` means **only** that Reschedule / Unschedule are hidden in the workout drawer. The athlete **can** still:

- Tap Log to record their own performance.
- Mark the row Complete and submit a score / notes / duration / exercise logs.
- Re-open a completed row and clear their own logs.

In other words, `isLocked` gates *schedule-shape mutations* (which date the row sits on, whether it exists), not *per-athlete result writes*. Group-targeted rows merge in this athlete's `ScheduledGroupWorkoutAthleteResult`, which is owned by the athlete and remains writable.

If this matches the API team's intent (the contract §3.1 wording is consistent with it), no change needed — flagging it so the implementation plan can't drift.

### A.2.2 `programmedByAthleteId` is consumed but not rendered on the personal Schedule

A coach scheduling for a group sets **both** `trainingGroupName` and `programmedByAthleteId`. The web client consumes both off the wire (so the regen + types stay correct) but **only renders `trainingGroupName`** — as the `"{Gym}: {Group}"` chip in the card header.

Reasoning: every current-day path that populates `programmedByAthleteId` is a coach scheduling through a gym/group (the legacy peer-`ProgramWorkouts` flow now `403`s per `MobileScheduledWorkoutsController` docstring). On those rows, the group chip already conveys the gym/coach context — a second coach-icon affordance would be redundant signal. The personal Schedule page is also deliberately not the right surface to grow gym-specific affordances; the gym oversight pages own that.

**No API change.** The field stays on the wire; we just don't paint it on the personal dashboard or schedule today.

### A.2.3 Selected-date persistence vs. calendar window

The Schedule page persists `selectedDate` in client state across month navigation. The calendar endpoint only ever returns workouts for the displayed 42-cell window, so when the user navigates the grid forward / backward past the previously selected date, the selected date can fall **outside** the response's window.

The web client will handle this by **resetting `selectedDate`** when the user navigates to a month whose window does not contain the prior selected date — see [A.3 Q2](#a3-questions-for-product) for the chosen reset target. **No API change needed.**

### A.2.4 Calendar endpoint and `today` for late responses

The contract echoes `year`, `month`, and `today` back. The web client treats a late response (e.g., user navigated away from the requested month before the response arrived) as discardable — it compares the response's `(year, month)` against the currently-displayed month and drops the response on mismatch. **No API change needed**, just confirming the echo fields are used as intended.

### A.2.5 Cursor lifetime

Contract §6.3 states cursors are stateless. The web app interprets that as **no expiry** — the same cursor remains valid as long as the underlying `(scheduledDate, id)` keyset is still valid for the caller. If the API team intends to introduce TTL later, please call it out in the OpenAPI description and use a distinct error code (not `INVALID_CURSOR`) so the client can distinguish "your cursor expired, refetch from the top" from "your cursor was malformed".

### A.2.6 Empty calendar months

For a month where the athlete has zero scheduled workouts in the entire 42-cell window:

- `days[]` is still exactly 42 entries, all with `hasPending = hasCompleted = false`.
- `workouts[]` is `[]`.

This is implicit in the contract but worth pinning so it doesn't come back as a 204 / omitted-field surprise.

## A.3 Product decisions (resolved 2026-05-28)

The four items below were tagged for product review and have been resolved. None of them change the wire shape committed in [schedule-view-webapp-contract.md](../../FitEpic.Api/readmes/schedule-view-webapp-contract.md) — they pin down client UX so the implementation plan can proceed.

### Q1. Past pagination UX — **Infinite scroll**

The List view's `past` bucket auto-fetches the next page using `pastNextCursor` when the user scrolls near the bottom.

- The default `pastLimit = 50` is fine for the initial fetch.
- A debounce / "in flight" guard prevents chaining requests if the user scrolls fast.
- The 200-row hard cap on `pastLimit` per request is comfortably above what an infinite-scroll fetch will request (we'll stick with the default 50 per call). **No change to the API contract.**

### Q2. Selected-date reset on month navigation — **Today if visible, else 1st of month**

When the displayed month changes and the previously selected date is no longer inside the new 42-cell window:

- If `today` (resolved from the calendar response's `today` field) is inside the new window → select today.
- Otherwise → select the 1st of the displayed month.

The selected-date pane resolves entirely from the `workouts[]` array in the same calendar response — no second fetch is required, no API change. The client uses `response.today` for the "is today visible" check rather than `Date.now()` so timezone behavior matches the server.

### Q3. Coach-on-behalf surface on the Schedule page — **No, athlete-self only**

The Schedule page's workout drawer exposes the **athlete's own** log / complete / reschedule / unschedule flows only. The coach-on-behalf write surface (`WriteResultOnBehalfAsync` in `IScheduledWorkoutService`) stays on the gym oversight pages where it already lives (mirrors mobile). The Schedule page does not need to call it and does not need to surface a UI affordance for it. **No API change.**

### Q4. Indicator-dot colors — **Mobile parity**

Calendar day indicators use `#FF9500` (orange) for Pending and `#34C759` (green) for Completed, matching mobile. The Schedule page ships with these tokens; if design wants web-specific tokens later, it's a CSS change with no API impact.

## A.4 Sign-off

With §9 (contract) and A.3 (product) both resolved, the web app team's position on the contract is **accepted**. The API team can proceed to `readmes/schedule-view-implementation-plan.md`.
