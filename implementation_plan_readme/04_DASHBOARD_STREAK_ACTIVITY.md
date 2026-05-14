# Phase 4: Dashboard Streak / Activity Dot-Line / Days-Worked-Out

**Status:** API endpoint shipped and verified against the contract (swagger inspected, `Cache-Control: no-cache` confirmed). Web app implementation can begin — see the phased checklist in §10.

This phase replicates three mobile dashboard widgets on the web:
1. **Day Streak pill** — "🔥 N day workout streak"
2. **Activity Dot-Line** — snake-layout grid of dots showing recent daily activity
3. **Days-Worked-Out pill** — "X of the last Y days worked out"

The companion API plan is at [`../../FitEpic.Api/readmes/dashboard-streak-activity-api-plan.md`](../../FitEpic.Api/readmes/dashboard-streak-activity-api-plan.md). The mobile requirements doc — which defines the visual rules this web implementation must match — is at [`../../FitEpic.Mobile/FitEpic.Mobile/readme/dashboard_streak_requirements.md`](../../FitEpic.Mobile/FitEpic.Mobile/readme/dashboard_streak_requirements.md).

For overarching architectural rules (route prefixes, conventions, separation principle) see [WEB_APP_API_REQUIREMENTS.md](./WEB_APP_API_REQUIREMENTS.md).

---

## 1. Scope

In-scope:
- Render the three widgets near the top of the dashboard, above the existing weekly-stats grid (matches mobile vertical stack order: streak pill → dot-line → days-worked-out pill).
- Call the new `GET /api/webapp/dashboards/streak-activity/v1` endpoint and bind its response to view models that mirror mobile's `StreakInfo` shape exactly.
- Reuse the existing `handleTimezoneRequired` recovery pattern (already in [dashboard-page.ts](../fitepic-web-app/src/app/features/dashboard/dashboard-page.ts) at the bottom of `loadStats`/`loadWorkouts`).
- Pixel-equivalent (within web-rendering quirks) styling: same hex colors and same layout constants as mobile (`StreakDotsPerRow = 15`, `StreakMaxDotsDisplayed = 44`).

Out-of-scope (explicitly):
- Replacing the existing `streak-badge` block fed by `weekly-stats/v1.streak.currentStreakDays`. Decision in §10.5 of the API plan is "leave both, document the difference." We will **remove** the old badge once this phase ships — see §6 below — but the weekly-stats response shape itself is unchanged.
- Adding a setting for `StreakAndDayCountStartDate`. **Already shipped** — `settings-page.ts:70` sends it on profile save and `:104` loads it. No settings work required.
- Backfilling, migrations, or any mobile work (mobile already computes client-side).
- Editing the API contract beyond consuming it — that doc is owned by the API team.

---

## 2. Endpoint we consume

`GET /api/webapp/dashboards/streak-activity/v1` — full contract in §3 of the API plan. Summary of the response shape we bind to:

```jsonc
{
  "today": "2026-05-12",
  "windowStart": "2026-04-12",
  "currentStreak": 5,
  "isActiveStreak": true,
  "daysActive": 7,
  "daysInWindow": 30,
  "recentDays": [
    { "date": "2026-05-12", "state": "Completed" },
    { "date": "2026-05-11", "state": "ScheduledOnly" },
    { "date": "2026-05-10", "state": "None" }
  ]
}
```

`recentDays` is **newest-first**, up to 90 entries, with leading `None`-only days already trimmed by the server. `daysInWindow` and `daysActive` are scoped to `[windowStart, today]`, which may be wider than `recentDays`.

Error codes we handle: `PROFILE_TIMEZONE_REQUIRED` (recover via existing `ProfileService.ensureTimezone()` flow), `INVALID_TIMEZONE` (route to settings), `PROFILE_NOT_FOUND` (generic error), `UNAUTHENTICATED` (auth interceptor handles).

---

## 3. Files to add / change

### 3.1 Regenerated API client (no manual edits)

After the API team merges, regenerate `fitepic-web-app/src/app/core/api/generated/`:
- New fn: `fn/web-app-dashboards/api-webapp-dashboards-streak-activity-v-1-get.ts`
- New models: `models/streak-activity-response.ts`, `models/day-activity-record-response.ts`, `models/day-activity-state.ts` (string-enum).

### 3.2 New component: `<app-streak-activity>`

Lives at `fitepic-web-app/src/app/features/dashboard/streak-activity/` with `.ts`, `.html`, `.scss`.

**Public inputs:** none — the component fetches its own data on init, same lifecycle pattern as the weekly-stats block already in `dashboard-page.ts`.

**Signals:**
- `data: WritableSignal<StreakActivityResponse | null>`
- `loading: WritableSignal<boolean>`
- `error: WritableSignal<string | null>`

**Computed view models:**
- `showStreakPill = computed(() => d().isActiveStreak && d().currentStreak >= 2)` — visibility rule §2.2 of the mobile doc.
- `showDaysPill   = computed(() => d().daysActive > 0)` — §3.3 of the mobile doc.
- `showDotLine    = computed(() => d().recentDays.length > 0)` — §4.7 of the mobile doc.
- `streakRows`   — see §4 below for the snake-layout algorithm.
- `overflowDays`  — `max(0, recentDays.length - 44)`.

**Public API exposed to parent:** a `reload()` method on the component, called via a `#streakActivity` template ref so `dashboard-page.ts` can include it in its `Promise.allSettled([...])` initial load and the `retry` flows.

### 3.3 Edits to existing files

**`dashboard-page.html`** — insert `<app-streak-activity #streakActivity />` between `<app-quote-card />` and the `@if (statsLoading()) { … }` block. Remove the `streak-badge` markup (lines 49–64 of the current file) — that block becomes redundant once the new pill is up. The weekly-stats `s.streak?.completedInLast7Days` fallback message disappears with it; it is duplicated by the new days-worked-out pill.

**`dashboard-page.ts`** — add `StreakActivity` to the component's `imports`. No new signals or loaders here; the child owns its own state.

**`dashboard-page.scss`** — delete the `.streak-badge` / `.streak-badge.streak-active` / `.week-header` rules (lines 108–149) along with the `skeleton-streak` (lines 23–27). The new component carries its own styles.

### 3.4 Loading skeleton

The new component renders its own skeleton: a 36 px-tall pill placeholder, a 3-row grid of 15 dot-circles each, and a second pill placeholder. Matches the visual mass of the rendered block so layout doesn't jump.

---

## 4. Snake-layout algorithm

Direct port of the mobile algorithm (`DashboardViewModel.BuildStreakRows`) to TypeScript. Constants:

```ts
const DOTS_PER_ROW = 15;     // matches mobile StreakDotsPerRow
const MAX_DOTS    = 44;      // matches mobile StreakMaxDotsDisplayed
```

**Important deviation from mobile:** the web layout puts today at the **left** edge of row 0 (not the right edge as mobile does). The snake then winds rightward, drops, reads right-to-left, drops, and so on. Confirmed by the web app owner during Phase F verification — leftmost-newest reads more naturally on a wide desktop layout.

Algorithm:

1. Take `recentDays` (already newest-first). Cap to `MAX_DOTS` — keep the first 44.
2. Chunk into rows of 15. Row 0 has 15 (or fewer if there are <15 dots total); row 1 has 15; row 2 has up to 14 (since 15+15+14 = 44).
3. Even-indexed rows (0, 2 …) render left-to-right (keep order): today sits at the left edge of row 0.
4. Odd-indexed rows (1, 3 …) render right-to-left: reverse the chunk.
5. Each row carries a `verticalConnectorSide: 'right' | 'left' | 'none'`:
   - Even row not last → `'right'`
   - Odd row not last → `'left'`
   - Final row → `'none'`.
6. Within each row, every dot except the first has a leading horizontal connector.

Reading the snake from row 0 left to right and continuing along the connectors yields strict newest-to-oldest calendar order.

### 4.1 Dot styling (matches mobile `WorkoutStreakDayUIModel`)

| State | Fill | Stroke |
|---|---|---|
| `Completed` | `#0B4CFF` | `#0B4CFF` |
| `ScheduledOnly` | `#FF9500` | `#FF9500` |
| `None` | transparent | `#5B8EFF` |

Dot: 12 × 12 px, circle, 1.5 px stroke. Horizontal connector: 8 × 2 px, color `#0B4CFF`. Vertical connector: 2 × 6 px, color `#0B4CFF`. Connectors are **always** blue regardless of dot state — they visualize the timeline, not the workout status.

Pill colors:
- Streak pill: bg `#E8F5E9` light / `#1B3A1F` dark; text `#2E7D32` light / `#81C784` dark.
- Days-worked-out pill: bg `#E3F2FD` light / `#0D2545` dark; text `#0B4CFF` light / `#5C7CFF` dark.

The codebase already uses a CSS-variable theming system in [styles/_tokens.scss](../fitepic-web-app/src/styles/_tokens.scss) — `--fe-primary` is already `#0B4CFF` and light/dark theme switching is handled there. We add new tokens for the colors not already in the palette and reference them from the component SCSS. New tokens to add to `_tokens.scss` (both `:root` and dark blocks):

```scss
// :root (light)
--fe-streak-pill-bg: #E8F5E9;
--fe-streak-pill-text: #2E7D32;
--fe-days-pill-bg: #E3F2FD;
--fe-days-pill-text: #0B4CFF;
--fe-dot-scheduled: #FF9500;
--fe-dot-none-stroke: #5B8EFF;

// :root.fe-dark / dark media-query block
--fe-streak-pill-bg: #1B3A1F;
--fe-streak-pill-text: #81C784;
--fe-days-pill-bg: #0D2545;
--fe-days-pill-text: #5C7CFF;
--fe-dot-scheduled: #FF9500;       // unchanged
--fe-dot-none-stroke: #5B8EFF;     // unchanged
```

The `Completed` dot fill/stroke uses the existing `--fe-primary` (light) / `--fe-primary-dark` (dark) so it tracks the rest of the brand-blue tokens automatically.

### 4.2 Overflow label

When `recentDays.length > 44`, render a small label below the snake: `+ {overflow} more {day|days}`, pluralized on `overflow`. Style: 12 px, gray, small top margin. Hidden when no overflow.

---

## 5. Copy and pluralization

- Streak pill: `🔥 {N} day workout streak` — literal emoji, no pluralization (mobile keeps "day" regardless because the pill only renders for N ≥ 2).
- Days-worked-out pill: `{X} of the last {Y} {day|days} worked out`. Pluralization is on **Y** (the window length), not X. Edge case: `Y = 1` → "1 of the last 1 day worked out" is acceptable per mobile §7.

---

## 6. Removing the old streak badge

The `streak-badge` block in [dashboard-page.html](../fitepic-web-app/src/app/features/dashboard/dashboard-page.html#L49-L64) is fed by `weekly-stats/v1.streak.currentStreakDays`, which uses a fixed 30-day lookback and ignores `StreakAndDayCountStartDate`. Per §10.5 of the API plan it stays in the response payload — but the web app stops rendering it. Removing the markup:
- Drops the `mat-icon` `local_fire_department` and `event_available` usages that this block introduced (still safe — icons are referenced elsewhere).
- Drops the `weekly-stats/v1.streak.completedInLast7Days` reading (also safe — that value is approximated by the new days-worked-out pill).

The `streak` field on the `WeeklyStatsResponse` continues to exist; we simply do not bind it.

---

## 7. Empty-state behavior

When `recentDays.length === 0`, `daysActive === 0`, and `currentStreak === 0`:
- All three widgets are hidden.
- The component renders nothing — the section collapses entirely, matching mobile §5.1.
- The dashboard's existing weekly-stats grid renders normally below.

When the load fails with a non-timezone error, show a single line inline error in place of the section: "Could not load streak activity." with a retry button. Same visual weight as the existing `error-card` block but scoped to this section only.

---

## 8. Testing

- **Unit tests** for the snake-layout helper covering: 1-day input, 14-day, 15-day (full first row), 16-day (forces row 2), 44-day (cap exactly hit), 45-day (forces overflow label = 1), 90-day (overflow = 46).
- **Unit tests** for the visibility computeds matching the requirements doc §7 edge-case table (yesterday-only, day-before-yesterday-only, all-dismissed day, future-date `StreakAndDayCountStartDate`, etc.).
- **Manual smoke tests** against a dev API:
  - No history → component renders nothing, no console error.
  - One completed today → 1 dot, no streak pill, days-worked-out pill reads "1 of the last 30 days worked out".
  - 5-day streak with `StreakAndDayCountStartDate = today − 30` → streak pill shows "5", days-worked-out reads "5 of the last 31 days worked out", dot-line shows 31 dots over 3 rows.
  - Force a `PROFILE_TIMEZONE_REQUIRED` (clear profile timezone in DB, hit `/`) → recovery sets timezone from browser, component reloads. Confirms reuse of the existing pattern.
- **Visual cross-check** with the mobile app on the same athlete account — dot count, dot order, colors, pill copy should all match.

---

## 9. Decisions (resolved)

### 9.1 Endpoint timing — wait for API
**Decision:** wait. The API team will begin the endpoint once both teams agree on requirements. No stubs in the web app — the work starts after the regenerated client lands.

### 9.2 Timezone source — profile timezone
**Decision:** profile timezone, matching `weekly-stats/v1`. The `PROFILE_TIMEZONE_REQUIRED` recovery flow already in `dashboard-page.ts` will be reused by the new component.

### 9.3 Server-compute vs raw data — server-compute
**Decision:** server-compute. Endpoint returns `currentStreak`, `daysActive`, and classified `recentDays`. Web app only renders. If mobile's rules ever change, the API moves with them.

### 9.4 Cache strategy — `no-cache`
**Decision:** `no-cache`. The API team should set `Cache-Control: no-cache` on the response. The dashboard updates the moment a workout is marked complete, and `max-age=30` would produce a confusing stale window. No ETag investment in this phase.

### 9.5 Dark-mode color tokens — extend `_tokens.scss`
**Decision:** add the new tokens listed in §4.1 to [styles/_tokens.scss](../fitepic-web-app/src/styles/_tokens.scss). The existing system already supports light/dark via `:root.fe-dark` and the `prefers-color-scheme` media query, so the component SCSS only references `var(--fe-…)` tokens — no inline hex values, no per-component dark-mode rules.

### 9.6 Page placement — between quote card and weekly stats
**Decision:** as planned. `<app-streak-activity />` sits between `<app-quote-card />` and the `@if (statsLoading()) { … }` block.

### 9.7 Old streak badge — remove in this phase
**Decision:** delete the `streak-badge` markup and its SCSS in this same change set. The new pill replaces it. The `streak` field on the `WeeklyStatsResponse` payload remains untouched server-side; the web app simply stops binding it.

---

## 10. Implementation phases

Work through these in order. Each step is small enough to check off in a single sitting; later phases assume the earlier ones are green.

### Phase A — API client + design tokens

- [x] Regenerate the OpenAPI client (`fitepic-web-app/src/app/core/api/generated/`) from `http://localhost:5244/swagger/v1/swagger.json`. _Ran `npm run gen:api` — 74 models, 15 services._
- [x] Confirm the generated tree contains [`fn/web-app-dashboards/api-webapp-dashboards-streak-activity-v-1-get.ts`](../fitepic-web-app/src/app/core/api/generated/fn/web-app-dashboards/api-webapp-dashboards-streak-activity-v-1-get.ts), [`models/streak-activity-response.ts`](../fitepic-web-app/src/app/core/api/generated/models/streak-activity-response.ts), [`models/day-activity-record-response.ts`](../fitepic-web-app/src/app/core/api/generated/models/day-activity-record-response.ts), and [`models/day-activity-state.ts`](../fitepic-web-app/src/app/core/api/generated/models/day-activity-state.ts).
- [x] Open `models/day-activity-state.ts` and verify the enum has exactly `None | ScheduledOnly | Completed`. _Confirmed: `export type DayActivityState = 'None' | 'ScheduledOnly' | 'Completed';`._
- [x] Note whether `recentDays` is typed as optional (`?:`) on the generated `StreakActivityResponse` — if so, plan to coalesce to `[]` at the binding site. _Typed `recentDays?: Array<DayActivityRecordResponse> | null` — every field on the response is optional. Phase B/C/D bindings must coalesce all reads (`?? 0`, `?? []`, `?? false`)._
- [x] Add the six light-mode CSS variables from §4.1 to the `:root` block in [styles/_tokens.scss](../fitepic-web-app/src/styles/_tokens.scss).
- [x] Add the dark-mode overrides (streak pill bg/text, days pill bg/text) to **both** the `:root.fe-dark, [data-fe-theme='dark']` block and the `@media (prefers-color-scheme: dark)` block. _`--fe-dot-scheduled` and `--fe-dot-none-stroke` left in `:root` only — they are theme-agnostic per §4.1._
- [x] `ng build` (or equivalent) succeeds with no new warnings. _Build clean in 6.5 s._

### Phase B — Component skeleton + data fetch

- [x] Create folder `fitepic-web-app/src/app/features/dashboard/streak-activity/` with empty `streak-activity.ts`, `.html`, `.scss`.
- [x] In `streak-activity.ts`, declare `@Component({ selector: 'app-streak-activity', standalone: true, imports: [...], templateUrl, styleUrl })`. _Standalone is implicit in Angular 21 — omitted the explicit flag, matching `QuoteCard`._
- [x] Add the three signals: `data: WritableSignal<StreakActivityResponse | null>`, `loading`, `error`.
- [x] Implement `ngOnInit()` → `load()`; `reload()` re-runs `load()`.
- [x] `load()` calls `apiWebappDashboardsStreakActivityV1Get(http, config.rootUrl)`, sets `data` on success.
- [x] Wire `handleTimezoneRequired` (copy-paste pattern from [dashboard-page.ts:127-139](../fitepic-web-app/src/app/features/dashboard/dashboard-page.ts#L127-L139); consider factoring it into a shared helper as a follow-up, but not in this phase). _Follow-up: dedupe with `DashboardPage.handleTimezoneRequired` once a third caller appears._
- [x] Render the loading skeleton (pill placeholder + 3 rows × 15 dot placeholders + pill placeholder) so the layout doesn't jump when data arrives.
- [x] Render an inline error card with a Retry button when `error()` is non-null.
- [x] Component type-checks (`tsc --noEmit` clean) and `ng build` is warning-free.

### Phase C — Pills

- [x] Add `showStreakPill = computed(() => !!data()?.isActiveStreak && (data()?.currentStreak ?? 0) >= 2)`.
- [x] Add `showDaysPill = computed(() => (data()?.daysActive ?? 0) > 0)`.
- [x] Render `🔥 {currentStreak} day workout streak` inside `@if (showStreakPill())`.
- [x] Render `{daysActive} of the last {daysInWindow} {day|days} worked out` inside `@if (showDaysPill())` — pluralize on `daysInWindow`, **not** `daysActive`. _`daysWord` computed returns `'day'` when `daysInWindow === 1`, else `'days'`._
- [x] Style the streak pill with `--fe-streak-pill-bg` / `--fe-streak-pill-text`.
- [x] Style the days pill with `--fe-days-pill-bg` / `--fe-days-pill-text`.
- [x] Both pills use `align-self: flex-start` (or equivalent) so they hug the left edge and don't stretch.
- [ ] Visually verify in light and dark mode against mobile screenshots. _Deferred until Phase E wires the component into the dashboard so we can load it in the browser._

### Phase D — Snake-layout dot-line

- [x] Create `streak-activity/snake-layout.ts` exporting `buildStreakRows(days: DayActivityRecord[]): StreakRow[]` and the constants `DOTS_PER_ROW = 15`, `MAX_DOTS = 44`. _Also exports `overflowCount(n)` helper used by the component._
- [x] Define the `StreakRow` type: `{ dots: DayActivityRecord[]; verticalConnectorSide: 'right' | 'left' | 'none' }`.
- [x] Implement: cap to 44, chunk by 15, reverse even-indexed rows, set `verticalConnectorSide` per §4 step 5.
- [x] Add `snake-layout.spec.ts` covering 0, 1, 14, 15, 16, 44, 45, 90 inputs (assert row counts, dot orders, and connector sides). _10 specs, all green via vitest._
- [x] In the component, expose `streakRows = computed(() => buildStreakRows(data()?.recentDays ?? []))` and `overflowDays = computed(() => Math.max(0, (data()?.recentDays?.length ?? 0) - MAX_DOTS))`.
- [x] Add `showDotLine = computed(() => streakRows().length > 0)`.
- [x] Template: outer `@if (showDotLine())`, inner `@for (row of streakRows(); track $index)` row container, inner `@for (dot of row.dots; track $index)` dot + leading horizontal connector (skip on first).
- [x] Each row appends its vertical connector based on `row.verticalConnectorSide`.
- [x] SCSS: dots are `12 × 12 px` circles with a `1.5 px` stroke; `Completed` uses `--fe-primary`; `ScheduledOnly` uses `--fe-dot-scheduled`; `None` is `background: transparent` with `border-color: var(--fe-dot-none-stroke)`.
- [x] Connectors are always `--fe-primary` (timeline color, not state color). Horizontal: `8 × 2 px`. Vertical: `2 × 6 px`. _Vertical connector is `position: absolute; top: 100%` with `right: 5px` or `left: 5px` so it dangles under the trailing/leading dot of its row; row is `position: relative`._
- [x] Render the overflow label `+ {overflowDays()} more {day|days}` only when `overflowDays() > 0`.

### Phase E — Dashboard integration + cleanup

- [x] Import `StreakActivity` in [dashboard-page.ts](../fitepic-web-app/src/app/features/dashboard/dashboard-page.ts) and add it to the component's `imports` array.
- [x] Insert `<app-streak-activity #streakActivity />` in [dashboard-page.html](../fitepic-web-app/src/app/features/dashboard/dashboard-page.html) between `<app-quote-card />` and the `@if (statsLoading()) { … }` block.
- [x] Delete the `streak-badge` markup ([dashboard-page.html:49-64](../fitepic-web-app/src/app/features/dashboard/dashboard-page.html#L49-L64)).
- [x] Delete the `.streak-badge`, `.streak-badge.streak-active`, and `.week-header` rules from [dashboard-page.scss](../fitepic-web-app/src/app/features/dashboard/dashboard-page.scss#L108-L149). _Also removed the orphaned `.week-range` rule (the matching markup was already gone)._
- [x] Delete the `.skeleton-streak` rule ([dashboard-page.scss:23-27](../fitepic-web-app/src/app/features/dashboard/dashboard-page.scss#L23-L27)).
- [x] Delete the corresponding `<span class="skeleton skeleton-streak">` placeholder in the stats-loading branch of `dashboard-page.html`. _Whole `<section class="week-header">` skeleton wrapper removed since it had no other children._
- [x] Confirm no other code reads `weekly-stats/v1.streak.completedInLast7Days` — if it does, leave that read alone; we are only removing the badge UI. _Only the generated model file (`weekly-stats-streak-response.ts`) references the field — no app code does._
- [x] `ng build` is warning-clean; no unused imports left behind. _Also dropped now-unused `MatIconModule` import from `dashboard-page.ts` (the only `<mat-icon>` usages were in the removed streak-badge block)._

### Phase F — Verification

- [ ] Run the dev server and load the dashboard against a real athlete with no history → component renders nothing, no console error, weekly-stats grid still renders below.
- [ ] Complete one workout today → 1 dot in the dot-line, no streak pill (count is 1), days-worked-out pill reads "1 of the last 30 days worked out".
- [ ] Set `StreakAndDayCountStartDate = today − 30` in settings, complete 5 consecutive days → streak pill reads "5 day workout streak"; days-worked-out reads "5 of the last 31 days worked out"; dot-line shows 31 dots laid out across 3 rows in snake order.
- [ ] Force `PROFILE_TIMEZONE_REQUIRED` (clear profile timezone in the DB, hit `/`) → recovery sets timezone from browser, component reloads. Same flow as `weekly-stats`.
- [ ] Toggle dark mode (`:root.fe-dark`) → pill background/text colors swap correctly; dot orange and none-stroke unchanged; brand-blue dots track `--fe-primary-dark`.
- [ ] Side-by-side with the mobile app on the same account: dot count, order, colors, and pill copy match.
- [ ] No new console errors, no new build warnings, no layout shift when the section transitions from skeleton → loaded.
