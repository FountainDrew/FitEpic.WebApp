# Phase 1: Dashboard Weekly Stats

**Status:** Ready for API team review.

This is the first slice of FitEpic Web App scope. Implementing this validates the Web/Mobile separation, establishes the Athlete Profile concept, and delivers the highest-leverage Mobile dashboard widget on Web.

For overarching architectural rules (route prefixes, conventions, Mobile refactor, separation principle), see [WEB_APP_API_REQUIREMENTS.md](./WEB_APP_API_REQUIREMENTS.md). This document specifies only what is unique to the Weekly Stats slice.

Open questions in §5 should be confirmed with the Web App team before implementation begins.

---

## 1. Web App UI Scope

The Web App will render:

- A **Weekly Stats panel** with four cards:
  - Workouts completed (e.g. "3 of 5")
  - Total workout time (e.g. "2h 15m")
  - Weight lifted (e.g. "12,450 lbs")
  - Exercises performed (e.g. "23")
- A **streak badge** showing either the current consecutive-day streak (e.g. "7 day streak") or, if no active streak exists, a fallback like "5 of last 7 days."
- A minimal **profile screen** exposing display name and timezone, with the ability to edit timezone.

No other Mobile dashboard widgets (today/tomorrow schedule, recent completions, quote of the day, pending invite banner, social reactions on cards, FAB quick actions) are in scope for this phase.

---

## 2. Required Endpoints

All endpoints live under `/api/webapp/...` in new Web-specific controllers and follow the routing conventions in `WEB_APP_API_REQUIREMENTS.md` §2.2–§2.3.

### 2.1 `GET /api/webapp/dashboards/weekly-stats/v1`

Returns weekly stats and streak info for the authenticated athlete.

**Response shape:**
```json
{
  "weekStart": "2026-04-27",
  "weekEnd": "2026-05-03",
  "stats": {
    "workoutsCompleted": 0,
    "workoutsScheduled": 0,
    "totalDurationMinutes": 0,
    "totalWeightLiftedLbs": 0,
    "exercisesPerformed": 0
  },
  "streak": {
    "currentStreakDays": 0,
    "completedInLast7Days": 0,
    "hasHistory": true
  }
}
```

**Behavior:**

- **Week boundary**: Monday 00:00 through Sunday 23:59:59 in the authenticated athlete's local timezone (read from their Athlete Profile, see §2.2).
- **If profile timezone is not set**: return `400` with error code `PROFILE_TIMEZONE_REQUIRED`. The Web App handles this by routing the user to set their timezone, then retrying.
- **`workoutsCompleted`**: count of `ScheduledWorkouts` with `Completed` status whose completion date falls in the current week.
- **`workoutsScheduled`**: count of all `ScheduledWorkouts` (any status, including completed) whose scheduled date falls in the current week. The card displays "X of Y" where X = `workoutsCompleted` and Y = `workoutsScheduled`.
- **`totalDurationMinutes`**: sum of recorded duration on completed workouts in the current week. Workouts without a recorded duration contribute zero.
- **`totalWeightLiftedLbs`**: sum of `weight × reps` across all exercise logs on completed workouts in the current week, in pounds. (A units preference will be added in a future phase.)
- **`exercisesPerformed`**: count of exercise instances across completed workouts in the current week (multiplicative — same exercise logged twice counts as 2).
- **`streak.currentStreakDays`**: number of consecutive days, counting back from today, on which the athlete completed at least one workout. Calculation must match the Mobile implementation in `FitEpic.Mobile.Services/DashboardService.cs`.
- **`streak.completedInLast7Days`**: number of distinct days in the last 7 (including today) on which the athlete completed at least one workout. Used for the fallback display when `currentStreakDays == 0`.
- **`streak.hasHistory`**: `true` if the athlete has any completed workout in their lifetime; `false` otherwise. When `false`, the Web App suppresses the streak badge.

**Caching:** `Cache-Control: private, max-age=30`.

### 2.2 `GET /api/webapp/athletes/profile/v1`

Returns the authenticated athlete's profile.

**Response shape:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "displayName": "Drew Engelmeyer",
  "timezone": "America/Chicago"
}
```

Field types:
- `id` — GUID (string)
- `displayName` — string, required
- `timezone` — IANA timezone string, may be `null` if not yet set

**Caching:** `Cache-Control: private, max-age=60`.

### 2.3 `PUT /api/webapp/athletes/profile/v1`

Updates the authenticated athlete's profile.

**Request body:**
```json
{
  "displayName": "Drew Engelmeyer",
  "timezone": "America/Chicago"
}
```

**Behavior:**

- `timezone` must be a valid IANA tz identifier; reject with `400` (`INVALID_TIMEZONE`) if not.
- `displayName` is required, non-empty, max 100 chars.
- Returns the updated profile (`200` with body).

---

## 3. Athlete Profile (new concept)

This phase introduces the **Athlete Profile** as a first-class concept on the API. Implementation notes for the API team:

- The profile holds per-user preferences and self-display data scoped to the authenticated athlete.
- **Phase 1 fields**: `displayName`, `timezone`.
- **Anticipated future fields** (out of phase 1 scope, but inform the schema): avatar URL, bio, weight units (lb/kg), preferred week start, notification preferences.
- **Storage approach**: API team's call. Either extend the existing user/athlete entity or introduce a dedicated `AthleteProfile` entity. The Web App has no preference.
- **Auto-creation**: recommend the profile be auto-created at signup with `displayName` populated from the registration form and `timezone` left `null`. Lazy-creation on first GET also acceptable.
- The existing Mobile-facing `/athlete-profiles` collection endpoint (which returns *connected* athletes' display data) is unrelated to this concept and unaffected. If display data eventually consolidates into the same backing table, that is an internal concern — the Web App does not consume that endpoint.

---

## 4. Web App Behavior

1. On first dashboard visit, the Web App calls `GET /api/webapp/athletes/profile/v1`.
2. If `timezone` is `null`, the Web App auto-sets it to the browser's timezone via `PUT /api/webapp/athletes/profile/v1`, using `Intl.DateTimeFormat().resolvedOptions().timeZone`. The user can later edit this on the profile screen.
3. The Web App calls `GET /api/webapp/dashboards/weekly-stats/v1`.
4. If the API returns `400 PROFILE_TIMEZONE_REQUIRED`, the Web App routes the user to the profile screen to set timezone, then retries.
5. The Weekly Stats panel renders from the response. The streak badge renders only if `streak.hasHistory === true`.

---

## 5. Open Questions

1. **Streak inclusive of today?** Mobile's `DashboardService` is the source of truth — confirm whether a partial "today" with no completed workout breaks the streak immediately, or whether the streak survives until end-of-day local time.
2. **Profile creation timing**: confirm auto-create at signup vs. lazy-create on first GET.
3. **Display name source**: registration today does not appear to capture a display name distinct from email. Confirm whether `displayName` defaults to the email local-part, the full email, or something else for existing users.
4. **Empty-state semantics**: when `workoutsScheduled == 0` and `workoutsCompleted == 0`, the Web App will render zeros across all cards. Confirm there is no special "new user" response shape needed.

---

## 6. Out of Scope (this phase)

- All other Mobile dashboard widgets (today/tomorrow schedule, recent completions, quote of the day, pending invite banner, social reactions on cards, FAB quick actions).
- Workout creation/editing flows.
- Connection management.
- Activity feed and social interactions.

Each will be addressed in its own phase document when prioritized.

---

## 7. Change log

| Date | Author | Change |
|---|---|---|
| 2026-04-28 | Web App team | Initial draft |
| 2026-04-28 | Web App team | Updated paths to `/api/webapp/...` with leaf-position version segment per routing conventions |
| 2026-04-28 | Web App team | Locked for API team handoff |
