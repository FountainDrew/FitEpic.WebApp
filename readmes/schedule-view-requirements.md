# Schedule View — General Requirements

> Web port of the mobile dashboard's schedule surface. The mobile feature lives at [Views/SchedulePage.xaml](../../FitEpic.Mobile/FitEpic.Mobile/Views/SchedulePage.xaml) and is driven by [ScheduleViewModel.cs](../../FitEpic.Mobile/FitEpic.Mobile/ViewModels/ScheduleViewModel.cs) / [BaseScheduleViewModel.cs](../../FitEpic.Mobile/FitEpic.Mobile/ViewModels/BaseScheduleViewModel.cs). Reference the [Schedule_CalendarView_Plan.md](../../FitEpic.Mobile/FitEpic.Mobile/Schedule_CalendarView_Plan.md) for the original mobile implementation plan.

## 1. Overview

The Schedule page lets the authenticated athlete browse their scheduled workouts (personal + group-targeted) in two interchangeable views: a **List view** grouped by relative date, and a **Calendar view** showing one month at a time with per-day completion indicators and a workout list pinned beneath the grid for the selected date.

It is a peer to the Dashboard inside the web app's main shell. Athletes use the dashboard for "what's happening right now"; they use the Schedule page to look across days and weeks, find a specific workout, reschedule it, or jump into logging.

## 2. Out of scope

- The **coach-side gym oversight** schedule (mobile `GroupScheduleViewModel`, web `gym-schedule-*`). This document is for the athlete's personal schedule only.
- Creating new workouts. The page links into the existing create/schedule flows but does not own them.
- Editing scheduled-workout details inline. Tap-through opens the existing workout drawer/details page.

## 3. Route & shell placement

| Item | Value |
|---|---|
| Route | `/schedule` |
| Auth | Authenticated athletes only (same guard as `/dashboard`) |
| Nav | Top-level item in the primary navigation, adjacent to Dashboard |
| Page title | "Schedule" |

## 4. View modes

### 4.1 Mode toggle

- A pill-style two-segment toggle is centered at the top of the content area: **Calendar** (left, calendar icon) and **List** (right, bulleted-list icon).
- Default mode on first entry is **Calendar** (matches mobile `IsCalendarView = true` default in [BaseScheduleViewModel.cs:35](../../FitEpic.Mobile/FitEpic.Mobile/ViewModels/BaseScheduleViewModel.cs#L35)).
- Toggle state is **not persisted** across full page exits — every fresh entry resets to Calendar.
- Switching modes is instantaneous (no loading state); the underlying data is shared between modes.

### 4.2 Calendar view

**Header.** A month/year label (e.g., `MAY 2026`, uppercase) centered between `‹` and `›` chevron buttons that move the displayed month forward/backward one calendar month at a time.

**Day grid.**
- Seven-column layout, day-of-week header row `SU MO TU WE TH FR SA` (always starts on Sunday, matching mobile).
- Always 42 cells (6 rows × 7 columns) covering the full visible month plus leading/trailing days from adjacent months. Leading/trailing days are visually dimmed.
- Each cell shows the day number plus up to two small dot indicators below:
  - **Orange dot** (`#FF9500`) — at least one **Pending** workout on that date.
  - **Green dot** (`#34C759`) — at least one **Completed** workout on that date.
  - Both dots can appear together.
- **Today** is highlighted (filled primary-color circle, white day number).
- **Selected day** is a distinct state (subtle secondary fill or ring) — today + selected can coexist and today's styling wins.
- Tapping a day selects it; selection state lives in memory for the page lifetime.

**Selected-date list.** Below the grid:
- Heading: full date display, e.g., `Friday, May 29`.
- A vertically stacked list of workout cards for that date, ordered Pending → Completed.
- Empty state copy when no workouts exist for the selected date: `No workouts scheduled for this date.`

**Month transitions.** Horizontal swipe / arrow click animates the month grid sliding out and the next month sliding in (matches the mobile `AnimateMonthTransitionAsync` in [SchedulePage.xaml.cs:115](../../FitEpic.Mobile/FitEpic.Mobile/Views/SchedulePage.xaml.cs#L115)). Web should use a comparable CSS transition; if the engineering cost is high, ship without the animation and follow up.

**Default selection.** First entry selects **today**. When the displayed month changes, the previously selected date is retained — if it is not in the visible month, no day shows the "selected" highlight but the date pinned below the grid stays current.

### 4.3 List view

A scrollable vertically-stacked list of workout groups. Groups are derived from `AllWorkouts` and appear in this fixed order (see [BaseScheduleViewModel.cs:137](../../FitEpic.Mobile/FitEpic.Mobile/ViewModels/BaseScheduleViewModel.cs#L137) `RefreshAllViews`):

1. **Today** — workouts where `ScheduledDate == today`. Header label: `Today`.
2. **Tomorrow** — workouts where `ScheduledDate == today + 1`. Header label: `Tomorrow`.
3. **Yesterday** — workouts where `ScheduledDate == today − 1`. Header label: `Yesterday`.
4. **Future** — workouts where `ScheduledDate > tomorrow`, ascending by date. Header label: `Future`. Each item is sub-headed by its absolute date (`Wednesday, June 3`) when it is the first item for that date.
5. **Past** — workouts where `ScheduledDate < yesterday`, descending by date. Header label: `Past`. Same sub-heading rule as Future.

Within each group, items are ordered with **Pending before Completed** so the actionable rows surface first.

Empty state (no scheduled workouts at all): a centered message — heading `No scheduled workouts`, subtext `Open a workout and tap 'Schedule' to add it here.`

## 5. Workout card

Both views reuse the same card component (mobile uses `WorkoutCardView`; web should reuse the existing `WorkoutCard` from [features/dashboard/workout-card/](../fitepic-web-app/src/app/features/dashboard/workout-card/)). The card surfaces:

| Slot | Source field | Notes |
|---|---|---|
| Primary header (above name) | `TrainingGroupName` for group rows (`"{Gym}: {Group}"`); `"Coach"` when programmed by another athlete; otherwise hidden | Mobile logic in [ScheduledWorkoutUIModel.cs:42](../../FitEpic.Mobile/FitEpic.Mobile/Models/ScheduledWorkoutUIModel.cs#L42) `ToCardModel`. |
| Workout name | `Name` | |
| Workout-type chip | `WorkoutType` | Use existing display map. |
| Exercise count / summary | `ExerciseCount`, `Exercises` | Same compact summary as the dashboard. |
| Status badge | `Pending` (orange `#FF9500`) / `Completed` (green `#34C759`) | Hidden for any status other than these two (e.g., dismissed rows never reach the page). |
| Score line | `"Score: {ScoreResult} {ScoreTypeDisplay}"` | Only when completed **and** a score result exists. |
| Duration display | `Duration` | When the athlete has logged a duration. |
| Coach icon | When `ProgrammedByAthleteId` is set | Indicates a coach-programmed row. |

## 6. Card interactions

| Action | Behavior |
|---|---|
| **Tap card** | Opens the existing workout drawer (`WorkoutDrawerService`) bound to the scheduled-workout id. The drawer already handles log/complete/reschedule/unschedule — the schedule page only needs to open it. |
| **Reschedule / Unschedule** | Available only when `Status == Pending` AND `IsLocked == false` (group-targeted rows are always locked → no reschedule/unschedule from the athlete's view). Handled inside the drawer; the schedule page surfaces no inline action buttons. |

## 7. Floating action button

A primary-color FAB in the bottom-right corner with a "+" icon. Tapping expands two labeled action buttons stacked above it:

1. **Schedule Workout** — opens the same Schedule flow as the dashboard's "Schedule Workout" action. When the user is in Calendar view with a selected date, pre-fills the target date with that selection (mobile: `CurrentDate` parameter in [ScheduleViewModel.cs:73](../../FitEpic.Mobile/FitEpic.Mobile/ViewModels/ScheduleViewModel.cs#L73)).
2. **Create Workout** — opens the Create Workout flow. Same date pre-fill rule as above.

Tapping the FAB again or anywhere on the dimmed backdrop collapses the menu.

> Web framing: this can ship as the same expanding FAB the mobile uses, or be re-skinned as two header action buttons. The behavior contract (date pre-fill, both targets) is what matters; the visual treatment is a design call.

## 8. Loading and refresh

- **First load:** show a skeleton matching the calendar's structure — toggle pill, month header row, day-of-week labels, 6×7 grid of circle skeletons. Mobile reference in [SchedulePage.xaml:17-110](../../FitEpic.Mobile/FitEpic.Mobile/Views/SchedulePage.xaml#L17-L110). (Memory: prefer `.skeleton` from `styles.scss` for shape-matching loaders over spinners.)
- **Subsequent navigations** to the page do not show the skeleton if the data has not changed since the last load (matches mobile version-bump optimization in [ScheduleViewModel.cs:101-173](../../FitEpic.Mobile/FitEpic.Mobile/ViewModels/ScheduleViewModel.cs#L101-L173)).
- **Refresh after mutation:** completing, rescheduling, unscheduling, or scheduling a workout from anywhere in the app should cause the schedule page to refresh its data on next view (parallel to mobile's `IScheduleChangeNotifier`).
- The API does **not** send completion/score state in real time — refresh is poll-on-focus + invalidate-on-mutation.

## 9. Time, timezone, and dates

- All date math (today, today + 1, today − 1, week boundaries, month boundaries) is in the **athlete's profile timezone**, not the browser local time. The existing dashboard endpoints already enforce this — the schedule endpoint(s) the API team adds must follow the same rule.
- `ScheduledDate` is a calendar date (`YYYY-MM-DD`), not a timestamp. Treat as wall-clock in the athlete's timezone.

## 10. Accessibility

- The mode toggle is a single accessible "tablist" with two tabs; arrow keys move focus, Enter / Space activates.
- Calendar grid is keyboard-navigable: arrow keys move between days, Home / End jump to start / end of the week, PgUp / PgDn jump months, Enter selects.
- Each day cell announces `"{full date}, Today / Selected / Has pending workouts / Has completed workouts / Adjacent month"` (matches the mobile `SemanticDescription` in [CalendarDayUIModel.cs:50](../../FitEpic.Mobile/FitEpic.Mobile/Models/CalendarDayUIModel.cs#L50)).
- Workout cards are keyboard-activatable and announce status + workout name.
- Light and dark themes both supported.

## 11. Error states

| Condition | Behavior |
|---|---|
| Network failure on initial load | Show inline error banner above the toggle; keep the page chrome rendered. Provide a "Retry" action. |
| Athlete has no profile timezone | Hard block on dashboard already handles this — schedule page surfaces the same `PROFILE_TIMEZONE_REQUIRED` redirect/banner. |
| Workout drawer fails to load a scheduled row | Drawer owns its own error state; schedule page is unaffected. |

## 12. Open questions for design

- Should the calendar's selected-date list reuse the dashboard card density or compact further?
- Mobile uses a horizontal swipe gesture for month navigation. Web equivalent: drag, hover-arrows, or arrow-key only?
- Where the FAB lives in the web shell (bottom-right floating vs. header button) is a UX call left to the designer.

## 13. Acceptance checklist

- [ ] `/schedule` route renders with both views selectable from the pill toggle.
- [ ] Calendar view shows the current month with today highlighted, leading/trailing days dimmed, and correct pending/completed dot indicators per day.
- [ ] Selecting a day pins that date's workouts (pending → completed) below the grid; empty days show the empty-state copy.
- [ ] `‹` / `›` and keyboard navigation move months without losing the persisted selected date.
- [ ] List view buckets workouts into Today / Tomorrow / Yesterday / Future / Past per §4.3 with the correct sort order.
- [ ] Tapping any workout card opens the existing workout drawer pre-bound to the scheduled-workout id.
- [ ] FAB exposes Schedule and Create entry points; both pre-fill the selected date when the calendar has one.
- [ ] First-load skeleton matches the calendar shape; repeat navigations skip the skeleton when data is fresh.
- [ ] Light + dark themes both render correctly; the page is screen-reader and keyboard navigable.
- [ ] Group-targeted rows render with the "{Gym}: {Group}" header and are not reschedulable/unschedulable by the athlete.
