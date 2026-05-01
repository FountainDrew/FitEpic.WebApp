# Phase 3: Dashboard Quote of the Day

**Status:** Ready for API team review.

This phase brings the Mobile dashboard's "Quote of the Day" feature to the Web App. It rides on top of the cross-team API rework that lifts the quote catalog and per-athlete state out of the Mobile bundle and onto the server, and adds a new capability — user-added quotes — that previously did not exist on either client.

The full contract (data model, endpoint shapes, validation rules, error codes, edge-case behavior) lives in [`quote-of-the-day-implementation-plan.md`](../../FitEpic.Api/readmes/quote-of-the-day-implementation-plan.md). That document is the source of truth; this phase document specifies only what is unique to the Web App slice. If the two ever disagree, the cross-team plan wins.

For overarching architectural rules (route prefixes, conventions, separation principle), see [WEB_APP_API_REQUIREMENTS.md](./WEB_APP_API_REQUIREMENTS.md).

---

## 1. Web App UI Scope

The Web App renders the quote feature in two places.

### 1.1 Dashboard quote card

A small inspirational-quote card placed at the top of the dashboard, above the [Phase 1 Weekly Stats](./01_DASHBOARD_WEEKLY_STATS.md) panel.

- **Quote text** — italicized, primary line. **No truncation** — the card grows vertically to fit. The 1000-char API ceiling is rare in practice and the card is decorative; truncation introduces a "show more" interaction that doesn't pay for itself.
- **Author** — smaller, secondary line, prefixed with em-dash (`— Marcus Aurelius`). **Suppressed entirely when the API returns `author: null`** (which covers both "no author provided" and the legacy "Unknown" case the API normalizes to `null`). No `— Unknown` placeholder.
- **Affordances (right side of card):**
  - **Pin / Unpin** icon — Material `push_pin` (outline when unpinned, filled when pinned).
  - **Refresh** icon — Material `refresh`.
  - Both render directly on the card, not in an overflow menu — there are only two actions and the card is small.

**Pin / refresh interaction (matches Mobile, enforced server-side):**
- **Unpinned**: both icons visible. Refresh fetches a different quote; pin (outline) pins the current one.
- **Pinned**: only the filled pin icon is visible. Tapping unpins. The refresh icon is hidden — the cross-team plan's `409 PINNED` from `POST .../today/refresh/v1` is a defensive guard the UI should never trigger under normal use.

**Empty state:** if `GET /api/webapp/quotes/today/v1` returns `204 No Content` (the athlete's pool is empty — only possible if every system quote was soft-deleted *and* the athlete has added none), the card is suppressed entirely. No placeholder.

**Loading / error state:** while the dashboard fetch is in flight, render a skeleton at the card's eventual height so the rest of the dashboard does not jump. On any non-`204` error (network, `5xx`), suppress the card silently — a broken decorative widget should not block the user from seeing their stats and workouts. Standard error toast / log per the existing Web App error policy.

### 1.2 "Manage my quotes" settings page

A new section under the existing settings area, listing the user's own added quotes with create / edit / delete affordances. **System quotes are not listed and there is no UI to browse the system catalog.** Cycling through the pool is the only way users encounter system quotes.

- **List**: each row shows the quote text (truncated to ~2 lines with ellipsis) and the author (truncated to a single line). Edit and delete icons on each row.
- **Add quote**: opens a modal with two fields — `text` (required, multi-line `<textarea>`, max 1000 chars) and `author` (optional, single-line, max 200 chars). Submit calls `POST /api/webapp/quotes/mine/v1`.
- **Edit quote**: same modal, prefilled. Submit calls `PUT /api/webapp/quotes/mine/{id}/v1`.
- **Delete quote**: confirmation dialog. On confirm, calls `DELETE /api/webapp/quotes/mine/{id}/v1`. **If the deleted quote was currently displayed on the dashboard or pinned, the API auto-clears those references** — the Web App does not need to do anything special beyond cache invalidation per §3.5.
- **Pagination**: standard `page` / `pageSize` per [§3.4](./WEB_APP_API_REQUIREMENTS.md). Default page size 20; in practice most users will have far fewer than 20 quotes so the pager rarely engages.
- **Modal validation**: client-side validation must mirror the cross-team rules in §5.4 of the API plan — `text` required, 1–1000 chars after trim; `author` 0–200 chars after trim, empty treated as `null`. Submit button disabled until valid. Server-side `400 VALIDATION` errors are still surfaced inline as a defensive backstop.

**Settings hierarchy**: lives under the existing **Settings → My Quotes** node (sibling to Profile). Final routing decision deferred to the settings shell work, but the slug `/settings/my-quotes` is reserved.

---

## 2. Endpoints consumed

The contract — request / response shapes, validation rules, error codes, edge-case behavior — is defined in [§5 (service layer + DTOs + validation + error contract)](../../FitEpic.Api/readmes/quote-of-the-day-implementation-plan.md) and [§7 (Web App API surface)](../../FitEpic.Api/readmes/quote-of-the-day-implementation-plan.md) of the cross-team plan. This phase consumes the eight endpoints listed there:

| Used by | Method | Route |
|---|---|---|
| Dashboard card render | `GET` | `/api/webapp/quotes/today/v1` |
| Dashboard refresh button | `POST` | `/api/webapp/quotes/today/refresh/v1` |
| Dashboard pin button | `POST` | `/api/webapp/quotes/{id}/pin/v1` |
| Dashboard unpin button | `DELETE` | `/api/webapp/quotes/pin/v1` |
| Manage page list | `GET` | `/api/webapp/quotes/mine/v1` |
| Manage page create | `POST` | `/api/webapp/quotes/mine/v1` |
| Manage page edit | `PUT` | `/api/webapp/quotes/mine/{id}/v1` |
| Manage page delete | `DELETE` | `/api/webapp/quotes/mine/{id}/v1` |

The TypeScript client is auto-generated from `swagger.json` via `ng-openapi-gen` once the API team publishes the spec — the Web App does not hand-write request/response types.

**Web-specific notes layered on top of the cross-team contract:**

- `today/v1` **does not** emit `400 PROFILE_TIMEZONE_REQUIRED` like the [Phase 1](./01_DASHBOARD_WEEKLY_STATS.md) / [Phase 2](./02_DASHBOARD_WORKOUTS.md) endpoints. Per cross-team plan §5.2, the quote endpoint silently falls back to UTC when the profile has no timezone — acceptable for a decorative widget where being off by a few hours on the date rollover is harmless. In practice the Phase 1 bootstrap (auto-set from browser on first dashboard visit) means timezone will essentially always be set by the time the quote card renders, so the fallback is defensive only. Note also that per cross-team plan §4.4 the API team migrated `Timezone` onto a new `AthleteProfile_table`, but **the wire format on `GET/PUT /api/webapp/athletes/profile/v1` is unchanged** — the Web App makes no client-side changes for that migration.
- The cross-team plan's `mine` list response uses the `PagedResult<T>` shape (`{ items, page, pageSize, totalCount }`) on the mobile surface and adds `hasMore` on the web surface per [§3.4](./WEB_APP_API_REQUIREMENTS.md). The Web App reads `hasMore` directly; no client-side computation.

---

## 3. Web App Behavior

1. The dashboard issues `GET /api/webapp/quotes/today/v1` in parallel with `GET /api/webapp/dashboards/weekly-stats/v1` and `GET /api/webapp/dashboards/workouts/v1`, after the existing profile/timezone bootstrap from Phase 1 has succeeded.
2. The quote card renders independently of the other dashboard widgets — failures or `204`s suppress the card without affecting weekly stats or workouts.
3. Pin, unpin, and refresh actions are **optimistic**: the client updates the UI immediately and reconciles on response. On error, revert and show a toast. Each action is a single short HTTP call so optimism is mostly cosmetic — it just avoids a flash of the spinner.
4. The "Manage my quotes" page is not part of the dashboard fetch; it loads on navigation.
5. **Cache invalidation:** after any successful create / update / delete on the manage page, invalidate the cached `quotes/today/v1` response so the next dashboard render fetches fresh. Blanket invalidate-on-every-mutation is the simplest correct approach — narrowing it to only "the deleted quote was the displayed one" requires the client to track displayed-quote ID across navigations and isn't worth the bookkeeping for a decorative widget.
6. **No realtime / push.** A pin set on Mobile becomes visible on the next dashboard render in Web (and vice versa). Acceptable latency for a decorative feature.

---

## 4. Out of Scope (this phase)

- **Sharing user quotes** — user quotes are strictly private. No `IsPublic` flag, no sharing UI, no moderation. If sharing is ever introduced, it gets its own phase document with content-detection requirements attached.
- **Browsing the system catalog** — no UI to see "all quotes." Cycling is the only encounter path.
- **Reordering / favoriting / tagging** beyond the single pin slot.
- **Push / realtime updates** — pin changes propagate at the cadence of the next dashboard render.
- **Localization of system quotes** — all system quotes are English. A future phase can add a `Language` column if needed.
- **Quote history / "show me yesterday's quote"** — not requested.
- **Pin from the manage page** — pin is only available from the dashboard card. Pinning from the manage list would force a "you must be on the dashboard to see what you pinned" round-trip that adds no value.

---

## 5. Open Questions

None blocking. All prior open questions have been resolved in §1 (icon choice, truncation policy, "unknown" author rendering, cache invalidation strategy, settings navigation slug).

---

## 6. Change log

| Date | Author | Change |
|---|---|---|
| 2026-04-30 | API team | Initial draft, derived from the cross-team plan at `FitEpic.Api/readmes/quote-of-the-day-implementation-plan.md`. |
| 2026-04-30 | Web App team | Rewrote per Web App ownership: resolved all open questions inline (icons, no truncation, suppress null author, blanket cache invalidate, `/settings/my-quotes` slug), trimmed contract duplication with the cross-team plan, marked status Ready for API team review. |
| 2026-04-30 | Web App team | Verified against the live Swagger spec at `http://localhost:5244/swagger/v1/swagger.json` after the API team finished Phase A. All eight endpoints, `QuoteResponse` / `QuoteOfTheDayResponse` / `PagedQuotesResponse` (with `hasMore`) / `CreateOrUpdateQuoteRequest` shapes, and the `204` / `409 PINNED` / `404` responses match the cross-team contract. Corrected one note: `today/v1` does not return `400 PROFILE_TIMEZONE_REQUIRED` — server falls back to UTC when timezone is null. |
