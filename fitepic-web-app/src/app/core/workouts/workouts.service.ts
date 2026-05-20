import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiConfiguration } from '../api/generated/api-configuration';
import { apiMobileWorkoutsParsePost } from '../api/generated/fn/mobile-workouts/api-mobile-workouts-parse-post';
import { apiMobileWorkoutsSyncPost } from '../api/generated/fn/mobile-workouts/api-mobile-workouts-sync-post';
import { apiMobileWorkoutsGet } from '../api/generated/fn/mobile-workouts/api-mobile-workouts-get';
import { apiMobileScheduledworkoutsGet } from '../api/generated/fn/mobile-scheduled-workouts/api-mobile-scheduledworkouts-get';
import { apiMobileScheduledworkoutsSyncPost } from '../api/generated/fn/mobile-scheduled-workouts/api-mobile-scheduledworkouts-sync-post';
import { apiGymsGymIdGroupsGroupIdScheduledWorkoutsGet } from '../api/generated/fn/training-groups/api-gyms-gym-id-groups-group-id-scheduled-workouts-get';
import { ParseWorkoutResponse } from '../api/generated/models/parse-workout-response';
import { ScheduledWorkoutRequest } from '../api/generated/models/scheduled-workout-request';
import { ScheduledWorkoutResponse } from '../api/generated/models/scheduled-workout-response';
import { SyncItemResult } from '../api/generated/models/sync-item-result';
import { WorkoutRequest } from '../api/generated/models/workout-request';
import { WorkoutResponse } from '../api/generated/models/workout-response';

/**
 * Thin wrapper over the workouts and scheduled-workouts endpoints. Like
 * `GymsService`, this hides the generated client behind a promise-based API and
 * lets feature components stay free of RxJS plumbing.
 */
@Injectable({ providedIn: 'root' })
export class WorkoutsService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);

  /**
   * Cache for {@link listPersonalWorkouts}. Repeated opens of the dashboard
   * schedule slideout don't need to re-page through the workout endpoint — the
   * library doesn't change between dialog opens unless the caller saves a new
   * workout, and {@link syncWorkout} invalidates the cache when that happens.
   */
  private cachedPersonalWorkouts: WorkoutResponse[] | null = null;
  private personalWorkoutsInFlight: Promise<WorkoutResponse[]> | null = null;

  // ─── Workout templates ─────────────────────────────────────────────────

  /** Sends raw text to the parser and returns the structured result. */
  async parse(rawText: string): Promise<ParseWorkoutResponse> {
    const res = await firstValueFrom(
      apiMobileWorkoutsParsePost(this.http, this.config.rootUrl, {
        body: { rawText },
      }),
    );
    return res.body;
  }

  /**
   * Submits a single-element batch to the workouts sync endpoint. Returns the
   * per-row `SyncItemResult` so callers can branch on `BlockedByHistory`
   * (gym-workout delete blocked by completed history) or `Forbidden`
   * (insufficient role for the targeted gym).
   */
  async syncWorkout(payload: WorkoutRequest): Promise<SyncItemResult | null> {
    const res = await firstValueFrom(
      apiMobileWorkoutsSyncPost(this.http, this.config.rootUrl, { body: [payload] }),
    );
    // Any sync touches the user's library (new row, archive flip, delete).
    // Invalidate the cached personal-library projection so the next slideout
    // open re-fetches.
    this.cachedPersonalWorkouts = null;
    return res.body?.results?.[0] ?? null;
  }

  /**
   * Returns the caller's personal workout library — workouts they authored
   * that aren't scoped to any gym. Used by the dashboard's schedule slideout
   * to show "pick an existing workout to schedule" options. Filters out
   * archived and soft-deleted rows, sorts by most recently updated.
   *
   * Cached after first fetch; {@link syncWorkout} invalidates the cache so
   * newly-saved workouts appear on the next call. Concurrent callers
   * (e.g. slideout reopens while still loading) share a single in-flight
   * request.
   */
  async listPersonalWorkouts(options?: {
    forceRefresh?: boolean;
  }): Promise<WorkoutResponse[]> {
    if (!options?.forceRefresh && this.cachedPersonalWorkouts) {
      return this.cachedPersonalWorkouts;
    }
    if (this.personalWorkoutsInFlight) return this.personalWorkoutsInFlight;
    this.personalWorkoutsInFlight = this.fetchPersonalWorkouts()
      .then((rows) => {
        this.cachedPersonalWorkouts = rows;
        return rows;
      })
      .finally(() => {
        this.personalWorkoutsInFlight = null;
      });
    return this.personalWorkoutsInFlight;
  }

  private async fetchPersonalWorkouts(): Promise<WorkoutResponse[]> {
    const out: WorkoutResponse[] = [];
    let page = 1;
    const pageSize = 100;
    while (page <= 50) {
      const res = await firstValueFrom(
        apiMobileWorkoutsGet(this.http, this.config.rootUrl, { page, pageSize }),
      );
      const items = res.body?.items ?? [];
      for (const w of items) {
        if (w.gymId) continue; // skip gym-scoped
        if (w.isDeleted) continue;
        if (w.isArchived) continue;
        if (w.isOwner === false) continue; // skip rows from a coach's library
        out.push(w);
      }
      const totalPages = res.body?.totalPages ?? 0;
      if (page >= totalPages || items.length === 0) break;
      page += 1;
    }
    out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return out;
  }

  /**
   * Looks up a single workout by id. Implemented by pulling the first page and
   * filtering — the API doesn't expose a dedicated `GET /workouts/{id}` for the
   * mobile surface. For typical libraries the page size of 100 is sufficient;
   * if it ever isn't we'll page until we find the row.
   */
  async getWorkout(id: string): Promise<WorkoutResponse | null> {
    let page = 1;
    const pageSize = 100;
    // Safety cap — don't loop forever if the API misbehaves.
    while (page <= 50) {
      const res = await firstValueFrom(
        apiMobileWorkoutsGet(this.http, this.config.rootUrl, { page, pageSize }),
      );
      const items = res.body?.items ?? [];
      const match = items.find((w) => w.id === id);
      if (match) return match;
      const totalPages = res.body?.totalPages ?? 0;
      if (page >= totalPages || items.length === 0) return null;
      page += 1;
    }
    return null;
  }

  // ─── Scheduled workouts ────────────────────────────────────────────────

  /**
   * Lists scheduled workouts in the caller's **personal feed**, bounded to
   * `[from, to]`. Personal feed under v6 = caller's own rows + groups they
   * hold an explicit `TrainingGroupMembership` for (with the mid-flight rule).
   * For the gym Schedule tab's oversight view, use
   * {@link listGroupScheduledWorkouts} instead — staff don't get other groups
   * in their personal feed unless they joined explicitly. Dates are
   * `YYYY-MM-DD`.
   */
  async listScheduledWorkouts(
    from: string,
    to: string,
  ): Promise<ScheduledWorkoutResponse[]> {
    const res = await firstValueFrom(
      apiMobileScheduledworkoutsGet(this.http, this.config.rootUrl, { from, to }),
    );
    return res.body ?? [];
  }

  /**
   * Fetches the caller's `ScheduledWorkoutResponse` for a single row by its
   * id, restricted to a known date. Useful for action handlers that have the
   * dashboard's projected `DashboardWorkoutCardResponse` (which carries the
   * scheduled-workout id and date but not the underlying `workoutId` /
   * `athleteId` / `trainingGroupId` needed to construct a sync request).
   */
  async findScheduledWorkout(
    id: string,
    scheduledDate: string,
  ): Promise<ScheduledWorkoutResponse | null> {
    const rows = await this.listScheduledWorkouts(scheduledDate, scheduledDate);
    return rows.find((r) => r.id === id) ?? null;
  }

  /**
   * Per-group oversight view of scheduled workouts (v6, 2026-05-19). Returns
   * every non-deleted row targeted at the group regardless of whether the
   * caller is a participant — the mid-flight rule does NOT apply. Authorization
   * is Coach/Admin/Owner of the gym. Use this on the gym Schedule tab so staff
   * can see what's scheduled without having to join the group.
   */
  async listGroupScheduledWorkouts(
    gymId: string,
    groupId: string,
    from: string,
    to: string,
  ): Promise<ScheduledWorkoutResponse[]> {
    const res = await firstValueFrom(
      apiGymsGymIdGroupsGroupIdScheduledWorkoutsGet(this.http, this.config.rootUrl, {
        gymId,
        groupId,
        from,
        to,
        pageSize: 500,
      }),
    );
    return res.body?.items ?? [];
  }

  /**
   * Submits a single-row batch to the scheduled-workouts sync endpoint. Group
   * rows always come back with `isLocked = true`. Per-row resolutions to watch:
   * `Forbidden` (caller lacks Coach/Admin/Owner on the target gym) and
   * `ScoreRequiresCompleted` (non-null `scoreResult` requires `status =
   * Completed`).
   */
  async syncScheduledWorkout(
    payload: ScheduledWorkoutRequest,
  ): Promise<SyncItemResult | null> {
    const res = await firstValueFrom(
      apiMobileScheduledworkoutsSyncPost(this.http, this.config.rootUrl, {
        body: [payload],
      }),
    );
    return res.body?.results?.[0] ?? null;
  }
}
