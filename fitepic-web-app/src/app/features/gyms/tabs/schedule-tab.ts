import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GymsService } from '../../../core/gyms/gyms.service';
import { GymRoleService } from '../../../core/gyms/gym-role.service';
import { ProfileService } from '../../../core/profile/profile.service';
import { WorkoutsService } from '../../../core/workouts/workouts.service';
import { canProgramWorkouts } from '../../../core/gyms/gym-role';
import { showGymError, SYNC_RESULT_MESSAGES } from '../../../core/gyms/gym-error-messages';
import { createPendingAction } from '../../../core/async/pending-action';
import { ScheduledWorkoutResponse } from '../../../core/api/generated/models/scheduled-workout-response';
import { TrainingGroupResponse } from '../../../core/api/generated/models/training-group-response';
import { WorkoutResponse } from '../../../core/api/generated/models/workout-response';
import {
  ScheduleWorkoutDialog,
  ScheduleWorkoutDialogData,
  ScheduleWorkoutDialogResult,
} from '../schedule-workout-dialog';
import {
  ConfirmActionDialog,
  ConfirmActionDialogData,
} from '../confirm-action-dialog';
import {
  RescheduleWorkoutDialog,
  RescheduleWorkoutDialogData,
  RescheduleWorkoutDialogResult,
} from '../reschedule-workout-dialog';

interface ScheduleRow {
  scheduled: ScheduledWorkoutResponse;
  workoutName: string;
  /**
   * Preview of the workout under the title. `kind: 'rawText'` preserves the
   * coach's pasted formatting; `kind: 'exercises'` is a compact comma-separated
   * list of exercise names + brief metrics. Null when neither is available.
   */
  body: { kind: 'rawText' | 'exercises'; text: string } | null;
}

interface DayGroup {
  date: string;
  rows: ScheduleRow[];
}

@Component({
  selector: 'app-schedule-tab',
  imports: [
    DatePipe,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatSelectModule,
  ],
  templateUrl: './schedule-tab.html',
  styleUrl: './schedule-tab.scss',
})
export class ScheduleTab implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly gymsService = inject(GymsService);
  private readonly roleService = inject(GymRoleService);
  private readonly profileService = inject(ProfileService);
  private readonly workoutsService = inject(WorkoutsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  private readonly scheduleAction = createPendingAction<void>();

  protected readonly gymId = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly scheduling = this.scheduleAction.pending;

  protected readonly groups = signal<TrainingGroupResponse[]>([]);
  protected readonly selectedGroupId = signal<string | null>(null);
  protected readonly scheduled = signal<ScheduledWorkoutResponse[]>([]);
  protected readonly workoutsById = signal<Map<string, WorkoutResponse>>(new Map());

  /** Inclusive start of the visible 7-day window. ISO `YYYY-MM-DD`. */
  protected readonly windowStart = signal<string>(startOfWeekIso(new Date()));
  protected readonly windowEnd = computed(() => addDaysIso(this.windowStart(), 6));

  protected readonly role = computed(() => this.roleService.forGym(this.gymId()));
  protected readonly canSchedule = computed(() => canProgramWorkouts(this.role()));

  protected readonly visibleRows = computed<ScheduleRow[]>(() => {
    const workouts = this.workoutsById();
    return this.scheduled()
      .filter((s) => !s.isDeleted)
      .map((s) => {
        const workout = workouts.get(s.workoutId ?? '') ?? null;
        return {
          scheduled: s,
          workoutName: workout?.name ?? 'Untitled workout',
          body: buildWorkoutBody(workout),
        };
      });
  });

  protected readonly dayGroups = computed<DayGroup[]>(() => {
    const buckets = new Map<string, ScheduleRow[]>();
    for (const row of this.visibleRows()) {
      const key = row.scheduled.scheduledDate ?? 'unknown';
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rows]) => ({ date, rows }));
  });

  constructor() {
    // Reload when the selected group or visible week changes.
    effect(() => {
      const gymId = this.gymId();
      const groupId = this.selectedGroupId();
      // Track week boundary as a dependency so changing the window reloads.
      this.windowStart();
      if (gymId && groupId) {
        void this.loadSchedule(gymId, groupId);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    this.gymId.set(this.route.parent?.snapshot.paramMap.get('gymId') ?? null);
    await this.loadGroupsAndWorkouts();
  }

  protected onGroupChange(groupId: string | null): void {
    this.selectedGroupId.set(groupId);
  }

  protected async onPreviousWeek(): Promise<void> {
    this.windowStart.set(addDaysIso(this.windowStart(), -7));
  }

  protected async onNextWeek(): Promise<void> {
    this.windowStart.set(addDaysIso(this.windowStart(), 7));
  }

  protected async onToday(): Promise<void> {
    this.windowStart.set(startOfWeekIso(new Date()));
  }

  protected async openSchedule(): Promise<void> {
    const id = this.gymId();
    if (!id) return;
    const result = await this.dialog
      .open<ScheduleWorkoutDialog, ScheduleWorkoutDialogData, ScheduleWorkoutDialogResult | undefined>(
        ScheduleWorkoutDialog,
        {
          data: { gymId: id, initialGroupId: this.selectedGroupId() ?? undefined },
          width: '480px',
          autoFocus: 'first-tabbable',
        },
      )
      .afterClosed()
      .toPromise();
    if (!result) return;

    if (result.mode === 'create') {
      await this.router.navigate(['/workouts/new'], {
        queryParams: {
          gymId: id,
          scheduleGroupId: result.trainingGroupIds,
          scheduleDate: result.scheduledDate,
          returnUrl: `/gyms/${id}/schedule`,
        },
      });
      return;
    }

    await this.scheduleAction.run(async () => {
      const me = this.profileService.profile()?.id;
      if (!me) {
        this.snackBar.open('Could not identify your account.', 'Dismiss', { duration: 3000 });
        return;
      }
      let succeeded = 0;
      let forbidden = 0;
      let errored = 0;
      for (const groupId of result.trainingGroupIds) {
        try {
          const sync = await this.workoutsService.syncScheduledWorkout({
            id: crypto.randomUUID(),
            workoutId: result.workoutId,
            trainingGroupId: groupId,
            athleteId: null,
            scheduledDate: result.scheduledDate,
            status: 'Pending',
            exerciseLogs: [],
            updatedAt: new Date().toISOString(),
          });
          if (sync?.resolution === 'Forbidden') forbidden += 1;
          else succeeded += 1;
        } catch {
          errored += 1;
        }
      }
      // Refresh the currently-viewed group; if the user scheduled for a
      // different group the effect won't fire, so reload defensively.
      const current = this.selectedGroupId();
      if (current && id) await this.loadSchedule(id, current);
      this.snackBar.open(
        this.buildScheduleSummary(succeeded, forbidden, errored, result.trainingGroupIds.length),
        'Dismiss',
        { duration: 4000 },
      );
    });
  }

  /**
   * Edit the workout template behind a scheduled row. Navigates to the workout
   * editor in edit mode; saving propagates the change to every athlete who has
   * the workout on their schedule, since gym-scoped workouts are shared.
   */
  protected async editWorkout(row: ScheduleRow): Promise<void> {
    const id = this.gymId();
    const workoutId = row.scheduled.workoutId;
    if (!id || !workoutId) return;
    await this.router.navigate(['/workouts', workoutId, 'edit'], {
      queryParams: {
        gymId: id,
        returnUrl: `/gyms/${id}/schedule`,
      },
    });
  }

  /**
   * Reschedule an existing group-scheduled workout to a new date. Same workout,
   * same group — only the date changes. Any per-athlete results stay attached.
   */
  protected async reschedule(row: ScheduleRow): Promise<void> {
    const id = this.gymId();
    const groupId = this.selectedGroupId();
    const r = row.scheduled;
    if (!id || !groupId || !r.id || !r.workoutId || !r.scheduledDate) return;
    const result = await this.dialog
      .open<
        RescheduleWorkoutDialog,
        RescheduleWorkoutDialogData,
        RescheduleWorkoutDialogResult | undefined
      >(RescheduleWorkoutDialog, {
        data: { workoutName: row.workoutName, currentDate: r.scheduledDate },
        width: '420px',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .toPromise();
    if (!result) return;
    await this.scheduleAction.run(async () => {
      try {
        const sync = await this.workoutsService.syncScheduledWorkout({
          id: r.id!,
          workoutId: r.workoutId!,
          trainingGroupId: r.trainingGroupId ?? groupId,
          athleteId: r.athleteId ?? null,
          scheduledDate: result.scheduledDate,
          status: r.status,
          exerciseLogs: [],
          updatedAt: new Date().toISOString(),
        });
        if (sync?.resolution === 'Forbidden') {
          this.snackBar.open(
            SYNC_RESULT_MESSAGES['Forbidden'] ?? 'You cannot reschedule this workout.',
            'Dismiss',
            { duration: 4000 },
          );
          return;
        }
        await this.loadSchedule(id, groupId);
        this.snackBar.open('Workout rescheduled.', 'Dismiss', { duration: 2500 });
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not reschedule the workout.');
      }
    });
  }

  /**
   * Unschedule a workout from this group. Soft-deletes the row via the sync
   * endpoint. The server preserves any completed history (an athlete who
   * already completed the workout keeps it in their personal history per
   * requirements §8.3); this just removes the row from the upcoming schedule.
   */
  protected async unschedule(row: ScheduleRow): Promise<void> {
    const id = this.gymId();
    const groupId = this.selectedGroupId();
    const r = row.scheduled;
    if (!id || !groupId || !r.id || !r.workoutId) return;
    const dateLabel = r.scheduledDate ?? 'this date';
    const confirmed = await this.dialog
      .open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(ConfirmActionDialog, {
        data: {
          title: 'Unschedule this workout?',
          message: `Remove "${row.workoutName}" from the schedule for ${dateLabel}? Any athletes who already completed it keep it in their personal history.`,
          confirmLabel: 'Unschedule',
          warn: true,
        },
        width: '480px',
      })
      .afterClosed()
      .toPromise();
    if (!confirmed) return;
    await this.scheduleAction.run(async () => {
      try {
        const sync = await this.workoutsService.syncScheduledWorkout({
          id: r.id!,
          workoutId: r.workoutId!,
          trainingGroupId: r.trainingGroupId ?? groupId,
          athleteId: r.athleteId ?? null,
          scheduledDate: r.scheduledDate ?? '',
          status: r.status,
          exerciseLogs: [],
          isDeleted: true,
          updatedAt: new Date().toISOString(),
        });
        if (sync?.resolution === 'Forbidden') {
          this.snackBar.open(
            SYNC_RESULT_MESSAGES['Forbidden'] ?? 'You cannot unschedule this workout.',
            'Dismiss',
            { duration: 4000 },
          );
          return;
        }
        // Optimistic refresh — the row is gone from the server.
        await this.loadSchedule(id, groupId);
        this.snackBar.open('Workout unscheduled.', 'Dismiss', { duration: 2500 });
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not unschedule the workout.');
      }
    });
  }

  private buildScheduleSummary(
    succeeded: number,
    forbidden: number,
    errored: number,
    total: number,
  ): string {
    if (succeeded === total && total === 1) return 'Workout scheduled.';
    if (succeeded === total) return `Workout scheduled for ${total} groups.`;
    if (succeeded === 0 && forbidden === total) {
      return SYNC_RESULT_MESSAGES['Forbidden'] ?? 'You cannot schedule for those groups.';
    }
    if (succeeded === 0) return 'Could not schedule the workout for any group.';
    const parts = [`Scheduled for ${succeeded} of ${total} groups.`];
    if (forbidden > 0) parts.push(`${forbidden} rejected.`);
    if (errored > 0) parts.push(`${errored} failed.`);
    return parts.join(' ');
  }

  /**
   * One-time fetch of the group list + workout library for the gym. The group
   * dropdown defaults to the first non-deleted group. The actual schedule
   * fetch is driven by the effect in the constructor whenever group or window
   * changes.
   */
  private async loadGroupsAndWorkouts(): Promise<void> {
    const id = this.gymId();
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const [groups, workouts] = await Promise.all([
        this.gymsService.listGroups(id),
        this.gymsService.listGymWorkouts(id, { includeArchived: true }),
      ]);
      const liveGroups = groups.filter((g) => !g.isDeleted);
      this.groups.set(liveGroups);
      this.workoutsById.set(
        new Map(workouts.filter((w) => w.id).map((w) => [w.id!, w])),
      );
      // Default to the first group if no selection yet.
      if (!this.selectedGroupId() && liveGroups.length > 0 && liveGroups[0].id) {
        this.selectedGroupId.set(liveGroups[0].id);
      }
    } catch {
      this.error.set('Could not load the schedule.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Fetch the scheduled workouts for a single group via the oversight endpoint.
   * Per v6, no mid-flight rule and no `TrainingGroupMembership` requirement —
   * staff see the full schedule for any group in their gym.
   */
  private async loadSchedule(gymId: string, groupId: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const rows = await this.workoutsService.listGroupScheduledWorkouts(
        gymId,
        groupId,
        this.windowStart(),
        this.windowEnd(),
      );
      this.scheduled.set(rows);
    } catch (err) {
      // 403 means the caller isn't Coach+ — shouldn't normally happen since
      // the tab is already role-gated, but surface a useful message.
      const status =
        typeof err === 'object' && err && 'status' in err
          ? (err as { status: number }).status
          : 0;
      this.error.set(
        status === 403
          ? 'You do not have permission to view this gym’s schedule.'
          : 'Could not load the schedule.',
      );
      this.scheduled.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}

function startOfWeekIso(d: Date): string {
  const day = d.getDay();
  const offset = (day + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
  return monday.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, day] = iso.split('-').map(Number);
  const next = new Date(y, (m ?? 1) - 1, (day ?? 1) + days);
  return next.toISOString().slice(0, 10);
}

/**
 * Builds the body preview shown under the workout name on a schedule row.
 * Prefer raw text (preserves the coach's original formatting); fall back to a
 * compact comma-separated exercises list when raw text is missing; return null
 * if the workout has neither.
 */
function buildWorkoutBody(
  workout: WorkoutResponse | null,
): { kind: 'rawText' | 'exercises'; text: string } | null {
  if (!workout) return null;
  const rawText = workout.rawText?.trim();
  if (rawText) return { kind: 'rawText', text: rawText };
  const exercises = (workout.exercises ?? [])
    .filter((e) => !e.isDeleted)
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  if (exercises.length === 0) return null;
  const names = exercises
    .map((e) => formatExerciseInline(e))
    .filter((s): s is string => !!s);
  if (names.length === 0) return null;
  return { kind: 'exercises', text: names.join(' · ') };
}

function formatExerciseInline(e: {
  userEnteredExerciseName?: string | null;
  reps?: string | null;
  sets?: number | null;
  targetWeight?: number | null;
  duration?: string | null;
}): string {
  const name = e.userEnteredExerciseName?.trim();
  if (!name) return '';
  const parts: string[] = [name];
  if (e.sets != null && e.reps) parts.push(`${e.sets}×${e.reps}`);
  else if (e.reps) parts.push(e.reps);
  else if (e.sets != null) parts.push(`${e.sets} sets`);
  if (e.targetWeight != null) parts.push(`@${e.targetWeight}lb`);
  if (e.duration) parts.push(e.duration);
  return parts.join(' ');
}
