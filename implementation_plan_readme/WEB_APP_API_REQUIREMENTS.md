# FitEpic Web App — API Requirements

This document captures the architectural framework and standing conventions the FitEpic Web App places on the FitEpic API. It is intended as a working contract between the Web App team and the API team.

**Active scope is tracked in per-phase documents in this folder** (e.g. [01_DASHBOARD_WEEKLY_STATS.md](./01_DASHBOARD_WEEKLY_STATS.md)). Each phase document defines a self-contained slice of work — endpoints, shapes, behaviors, and open questions. The architectural rules in this document apply to every phase.

---

## 1. Background

The FitEpic API was originally built for the Mobile client, which maintains a local SQLite cache, pulls resources via cursor-based delta endpoints (`?since=`), and replays mutations through batch sync endpoints (`/workouts/sync`, `/scheduledworkouts/sync`).

The Web App is a stateless SPA. It has no local database, performs no delta sync, and does not implement an offline outbox. Every view is rendered from a live API call and needs server-computed aggregates, filtered list endpoints, single-resource GETs, and standard create/update/delete mutations.

Rather than try to evolve a single API surface to serve both clients, this document establishes a clean separation: the API exposes a Web-specific surface and a Mobile-specific surface, with the only shared endpoints being authentication.

---

## 2. Architectural Approach

### 2.1 Principle: no endpoint sharing between Web and Mobile (except auth)

Web App and Mobile App endpoints are kept fully separate at the controller and route level. The only exception is the authentication surface (`/User/...`), which is shared.

This separation is deliberate. Maintaining a register of "which endpoints are shared and which are not" becomes a long-term maintenance burden — every change has to ask "does this still apply to both clients?" and the answer drifts over time. Drawing a hard line eliminates that overhead.

If two endpoints would have an identical shape forever, the response is to share the **mapping/projection logic** at the service or mapper layer, not to share the endpoint itself. Service-layer reuse is encouraged and expected; controller-layer reuse is not.

### 2.2 Route prefixes

| Audience | Prefix | Notes |
|---|---|---|
| Web App | `/api/webapp/...` | All Web App endpoints. Conventions in §2.3. |
| Mobile App | `/api/mobile/...` | All Mobile endpoints. The existing un-prefixed and `/api/social/...` routes are preserved during the Mobile transition; see §2.5. |
| Shared (auth only) | `/User/...` (unchanged) | Existing auth controller. |

Each client surface evolves independently. The Mobile surface's own routing conventions are owned by the API and Mobile teams and are out of scope for this document.

### 2.3 Routing conventions (Web App surface)

All `/api/webapp/...` endpoints follow these conventions.

**Path structure**
- Resource roots are always **plural**: `/athletes`, `/dashboards`, `/connections`, `/workouts`.
- The leaf segment indicates singular-vs-collection through its own form: `/athletes/profile/v1` returns a single profile, `/athletes/profiles/v1` returns a list of profiles.
- When a leaf is grammatically plural but the response is a single aggregate object (e.g. `weekly-stats`, `preferences`), use the form that reads naturally in English. The endpoint's documented response shape is the source of truth for cardinality.
- Multi-word segments use **lowercase kebab-case**: `/weekly-stats`, `/connection-invites`, `/standard-exercises`.
- Path parameters use `{id}` for primary identifiers; GUIDs as strings.

**Versioning**
- Every endpoint carries its own version segment as the **last path segment**: `/api/webapp/athletes/profile/v1`. This allows resources to evolve independently of one another.
- A new version (`v2`, `v3`, ...) is introduced **only** when an existing field's shape or semantics change in a non-additive way. Adding new optional fields, new sub-objects, or new enum values for forward-compatible enums stays on the existing version.
- When a new version is introduced, the older version remains until the Web App migrates off it; deprecation timelines are coordinated case by case.

**Action endpoints**
- For actions that don't fit pure REST, use a verb leaf before the version segment: `PATCH /api/webapp/connection-invites/{id}/accept/v1`. Verbs are short, lowercase, and singular.

### 2.4 Service-layer reuse

All business logic remains in the existing service layer (`FitEpic.Services`) and is consumed by both Web and Mobile controllers. New Web controllers must not bypass services or duplicate domain logic.

### 2.5 Mobile refactor (required as part of this work)

To enforce the separation cleanly and avoid leaving the Mobile contract spread across un-prefixed routes, the API team will:

1. **Rename existing controllers** to make their Mobile scope explicit (e.g., `WorkoutsController` → `MobileWorkoutsController`). The auth controller is excluded.
2. **Re-mount existing routes under `/api/mobile/...`** alongside their current paths. The existing un-prefixed and `/api/social/...` routes must continue to work so the live Mobile app does not break.
3. **Plan deprecation of the old routes** once the Mobile app has migrated to the new `/api/mobile/...` paths. The Web App makes no requirements about that timeline.

Establishing this convention now — early in the project — is much cheaper than retrofitting it after both clients have grown.

---

## 3. General API Conventions (Web App surface)

These conventions apply to all endpoints under `/api/webapp/...`. The Mobile surface is out of scope for this document and may follow different conventions.

### 3.1 Authentication
- All endpoints except the shared auth endpoints require a JWT bearer token.
- Tokens are issued by the existing `/User/SignIn` endpoint and validated by existing middleware.
- Endpoints must scope all data to the authenticated athlete; the Web App must never need to send an `athleteId` for self-scoped reads.

### 3.2 Response shape
- JSON only.
- `camelCase` property names.
- Timestamps in ISO 8601 UTC (`2026-04-28T14:00:00Z`).
- IDs are GUIDs as strings.
- Soft-deleted records are excluded from all responses. The Web App has no concept of tombstones.

### 3.3 Errors
- Standard HTTP status codes (`400` validation, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict, `500` server).
- Error body: `{ "error": { "code": "string", "message": "human readable", "details"?: object } }`.
- Validation errors return `400` with a `details` object keyed by field name.

### 3.4 Pagination
- Page-based pagination using `page` (1-indexed) and `pageSize` query params.
- Default `pageSize` of 20, max 100.
- Paginated responses: `{ "items": [...], "page": 1, "pageSize": 20, "totalCount": 123, "hasMore": true }`.

### 3.5 Filtering
- List endpoints support filtering via query params (`?status=pending`, `?search=...`) rather than requiring clients to fetch and filter locally.
- Date ranges use `from` and `to` ISO date params (inclusive on both ends unless documented otherwise).

### 3.6 CORS
- Allow requests from the Web App's origins: development (`http://localhost:4200`) and production (TBD by deployment).
- Allow `Authorization` and `Content-Type` headers and standard methods (`GET`, `POST`, `PATCH`, `PUT`, `DELETE`, `OPTIONS`).

### 3.7 Caching
- Read endpoints used on dashboard / list views should set appropriate `Cache-Control` headers (e.g., `private, max-age=30`) where staleness is acceptable.
- Mutating endpoints must respond with `Cache-Control: no-store`.

### 3.8 OpenAPI / Swagger
- Every Web App endpoint must be documented in the Swagger spec with full request/response schemas and a meaningful `summary`. The Web App generates its TypeScript client from `swagger.json` via `ng-openapi-gen`.
- Web and Mobile endpoints should be tagged distinctly in Swagger so the generated clients can be filtered if needed.

### 3.9 Backwards compatibility
- All changes for the Web App are additive under `/api/webapp/...`.
- The Mobile-facing changes (rename + re-mount under `/api/mobile/...`) must preserve the existing routes until Mobile migrates.

---

## 4. Active Scope

Active scope lives in per-phase documents in this folder. Each phase is self-contained and committed; future phases are not committed until their document is drafted and accepted.

| Phase | Document | Focus | Status |
|---|---|---|---|
| 1 | [01_DASHBOARD_WEEKLY_STATS.md](./01_DASHBOARD_WEEKLY_STATS.md) | Dashboard weekly stats + streak; introduces the Athlete Profile concept | Shipped |
| 2 | [02_DASHBOARD_WORKOUTS.md](./02_DASHBOARD_WORKOUTS.md) | Dashboard workouts: yesterday, today, tomorrow, future (7-day window) | Ready for API team |

When a new phase is started, add a row here and create the corresponding `NN_<topic>.md` document.

---

## 5. Out of Scope

- Achievements / personal records / milestones — deferred per existing API notes.
- Push notifications / real-time updates — the Web App will poll where needed in the initial release.
- Trainer-only programming flows — to be specified in a follow-up phase document.
- Offline support — Web App is online-only by design.
- Any Mobile-specific endpoint behavior beyond the rename and re-mount described in §2.5.

---

## 6. Change log

| Date | Author | Change |
|---|---|---|
| 2026-04-28 | Web App team | Initial draft |
| 2026-04-28 | Web App team | Added Web/Mobile separation strategy, versioned route prefixes, Mobile refactor requirements |
| 2026-04-28 | Web App team | Restructured: phase-based scope tracking; specific endpoints moved to phase documents |
| 2026-04-28 | Web App team | Routing conventions: `/api/webapp/...` prefix, plural resource roots, leaf-position version segment, kebab-case |
| 2026-04-28 | Web App team | Locked for API team handoff |
