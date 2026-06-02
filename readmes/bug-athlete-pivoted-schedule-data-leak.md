# Bug: Athlete-pivoted schedule endpoint leaks another athlete's log data

**Date filed:** 2026-06-02
**Filed by:** FitEpic.WebApp team (Drew)
**Severity:** High — cross-athlete data exposure on a coach surface; coaches see data attributed to the wrong athlete and may inadvertently overwrite their own logs.
**Endpoint:** `GET /api/gyms/{gymId}/athletes/{athleteId}/scheduled-workouts`
**Affected code path:** `ScheduledWorkoutService.GetForGymAthleteOversightAsync`

---

## Summary

When the coach surface fetches an athlete's gym schedule, group-targeted rows for which the target athlete has **no** `ScheduledGroupWorkoutAthleteResult` come back with `Status / ScoreResult / Notes / Duration / ExerciseLogs` populated from whatever data lives on the base `ScheduledWorkout` row — not actual template defaults. In practice, that data is the **logged result of whichever athlete most recently wrote to the base row via the personal sync path** (typically the coach themselves, since coaches are also athlete-tier members of their own groups).

Result: when a coach opens the log page on behalf of an athlete who hasn't completed the workout, the inputs are prefilled with **the coach's own logged values**, attributed to the target athlete.

---

## Reproduction

1. As a Coach who is also an athlete-tier member of a training group, schedule a group workout for that group (e.g. `4 × 8 BB Deadlift`).
2. From your own dashboard, complete the workout for yourself — log reps + weight per set, save. (Personal log path: web app posts via `POST /scheduledworkouts/sync` with the group-targeted row's id.)
3. Confirm via the gym schedule drawer's per-athlete results panel that your completion is correctly attributed to you (it is).
4. Pick another athlete in the same group who has **not** logged this workout (call them Stella).
5. From the gym schedule drawer, click **+ Log athlete result** → pick Stella. The web app opens `/workouts/log/{groupRowId}?onBehalfOfGymId=…&onBehalfOfGroupId=…&onBehalfOfAthleteId={stellaId}`, which calls `GET /api/gyms/{gymId}/athletes/{stellaId}/scheduled-workouts?from=…&to=…`.

**Observed:** Stella's log page opens with the coach's reps + weight values prefilled into every set, but the page title correctly reads "Log Stella's result" and the row's `status` field comes back as `Pending`.

**Expected:** Stella's log page opens empty (or carrying only the workout template's prescribed values), since Stella has no per-athlete result row.

---

## Root cause

`ScheduledWorkoutService.GetForGymAthleteOversightAsync` at [FitEpic.Services/ScheduledWorkoutService.cs:884-905](../FitEpic.Services/ScheduledWorkoutService.cs#L884-L905):

```csharp
if (items.Count > 0)
{
    List<string> swIds = items.Select(i => i.Id).ToList();
    List<ScheduledGroupWorkoutAthleteResult> results = await scheduledGroupWorkoutAthleteResultRepository
        .GetByAthleteAndScheduledWorkoutIdsAsync(targetAthleteId, swIds);
    Dictionary<string, ScheduledGroupWorkoutAthleteResult> resultBySwId =
        results.ToDictionary(r => r.ScheduledWorkoutId);

    foreach (ScheduledWorkout sw in items)
    {
        if (resultBySwId.TryGetValue(sw.Id, out ScheduledGroupWorkoutAthleteResult? r))
        {
            sw.Status = r.Status;
            sw.ScoreResult = r.ScoreResult;
            sw.Notes = r.Notes;
            sw.Duration = r.Duration;
            sw.ExerciseLogs = r.ExerciseLogs;
        }
        // When no result row exists yet the template defaults persist (Status = Pending,
        // ScoreResult = null, etc.) — the row is intentionally not "completed by X."
    }
}
```

The merge only **overwrites** log fields when a per-athlete result exists. The fall-through comment ("template defaults persist") assumes the base `ScheduledWorkout` row carries empty log fields when no athlete has completed it. **That assumption no longer holds.**

The base row's `Status / ScoreResult / Notes / Duration / ExerciseLogs` reflect whatever was last written to the row via `POST /scheduledworkouts/sync`. The repository's `Include(sw => sw.ExerciseLogs)` at [ScheduledWorkoutRepository.cs:654-656](../FItEpic.Api.Repositories/Repositories/ScheduledWorkoutRepository.cs#L654-L656) eagerly loads those logs into every returned row. The athlete-pivoted query therefore returns whoever-last-synced's logs as the "template default" for any athlete who hasn't engaged with the row.

In our case, the coach completed their own group workout via the personal sync endpoint, which mutated the base row's log collection. That data now surfaces in every other group member's pivoted view.

---

## Suggested fix (server)

When no `ScheduledGroupWorkoutAthleteResult` is found for `(swId, targetAthleteId)`, explicitly reset the row's log fields to actual defaults rather than letting whatever's on the base row pass through:

```csharp
foreach (ScheduledWorkout sw in items)
{
    if (resultBySwId.TryGetValue(sw.Id, out ScheduledGroupWorkoutAthleteResult? r))
    {
        sw.Status = r.Status;
        sw.ScoreResult = r.ScoreResult;
        sw.Notes = r.Notes;
        sw.Duration = r.Duration;
        sw.ExerciseLogs = r.ExerciseLogs;
    }
    else
    {
        // Defaults for an athlete who has not engaged with the row.
        sw.Status = ScheduledWorkoutStatus.Pending;
        sw.ScoreResult = null;
        sw.Notes = null;
        sw.Duration = null;
        sw.ExerciseLogs = [];
    }
}
```

This makes the documented contract ("template defaults persist") actually true on the wire. Cheap, isolated, no schema change.

Also worth a look at the matching code path on the per-group oversight endpoint (`GET /api/gyms/{gymId}/groups/{groupId}/scheduled-workouts`) — if that surface uses the same merge shape it likely has the same leak.

---

## Related concern — possible upstream cause

The reason the base `ScheduledWorkout` row's log fields are non-empty in the first place is that **the personal sync path (`POST /scheduledworkouts/sync`) accepts log fields on a group-targeted row and writes them directly to the row.** For group-targeted rows, per-athlete logs should arguably live exclusively in `ScheduledGroupWorkoutAthleteResult` — there's no athlete-disambiguated "owner" of the base row's log collection.

Two paths the API team could take:

1. **Server-side route:** reject (or rewrite) sync calls that include log fields on a group-targeted row. Force athletes (including the coach-as-athlete) through the per-athlete result endpoint. Cleanest, but a behavior change for any existing client that takes the personal sync shortcut.
2. **Client-side route:** the web app's `workout-log-page.ts onSave` already branches on `coachContext` for the on-behalf path; we could extend the personal branch to also call `logResultOnBehalf` (with `targetAthleteId = self`) whenever the row is group-targeted. This would prevent further pollution of base rows from the web client. Mobile likely needs the same change.

Either path makes the suggested merge fix above unnecessary in the long run, but the merge fix is still worth landing for defense in depth and to clean up any existing polluted rows.

---

## Defensive client workaround already applied

To unblock coach logging on behalf of athletes, the web app now gates its load on `sw.status === 'Completed'` (see [workout-log-page.ts:280-292](../fitepic-web-app/src/app/features/workouts/workout-log-page.ts#L280-L292)). When the merged status comes back as `Pending`, the page ignores `notes / scoreResult / duration / exerciseLogs` from the response and loads fresh inputs.

This unblocks the coach surface but does not address the underlying data leak — any consumer reading the same endpoint that does not apply the same status-gate will still see one athlete's logs attributed to another.

---

## Test coverage suggestion

Add a service-level integration test that:

1. Creates a group with two athlete members A and B.
2. A logs a result on a group-targeted scheduled workout via the personal sync path (mirrors the production scenario).
3. Calls `GetForGymAthleteOversightAsync(gymId, targetAthleteId: B, …)`.
4. Asserts the returned row for B has `Status = Pending`, `ExerciseLogs = []`, `ScoreResult = null`, `Notes = null`, `Duration = null`.

Currently this scenario passes silently with cross-athlete data leak.
