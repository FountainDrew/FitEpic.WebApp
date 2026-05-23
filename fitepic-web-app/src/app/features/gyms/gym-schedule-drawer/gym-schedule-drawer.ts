import {
  Component,
  HostListener,
  Injector,
  computed,
  effect,
  inject,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { WorkoutsService } from '../../../core/workouts/workouts.service';
import { showGymError, SYNC_RESULT_MESSAGES } from '../../../core/gyms/gym-error-messages';
import { createPendingAction } from '../../../core/async/pending-action';
import { formatScoreTitleAndValue } from '../../../core/workouts/score-display';
import { formatDurationFromIso } from '../../../core/workouts/format-duration';
import { AthleteResultEntryResponse } from '../../../core/api/generated/models/athlete-result-entry-response';
import { ScheduledWorkoutResultsResponse } from '../../../core/api/generated/models/scheduled-workout-results-response';
import { WorkoutExerciseResponse } from '../../../core/api/generated/models/workout-exercise-response';
import {
  ConfirmActionDialog,
  ConfirmActionDialogData,
} from '../confirm-action-dialog';
import {
  RescheduleWorkoutDialog,
  RescheduleWorkoutDialogData,
  RescheduleWorkoutDialogResult,
} from '../reschedule-workout-dialog';
import {
  AthletePickerDialog,
  AthletePickerDialogData,
  AthletePickerDialogResult,
} from '../athlete-picker-dialog/athlete-picker-dialog';
import { GymScheduleDrawerService } from './gym-schedule-drawer.service';

/**
 * Coach-facing details + actions drawer for a gym-scheduled workout. Mirrors
 * the dashboard's `WorkoutDrawer` (athlete view) but exposes the actions a
 * coach has on a group row: edit the underlying workout template, reschedule
 * the row, unschedule it.
 *
 * Per-athlete results section (rounds 10/12/14 — coach-on-behalf surface):
 * lists every athlete who has logged this workout (current members + any
 * historical completers who have since left the group), with score / logs
 * per athlete and an Edit affordance. A "Log Athlete Result" button opens
 * an athlete picker for logging on behalf of an athlete who hasn't recorded
 * a result yet.
 */
@Component({
  selector: 'app-gym-schedule-drawer',
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './gym-schedule-drawer.html',
  styleUrl: './gym-schedule-drawer.scss',
})
export class GymScheduleDrawer {
  protected readonly service = inject(GymScheduleDrawerService);
  private readonly workoutsService = inject(WorkoutsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  private readonly action = createPendingAction<void>();
  protected readonly actionPending = this.action.pending;

  // ─── Per-athlete results state ─────────────────────────────────────────

  /**
   * Raw response from {@link WorkoutsService.getGroupResults}. Refetched
   * whenever the drawer's row changes (effect below) or a coach action
   * mutates the result rows.
   */
  protected readonly resultsResponse = signal<ScheduledWorkoutResultsResponse | null>(null);
  protected readonly loadingResults = signal(false);
  protected readonly resultsError = signal<string | null>(null);

  /** Athlete cards in expanded state (id-set). Click the card header to toggle. */
  private readonly expandedAthleteIds = signal<Set<string>>(new Set());

  protected readonly allEntries = computed<AthleteResultEntryResponse[]>(
    () => this.resultsResponse()?.athletes ?? [],
  );

  /**
   * Every athlete who has logged this workout — current group members and
   * historical completers (athletes who logged then left the group) shown
   * identically. Per product call: historical logs stay visible and count
   * the same as current-member logs; no "former member" distinction in the
   * drawer UI.
   */
  protected readonly loggedAthletes = computed<AthleteResultEntryResponse[]>(() =>
    this.allEntries().filter((a) => a.result != null),
  );

  /** Athletes still in the group who haven't logged yet — drives the "+ N not logged" line. */
  protected readonly unloggedCurrentMembers = computed<AthleteResultEntryResponse[]>(() =>
    this.allEntries().filter((a) => a.isCurrentMember && a.result == null),
  );

  protected readonly hasAnyResultsData = computed(
    () => this.allEntries().length > 0,
  );

  constructor() {
    // Fetch the per-athlete results whenever the drawer opens on a new row
    // (or the same row after an action completion). The effect lives in the
    // component injection context so it's cleaned up when the component
    // tears down.
    effect(() => {
      const row = this.service.row();
      if (!row) {
        this.resultsResponse.set(null);
        this.expandedAthleteIds.set(new Set());
        return;
      }
      void this.loadResults();
    });
  }

  // ─── Existing computeds (workout meta, exercise list) ──────────────────

  protected readonly metaLine = computed(() => {
    const row = this.service.row();
    if (!row) return '';
    const w = row.workout;
    const segments: string[] = [];
    if (w?.workoutType) segments.push(w.workoutType);
    const count = (w?.exercises ?? []).filter((e) => !e.isDeleted).length;
    if (count > 0) segments.push(count === 1 ? '1 exercise' : `${count} exercises`);
    return segments.join(' · ');
  });

  protected readonly hasRawText = computed(() =>
    Boolean(this.service.row()?.workout?.rawText?.trim()),
  );

  protected readonly visibleExercises = computed(() =>
    (this.service.row()?.workout?.exercises ?? [])
      .filter((e) => !e.isDeleted)
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
  );

  protected readonly hasExercises = computed(() => this.visibleExercises().length > 0);

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.service.isOpen()) this.service.close();
  }

  protected close(): void {
    this.service.close();
  }

  protected exerciseSummary(e: WorkoutExerciseResponse): string {
    const parts: string[] = [];
    if (e.sets != null && e.reps) parts.push(`${e.sets}×${e.reps}`);
    else if (e.reps) parts.push(e.reps);
    else if (e.sets != null) parts.push(`${e.sets} sets`);
    if (e.targetWeight != null) parts.push(`@${e.targetWeight}lb`);
    if (e.duration) parts.push(e.duration);
    return parts.join(' · ');
  }

  // ─── Per-athlete display helpers ───────────────────────────────────────

  /**
   * Formatted score line for one athlete's result (e.g. "Score: 9:33 Time to
   * Complete"). Uses the shared score formatter so the wording matches
   * mobile + the dashboard drawer. Null when the athlete's result has no
   * score (e.g., the parent workout's `scoreType` is `None`).
   */
  protected scoreLineFor(entry: AthleteResultEntryResponse): string | null {
    const scoreType = this.service.row()?.scheduled.scoreType;
    const parts = formatScoreTitleAndValue({
      status: entry.result?.status,
      scoreType,
      scoreResult: entry.result?.scoreResult,
    });
    if (!parts) return null;
    return `${parts.title}: ${parts.value}`;
  }

  protected durationLineFor(entry: AthleteResultEntryResponse): string | null {
    const d = formatDurationFromIso(entry.result?.duration);
    return d ? `Duration: ${d}` : null;
  }

  protected hasExpandableLogs(entry: AthleteResultEntryResponse): boolean {
    const logs = entry.result?.exerciseLogs ?? [];
    return logs.some((l) => !l.isDeleted);
  }

  protected isExpanded(athleteId: string | null | undefined): boolean {
    return !!athleteId && this.expandedAthleteIds().has(athleteId);
  }

  protected toggleExpand(athleteId: string | null | undefined): void {
    if (!athleteId) return;
    this.expandedAthleteIds.update((s) => {
      const next = new Set(s);
      if (next.has(athleteId)) next.delete(athleteId);
      else next.add(athleteId);
      return next;
    });
  }

  /** Sets to display per log: `Round X · Set Y` style label. */
  protected logLabel(log: {
    setNumber?: number | null;
    roundNumber?: number | null;
  }): string {
    const round = log.roundNumber;
    const set = log.setNumber;
    if (round != null && set != null) return `Round ${round} · Set ${set}`;
    if (set != null) return `Set ${set}`;
    if (round != null) return `Round ${round}`;
    return '';
  }

  protected logSummary(log: {
    actualReps?: string | null;
    actualWeightLbs?: number | null;
    actualDurationSeconds?: number | null;
    actualDistance?: number | null;
    actualDistanceUnit?: string | null;
    actualCalories?: number | null;
  }): string {
    const parts: string[] = [];
    if (log.actualReps) parts.push(log.actualReps);
    if (log.actualWeightLbs != null) parts.push(`@ ${log.actualWeightLbs} lbs`);
    if (log.actualDurationSeconds != null) {
      const m = Math.floor(log.actualDurationSeconds / 60);
      const s = log.actualDurationSeconds % 60;
      parts.push(`${m}:${String(s).padStart(2, '0')}`);
    }
    if (log.actualDistance != null) {
      parts.push(`${log.actualDistance} ${log.actualDistanceUnit ?? ''}`.trim());
    }
    if (log.actualCalories != null) parts.push(`${log.actualCalories} cal`);
    return parts.join(' · ');
  }

  // ─── Coach-on-behalf actions ───────────────────────────────────────────

  /**
   * Open the athlete picker, then navigate to the log page in coach
   * (on-behalf) mode for the chosen athlete. The page handles the actual
   * load + save against the on-behalf endpoints.
   */
  protected async logAthleteResult(): Promise<void> {
    const row = this.service.row();
    const ctx = this.contextFromRow();
    if (!row || !ctx) return;
    const picked = await this.dialog
      .open<AthletePickerDialog, AthletePickerDialogData, AthletePickerDialogResult | undefined>(
        AthletePickerDialog,
        {
          data: {
            athletes: this.allEntries(),
            workoutName: row.workoutName,
            scheduledDate: row.scheduled.scheduledDate ?? null,
          },
          width: '440px',
          autoFocus: 'first-tabbable',
        },
      )
      .afterClosed()
      .toPromise();
    if (!picked?.athleteId) return;
    const entry = this.allEntries().find((a) => a.athleteId === picked.athleteId);
    this.navigateToCoachLog(picked.athleteId, entry?.displayName ?? null);
  }

  protected editAthleteResult(entry: AthleteResultEntryResponse): void {
    if (!entry.athleteId) return;
    this.navigateToCoachLog(entry.athleteId, entry.displayName ?? null);
  }

  protected async deleteAthleteResult(entry: AthleteResultEntryResponse): Promise<void> {
    const ctx = this.contextFromRow();
    if (!ctx || !entry.athleteId) return;
    const name = entry.displayName ?? 'this athlete';
    const confirmed = await this.dialog
      .open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(ConfirmActionDialog, {
        data: {
          title: `Remove ${name}'s log?`,
          message: `Their score and logs for this workout will be cleared. They'll see this row as Pending on their dashboard until they (or you) log it again.`,
          confirmLabel: 'Remove log',
          warn: true,
        },
        width: '480px',
      })
      .afterClosed()
      .toPromise();
    if (!confirmed) return;
    await this.action.run(async () => {
      try {
        await this.workoutsService.deleteResultOnBehalf(
          ctx.gymId,
          ctx.groupId,
          ctx.scheduledWorkoutId,
          entry.athleteId!,
        );
        this.snackBar.open(`${name}'s log removed.`, 'Dismiss', { duration: 2500 });
        await this.loadResults();
        this.service.notifyActionCompleted();
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not remove the log.');
      }
    });
  }

  // ─── Existing template-row actions ─────────────────────────────────────

  protected async editWorkout(): Promise<void> {
    const row = this.service.row();
    const workoutId = row?.workout?.id ?? row?.scheduled.workoutId;
    const gymId = row?.workout?.gymId;
    if (!workoutId || !gymId) return;
    this.service.close();
    await this.router.navigate(['/workouts', workoutId, 'edit'], {
      queryParams: {
        gymId,
        returnUrl: `/gyms/${gymId}/schedule`,
      },
    });
  }

  protected async reschedule(): Promise<void> {
    const row = this.service.row();
    if (!row) return;
    const r = row.scheduled;
    if (!r.id || !r.workoutId || !r.scheduledDate) return;
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
    await this.action.run(async () => {
      try {
        const sync = await this.workoutsService.syncScheduledWorkout({
          id: r.id!,
          workoutId: r.workoutId!,
          trainingGroupId: r.trainingGroupId ?? null,
          athleteId: r.athleteId ?? null,
          scheduledDate: result.scheduledDate,
          scoreType: r.scoreType,
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
        this.snackBar.open('Workout rescheduled.', 'Dismiss', { duration: 2500 });
        this.service.close();
        this.service.notifyActionCompleted();
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not reschedule the workout.');
      }
    });
  }

  protected async unschedule(): Promise<void> {
    const row = this.service.row();
    if (!row) return;
    const r = row.scheduled;
    if (!r.id || !r.workoutId) return;
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
    await this.action.run(async () => {
      try {
        const sync = await this.workoutsService.syncScheduledWorkout({
          id: r.id!,
          workoutId: r.workoutId!,
          trainingGroupId: r.trainingGroupId ?? null,
          athleteId: r.athleteId ?? null,
          scheduledDate: r.scheduledDate ?? '',
          scoreType: r.scoreType,
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
        this.snackBar.open('Workout unscheduled.', 'Dismiss', { duration: 2500 });
        this.service.close();
        this.service.notifyActionCompleted();
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not unschedule the workout.');
      }
    });
  }

  // ─── Internal helpers ──────────────────────────────────────────────────

  /**
   * Extract the (gym, group, scheduledWorkout) tuple from the open drawer's
   * row. All three are needed for the coach-on-behalf endpoints. Returns
   * null when any piece is missing (drawer not open, personal-row open by
   * mistake, etc.) so callers can short-circuit cleanly.
   */
  private contextFromRow(): {
    gymId: string;
    groupId: string;
    scheduledWorkoutId: string;
  } | null {
    const row = this.service.row();
    if (!row) return null;
    const gymId = row.workout?.gymId;
    const groupId = row.scheduled.trainingGroupId;
    const scheduledWorkoutId = row.scheduled.id;
    if (!gymId || !groupId || !scheduledWorkoutId) return null;
    return { gymId, groupId, scheduledWorkoutId };
  }

  private async loadResults(): Promise<void> {
    const ctx = this.contextFromRow();
    if (!ctx) return;
    this.loadingResults.set(true);
    this.resultsError.set(null);
    try {
      const res = await this.workoutsService.getGroupResults(
        ctx.gymId,
        ctx.groupId,
        ctx.scheduledWorkoutId,
      );
      this.resultsResponse.set(res);
    } catch {
      this.resultsError.set('Could not load athlete results.');
      this.resultsResponse.set(null);
    } finally {
      this.loadingResults.set(false);
    }
  }

  /**
   * Navigate to the workout log page in coach-on-behalf mode. The log page
   * branches its load + save paths based on the `onBehalfOfGymId` etc.
   * query params. `returnUrl` is encoded so the schedule tab auto-reopens
   * the drawer on this workout after save.
   */
  private navigateToCoachLog(athleteId: string, athleteName: string | null): void {
    const ctx = this.contextFromRow();
    const row = this.service.row();
    if (!ctx || !row?.scheduled.id) return;
    const returnUrl = `/gyms/${ctx.gymId}/schedule?openDrawer=${encodeURIComponent(row.scheduled.id)}`;
    const queryParams: Record<string, string> = {
      onBehalfOfGymId: ctx.gymId,
      onBehalfOfGroupId: ctx.groupId,
      onBehalfOfAthleteId: athleteId,
      returnUrl,
    };
    if (athleteName) queryParams['onBehalfOfAthleteName'] = athleteName;
    this.service.close();
    runInInjectionContext(this.injector, () =>
      this.router.navigate(['/workouts/log', row.scheduled.id!], { queryParams }),
    );
  }
}
