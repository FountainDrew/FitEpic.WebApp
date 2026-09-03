# Personal Workout Library — API Requirements

> Hand-off document for the API team. The web app is adding a **Personal Workout Library** page (`/workouts/library`) that lets an athlete search their own workouts and open the full details of any one of them. This document specifies the **one** endpoint that page needs.

**Status:** requested, not yet implemented.
**Requesting surface:** FitEpic.WebApp — `/workouts/library` page + workout detail drawer.
**Blocking?** No. The page ships against the existing data path and switches over behind a single method when this lands (see §5).

---

## 1. What we're asking for, and what we're deliberately not

The new library page needs one thing: **the athlete's own personal workouts**. Nothing else.

Today the web app can only get that by calling **`GET /api/mobile/workouts`** — a mobile delta-sync endpoint — pulling every workout visible to the caller across up to 50 pages, then client-filtering down to `gymId == null && !isDeleted && !isArchived && isOwner !== false`. The web app is a separate client tier with its own `/api/webapp` surface and error envelope, and it has no offline-first requirement; it should not be reaching into the mobile sync surface to answer a question this simple.

### Scope boundary — please read before estimating

An earlier draft of this document asked you to migrate **all** web app workout reads off `/api/mobile/workouts`, including a `GET /api/webapp/workouts/{id}/v1`. **That is withdrawn.** The blast radius was too large to bundle with shipping one page: the single-workout read feeds the workout editor and the workout log page, and its visibility rules are materially harder than this endpoint's (details preserved in §6.1 for whoever picks that up).

So, concretely:

- ✅ **In scope:** one new endpoint, consumed by exactly one new page.
- ❌ **Not in scope:** changing, deprecating, or removing anything about `/api/mobile/workouts`. Existing web app callers stay on it, unchanged.
- ❌ **Not in scope:** a single-workout-by-id endpoint. The library page doesn't need one — see §2.4.
- ❌ **Not in scope:** server-side search or pagination. The web app filters client-side. If library sizes ever outgrow that, we'll come back with a separate search contract. Please don't build it now.

Migrating the existing mobile usage is real work we intend to do — it's scoped in §6 as a follow-up, not abandoned.

---

## 2. Endpoint requested

Suggested home: `FitEpic.Api/Controllers/WebApp/WebAppWorkoutsController.cs`, route prefix `api/webapp/workouts`, tag `WebApp - Workouts`, extending [`WebAppControllerBase`](../../FitEpic.Api/FitEpic.Api/WebApp/WebAppControllerBase.cs) so it picks up `[Authorize]`, `[Produces("application/json")]`, the `WebAppExceptionFilter`, and `CurrentAthleteId`.

### 2.1 `GET /api/webapp/workouts/library/v1`

**Purpose.** Return the caller's entire personal workout library in one round-trip.

**Query parameters.** None. No `since`, no `page`, no `pageSize`, no `search`.

### 2.2 Row selection

| Filter | Value | Why |
|---|---|---|
| `AthleteId` | `== CurrentAthleteId` | It's the caller's *personal* library. |
| `GymId` | `== null` | Gym-owned templates belong to the gym's library, not the athlete's, even when this athlete authored them. They're reached through the gym's workouts tab. |
| `IsDeleted` | `== false` | Web app read surface with no local cache — tombstones are meaningless here. |
| `IsArchived` | `== false` | Archived rows exist to resolve historical scheduled-workout references, not to be browsed. |
| Child `Exercises` | non-deleted only | `.Include(w => w.Exercises.Where(e => !e.IsDeleted))` |

This is exactly the filter set the web app applies client-side today, moved server-side.

**Ordering.** `UpdatedAt` **descending** — most recently touched first. Also what the web app sorts by today.

### 2.3 Response

`200 OK` with a bare JSON array of `WorkoutResponse`:

```jsonc
[
  {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "athleteId": "a87ff679-a2f3-4e61-8eb5-59fd2b8b45e5",
    "gymId": null,
    "name": "Fran",
    "instructions": null,
    "rawText": "21-15-9\nThrusters 95lb\nPull-ups",
    "workoutType": "ForTime",
    "scoreType": "TimeToComplete",
    "scoreLabel": null,
    "roundCount": null,
    "duration": null,
    "origin": "Personal",
    "isOwner": true,
    "exercises": [ /* WorkoutExerciseResponse[], non-deleted, in orderIndex order */ ],
    "createdAt": "2026-08-14T10:12:03.000Z",
    "updatedAt": "2026-08-31T18:44:51.000Z",
    "isDeleted": false,
    "isArchived": false
  }
]
```

An empty library returns `200` with `[]`, not `204`.

**Errors.** Only `UNAUTHENTICATED` (401), via the standard `WebAppErrorEnvelope`. No new [`WebAppErrorCode`](../../FitEpic.Api/FitEpic.Services/WebApp/WebAppErrorCode.cs) values needed.

### 2.4 Why no `{id}` endpoint is needed

The library page's detail drawer renders the workout the user clicked — an object already in hand from this response, since each row arrives with its exercises hydrated. Opening the drawer is a local state change, not a fetch. So the page needs exactly one request on load and none thereafter.

**The exercise list must be fully hydrated on every row** for that to hold. If exercises were omitted or truncated from the list response, the drawer would need a second endpoint and this document would be asking for two.

---

## 3. Response model — please reuse `WorkoutResponse`

We're specifically asking you **not** to mint a WebApp-specific workout DTO. The endpoint should return the existing [`FitEpic.Api.Models.Response.WorkoutResponse`](../../FitEpic.Api/FitEpic.Api/Models/Response/WorkoutResponse.cs), mapped with the existing `WorkoutResponseMapper.MapWorkoutToResponse`.

Reasons:

1. **Zero client churn.** The Angular client already generates a `WorkoutResponse` model, and the library page's card and drawer components are already built against it. Reusing the type makes §5 a one-method change instead of a refactor.
2. **The follow-up in §6 needs the full shape anyway.** The workout editor round-trips a loaded workout back through the workout sync path; when the single-workout read eventually moves to the WebApp tier, a trimmed shape would mean the editor loses fields on save. Better to have one workout wire shape than two that diverge.
3. **Precedent exists.** [`WebAppQuotesController`](../../FitEpic.Api/FitEpic.Api/Controllers/WebApp/WebAppQuotesController.cs) already returns `Models/Response` types through the shared `IQuoteService` rather than defining parallel WebApp DTOs.

The sync-oriented fields on it (`isDeleted`, `isArchived`, `createdAt`) are harmless — with this endpoint's filters they're constant. The web app reads `updatedAt` for nothing at all now that ordering is server-side, and ignores the rest.

---

## 4. Suggested layering

No new WebApp service or repository tier is needed; this reuses the existing workout stack the same way `WebAppQuotesController` reuses `IQuoteService`. It should be a genuinely small change — one query, one mapper call, no new visibility logic.

**`IWorkoutRepository` / `WorkoutRepository`** — one new method:

```csharp
/// <summary>
/// The athlete's personal workout library — rows they authored that are not scoped to any
/// gym, excluding soft-deleted and archived rows. Child exercises are filtered to
/// non-deleted entries. Ordered by UpdatedAt descending. This is a plain library read,
/// not a delta pull: no tombstones, no paging.
/// </summary>
Task<List<Workout>> GetPersonalLibraryAsync(string athleteId);
```

**`IWorkoutService` / `WorkoutService`** — one new pass-through method:

```csharp
Task<List<Workout>> GetPersonalLibraryAsync(string athleteId);
```

**No EF model change**, so **no migration**. **No DI change** — `IWorkoutService` is already registered in `Program.cs`.

**Swagger:** per the repo's copilot instructions, the action needs `/// <summary>`, `/// <remarks>` (auth + behaviour + the `error.code` list), `/// <response code>` for every status, and matching `[ProducesResponseType]` attributes including `[ProducesResponseType(typeof(WebAppErrorEnvelope), StatusCodes.Status401Unauthorized)]`.

---

## 5. Web app side (our change, for your awareness)

The library page calls a **dedicated** method, `WorkoutsService.listWorkoutLibrary()`, that exists only to serve it. Today that method delegates to the existing mobile-backed fetch so the page can ship; when this endpoint lands we repoint that one method at it and delete the delegation.

Nothing else changes. `listPersonalWorkouts()` (dashboard scheduling slideout) and `getWorkout(id)` (workout editor, workout log page) **stay on `/api/mobile/workouts`**, untouched, until the §6 follow-up.

That means during the interim two web app call paths read the same data by different routes. That's deliberate and temporary — it's the price of shipping the page without taking on the migration.

---

## 6. Follow-up work (scoped, not requested here)

Recorded so the eventual migration doesn't have to rediscover any of it.

### 6.1 `GET /api/webapp/workouts/{id}/v1` — single workout read

Needed to move `WorkoutsService.getWorkout(id)` (workout editor page, workout log page) off the mobile endpoint. Currently implemented as a **paged scan** — it pulls up to 50 pages of 100 looking for one row, because the mobile surface has no single-row read. That's a full library download to render one editor page.

**The visibility rule is the hard part, and it is wider than §2.2.** The workout log page resolves the workout *template* behind a scheduled row, and that template is frequently a **gym-owned** workout programmed by a coach. Scoping the endpoint to `AthleteId == caller && GymId == null` would break logging for every group-scheduled workout.

Required: the caller can read the workout when **either**

- **(a)** they authored it (`Workout.AthleteId == caller`), **or**
- **(b)** it's referenced by a `ScheduledWorkout` row visible to the caller —
  - personal rows (`ScheduledWorkout.AthleteId == caller`), or
  - group rows in a training group the caller currently belongs to, with the **mid-flight rule** (`ScheduledDate >= membership.AssignedAt`), or
  - group rows where the caller holds a non-deleted `Completed` result (history preservation).

Case (b) is precisely what [`WorkoutRepository.GetDeltaForAthleteAsync`](../../FitEpic.Api/FItEpic.Api.Repositories/Repositories/WorkoutRepository.cs) already implements via its private `PassesVisibility` helper, fed by `WorkoutService.ComputeExplicitGroupMembershipsAsync(athleteId)`. **Reuse it rather than reimplementing** — if the two drift, a workout reachable through the mobile delta pull becomes unreadable in the web app, or vice versa.

Soft-deleted rows should `404`, and `404 NOT_FOUND` should not distinguish "doesn't exist" from "not visible to you".

> **Note from the API team (2026-09-03): (a) OR (b) is not sufficient for gym templates.** The gym Workouts tab navigates to `/workouts/{id}/edit`, so gym-owned workouts are loaded through this read. A template the caller neither authored nor can reach via a *visible* scheduled row resolves to nothing — and since v6 (2026-05-19) removed the implicit Coach/Admin/Owner participation branch from scheduled-workout visibility, a coach who is not an **explicit** `TrainingGroupMembership` member of the target group has no path to it. A never-scheduled gym template has no path for anyone but its author.
>
> This is pre-existing rather than a regression: today's paged scan over `/api/mobile/workouts` resolves the identical predicate, so the same coach already hits the same wall. Closing it means adding a case **(c) the caller is Coach/Admin/Owner of `Workout.GymId`** (via `IGymMembershipService.IsCoachOrAboveAsync`) alongside (a) and (b). Also unspecified above and worth deciding then: whether archived workouts are returned by this endpoint — they should be, since resolving a retired gym template behind a completed log is the point of archive.

### 6.2 Retiring `listPersonalWorkouts()`

Once §2.1 ships, the dashboard scheduling slideout's `listPersonalWorkouts()` is reading the same data as `listWorkoutLibrary()` by a worse route. Collapsing the two is a web-app-only change requiring no further API work — we just point the slideout at the same method and delete the mobile-backed fetch and its 50-page loop.

### 6.3 The write/sync surface

The web app also calls four mobile endpoints for writes. These need real design, not just a re-host:

| Mobile endpoint | Web app call site | Notes on a WebApp-tier replacement |
|---|---|---|
| `POST /api/mobile/workouts/parse` | `WorkoutsService.parse()` — editor's raw-text paste | Stateless read-only transform. Cheapest to move; a `POST /api/webapp/workouts/parse/v1` returning the same `ParseWorkoutResponse` is a thin passthrough. |
| `POST /api/mobile/workouts/sync` | `WorkoutsService.syncWorkout()` — editor save; also `GymsService` for gym workout create/archive/delete | The web app posts a **single-element batch** and reads `results[0]` to branch on `BlockedByHistory` / `Forbidden`. A web client has no outbox and no LWW conflict story — it wants `POST`/`PUT`/`DELETE` with plain status codes and the `WebAppErrorEnvelope`, not a batch resolution enum. |
| `GET /api/mobile/scheduledworkouts` | `WorkoutsService.listScheduledWorkouts()` / `findScheduledWorkout()` | Mostly superseded by `/api/webapp/schedule/*`. The remaining use is resolving one scheduled row by id to recover `workoutId` / `athleteId` / `trainingGroupId` before a mutation. A `GET /api/webapp/schedule/{id}/v1` would kill it. |
| `POST /api/mobile/scheduledworkouts/sync` | `WorkoutsService.syncScheduledWorkout()` — schedule, reschedule, unschedule, delete-logs, log-workout | Same batch-vs-REST mismatch, widest blast radius: the workout drawer's reschedule / unschedule / delete-logs actions and the whole log page. |

The common theme: the mobile sync contract is **offline-first, batch, last-write-wins**, and every web app call site pays for it by fetching a whole row and reposting it to change one field. A WebApp-tier write surface would be conventional REST with targeted operations.

---

## 7. Acceptance checklist

- [ ] `GET /api/webapp/workouts/library/v1` returns the caller's personal, non-deleted, non-archived, non-gym-scoped workouts.
- [ ] Rows are ordered by `UpdatedAt` descending.
- [ ] Every row carries its **full** non-deleted exercise list (§2.4 — the drawer depends on this).
- [ ] Another athlete's workouts never appear, and neither do gym-scoped workouts the caller authored.
- [ ] An empty library returns `200 []`.
- [ ] Unauthenticated callers get `401` with a `WebAppErrorEnvelope`.
- [ ] `/api/mobile/workouts` is untouched — no behaviour, contract, or route changes.
- [ ] The endpoint carries full XML docs and `[ProducesResponseType]` attributes; `swagger.json` regenerates cleanly.
