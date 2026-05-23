import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';

import { WorkoutsService } from '../../core/workouts/workouts.service';
import { showGymError, SYNC_RESULT_MESSAGES } from '../../core/gyms/gym-error-messages';
import { createPendingAction } from '../../core/async/pending-action';
import { ScheduledWorkoutResponse } from '../../core/api/generated/models/scheduled-workout-response';
import { WorkoutResponse } from '../../core/api/generated/models/workout-response';
import { WorkoutExerciseResponse } from '../../core/api/generated/models/workout-exercise-response';
import { WorkoutExerciseLogRequest } from '../../core/api/generated/models/workout-exercise-log-request';
import { WorkoutScoreType } from '../../core/api/generated/models/workout-score-type';
import { DistanceUnit } from '../../core/api/generated/models/distance-unit';
import { MeasurementType } from '../../core/api/generated/models/measurement-type';

/**
 * Row state for a single per-set / per-round log entry. The visible inputs
 * depend on the exercise's measurement type (straight sets) or its
 * per-round metric (intervals) — flags below toggle which inputs render.
 *
 * `existingLogId` carries the server's id when the athlete is editing an
 * already-logged workout, so the sync payload reuses the same id rather than
 * minting a fresh row (which would orphan the previous log).
 */
interface ExerciseLogRow {
  label: string;
  setNumber: number | null;
  roundNumber: number | null;
  existingLogId: string | null;

  showRepsInput: boolean;
  showWeightInput: boolean;
  showDurationInput: boolean;
  showDistanceInput: boolean;
  showCaloriesInput: boolean;
  repInputLabel: string;

  actualReps: string;
  actualWeightLbs: string;
  actualDurationMinutes: string;
  actualDurationSeconds: string;
  actualDistance: string;
  actualDistanceUnit: DistanceUnit | null;
  actualCalories: string;
}

interface ExerciseLogGroup {
  workoutExerciseId: string;
  exerciseName: string;
  exerciseSummary: string | null;
  orderIndex: number;
  rows: ExerciseLogRow[];
}

const TIME_SCORE_TYPES = new Set<WorkoutScoreType>([
  'TimeToComplete',
  'TieBreakTime',
  'TimeCapPlusReps',
  'TimeAndLoad',
]);

const NUMERIC_LABELS: Partial<Record<WorkoutScoreType, string>> = {
  TimeCapPlusReps: 'Reps',
  TimeAndLoad: 'Load (lbs)',
  TotalReps: 'Total Reps',
  RepsPerRound: 'Reps Per Round',
  HeaviestLoad: 'Heaviest Load (lbs)',
  TotalLoad: 'Total Load (lbs)',
  RepsAndLoad: 'Reps / Load',
  PointsSystem: 'Points',
  RoundsAndReps: 'Rounds + Reps',
  Meters: 'Meters',
  Calories: 'Calories',
  Miles: 'Miles',
  Feet: 'Feet',
  CustomNumeric: 'Score',
};

const DISTANCE_UNITS: DistanceUnit[] = ['Meters', 'Kilometers', 'Miles', 'Feet'];

/**
 * Dedicated routed page for logging a completed workout. Mirrors the mobile
 * LogWorkoutPage's data model and form sections so completed history reads
 * identically across surfaces:
 *
 *  - Header: workout name + scheduled date
 *  - Score input (varies by `scoreType`): time mins+secs, numeric with
 *    type-specific label, or both for `TimeCapPlusReps` / `TimeAndLoad`.
 *  - Workout duration (mins + secs) — hidden when the score itself is a time
 *    (in which case the score IS the duration).
 *  - Per-exercise log rows, one per set (straight sets) or per round
 *    (intervals). Inputs visible per measurement type / per-round metric.
 *  - Notes textarea.
 *
 * Navigation contract: the caller passes `?returnUrl=` to land back where
 * they started. The dashboard drawer wires `returnUrl=/?openDrawer=<id>` so
 * the dashboard auto-reopens the drawer on the just-logged workout.
 */
@Component({
  selector: 'app-workout-log-page',
  imports: [
    DatePipe,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './workout-log-page.html',
  styleUrl: './workout-log-page.scss',
})
export class WorkoutLogPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly workoutsService = inject(WorkoutsService);
  private readonly snackBar = inject(MatSnackBar);

  private readonly saveAction = createPendingAction<void>();
  protected readonly saving = this.saveAction.pending;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly scheduledWorkout = signal<ScheduledWorkoutResponse | null>(null);
  protected readonly workout = signal<WorkoutResponse | null>(null);

  /**
   * Coach-on-behalf context, set from query params when the page is opened
   * from the gym schedule drawer's "Log Athlete Result" / "Edit logs" flow.
   * When non-null, `load()` reads via the gym-scoped athlete-pivoted
   * endpoint instead of the caller's personal feed, and `onSave()` writes
   * via the on-behalf POST instead of the sync endpoint.
   */
  protected readonly coachContext = signal<{
    gymId: string;
    groupId: string;
    athleteId: string;
    athleteName: string | null;
  } | null>(null);
  protected readonly isCoachMode = computed(() => this.coachContext() !== null);

  protected readonly returnUrl = signal<string>('/');

  // Workout-level inputs.
  protected readonly scoreMinutes = signal('0');
  protected readonly scoreSeconds = signal('0');
  protected readonly scoreNumericValue = signal('');
  protected readonly durationMinutes = signal('00');
  protected readonly durationSeconds = signal('00');
  protected readonly notes = signal('');
  protected readonly exerciseGroups = signal<ExerciseLogGroup[]>([]);

  /**
   * Effective score type for this log. Prefers the scheduled row's
   * `scoreType` when set to a real value; otherwise falls back to the
   * workout template's `scoreType`. The fallback heals rows scheduled before
   * the Q15 fix that propagates `scoreType` from template to row — when the
   * athlete re-logs, the resolved value is sent on save and the row is
   * permanently corrected.
   */
  protected readonly scoreType = computed<WorkoutScoreType>(() => {
    const sw = this.scheduledWorkout()?.scoreType;
    if (sw && sw !== 'None') return sw;
    const wt = this.workout()?.scoreType;
    if (wt && wt !== 'None') return wt;
    return 'None';
  });

  protected readonly showScoreSection = computed(() => this.scoreType() !== 'None');
  protected readonly showTimeInput = computed(() => TIME_SCORE_TYPES.has(this.scoreType()));
  protected readonly showNumericInput = computed(() => {
    const t = this.scoreType();
    return t !== 'None' && t !== 'TimeToComplete' && t !== 'TieBreakTime';
  });
  /**
   * Workout duration is shown when the score is non-time (or absent). When
   * the score itself is a time, the score input doubles as the duration —
   * adding a second duration field would just create two redundant inputs.
   */
  protected readonly showDurationInput = computed(() => !this.showTimeInput());

  protected readonly numericScoreLabel = computed(
    () => NUMERIC_LABELS[this.scoreType()] ?? 'Score',
  );

  protected readonly workoutName = computed(() => this.workout()?.name ?? 'Workout');
  protected readonly scheduledDate = computed(() => this.scheduledWorkout()?.scheduledDate ?? null);

  protected readonly distanceUnits = DISTANCE_UNITS;

  protected readonly isUpdate = computed(
    () => this.scheduledWorkout()?.status === 'Completed',
  );
  protected readonly submitLabel = computed(() =>
    this.isUpdate() ? 'Update logs' : 'Save and complete',
  );

  /**
   * Page-title copy. In personal mode reads as "Log workout" / "Update
   * workout log." In coach mode the target athlete's name is prepended so
   * the coach has clear confirmation of who they're logging for.
   */
  protected readonly pageTitle = computed(() => {
    const coach = this.coachContext();
    const update = this.isUpdate();
    if (coach) {
      const name = coach.athleteName ?? 'athlete';
      return update ? `Edit ${name}'s logs` : `Log ${name}'s result`;
    }
    return update ? 'Update workout log' : 'Log workout';
  });

  async ngOnInit(): Promise<void> {
    const query = this.route.snapshot.queryParamMap;
    this.returnUrl.set(query.get('returnUrl') ?? '/');
    // Coach mode is triggered by the three on-behalf params traveling
    // together. Athlete-name is optional copy (improves the page title)
    // but doesn't affect the load/save paths.
    const onBehalfOfGymId = query.get('onBehalfOfGymId');
    const onBehalfOfGroupId = query.get('onBehalfOfGroupId');
    const onBehalfOfAthleteId = query.get('onBehalfOfAthleteId');
    if (onBehalfOfGymId && onBehalfOfGroupId && onBehalfOfAthleteId) {
      this.coachContext.set({
        gymId: onBehalfOfGymId,
        groupId: onBehalfOfGroupId,
        athleteId: onBehalfOfAthleteId,
        athleteName: query.get('onBehalfOfAthleteName') ?? null,
      });
    }
    const scheduledWorkoutId = this.route.snapshot.paramMap.get('scheduledWorkoutId');
    if (!scheduledWorkoutId) {
      this.error.set('Missing workout id.');
      this.loading.set(false);
      return;
    }
    await this.load(scheduledWorkoutId);
  }

  private async load(scheduledWorkoutId: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const sw = this.isCoachMode()
        ? await this.findCoachScheduledWorkout(scheduledWorkoutId)
        : await this.findScheduledWorkoutById(scheduledWorkoutId);
      if (!sw) {
        this.error.set('Could not find this workout.');
        return;
      }
      this.scheduledWorkout.set(sw);

      const w = sw.workoutId ? await this.workoutsService.getWorkout(sw.workoutId) : null;
      this.workout.set(w);

      this.notes.set(sw.notes ?? '');
      if (sw.scoreResult) this.populateExistingScore(sw.scoreResult);
      this.prefillDuration(sw.duration ?? w?.duration ?? null);
      this.exerciseGroups.set(this.buildExerciseGroups(w, sw.exerciseLogs ?? []));
    } catch {
      this.error.set('Could not load the workout. Try again.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Personal-mode lookup: find the scheduled row in the caller's own
   * personal feed across a ±60-day window centered on today.
   */
  private async findScheduledWorkoutById(
    id: string,
  ): Promise<ScheduledWorkoutResponse | null> {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 60);
    const to = new Date(today);
    to.setDate(to.getDate() + 60);
    const rows = await this.workoutsService.listScheduledWorkouts(
      toIsoDate(from),
      toIsoDate(to),
    );
    return rows.find((r) => r.id === id) ?? null;
  }

  /**
   * Coach-mode lookup (Q56): find the row in the target athlete's
   * gym-context schedule. Returns the same `ScheduledWorkoutResponse` shape
   * with merged per-athlete result fields (status, scoreResult, notes,
   * duration, exerciseLogs) populated from the result row when it exists,
   * or template defaults when not.
   */
  private async findCoachScheduledWorkout(
    id: string,
  ): Promise<ScheduledWorkoutResponse | null> {
    const ctx = this.coachContext();
    if (!ctx) return null;
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 60);
    const to = new Date(today);
    to.setDate(to.getDate() + 60);
    const rows = await this.workoutsService.getAthleteGymSchedule(ctx.gymId, ctx.athleteId, {
      from: toIsoDate(from),
      to: toIsoDate(to),
    });
    return rows.find((r) => r.id === id) ?? null;
  }

  protected async onSave(): Promise<void> {
    const sw = this.scheduledWorkout();
    const id = sw?.id;
    const workoutId = sw?.workoutId;
    if (!sw || !id || !workoutId) return;
    const coach = this.coachContext();
    await this.saveAction.run(async () => {
      try {
        const scoreResult = this.buildScoreResult();
        const duration = this.buildDurationIso();
        const exerciseLogs = this.buildExerciseLogPayloads(id);
        const trimmedNotes = this.notes().trim();

        if (coach) {
          // Coach-on-behalf path (rounds 10 + 12 + 14). Writes log fields to
          // the per-athlete result row; template fields (workoutId, date,
          // scoreType) stay pinned to the parent. Errors come back as HTTP
          // status codes with `code` discriminators on 404s (round 18) —
          // routing through `showGymError` picks the right copy per code.
          try {
            await this.workoutsService.logResultOnBehalf(
              coach.gymId,
              coach.groupId,
              id,
              {
                targetAthleteId: coach.athleteId,
                status: 'Completed',
                scoreResult: scoreResult || null,
                notes: trimmedNotes || null,
                duration,
                exerciseLogs,
              },
            );
          } catch (err) {
            showGymError(this.snackBar, err, 'Could not save the workout log.');
            return;
          }
        } else {
          // Personal path — caller logs their own scheduled workout via the
          // existing sync surface.
          const sync = await this.workoutsService.syncScheduledWorkout({
            id,
            workoutId,
            trainingGroupId: sw.trainingGroupId ?? null,
            athleteId: sw.athleteId ?? null,
            scheduledDate: sw.scheduledDate ?? '',
            // Send the resolved scoreType (falls back to the workout template
            // when the row's value is None). On a row scheduled before the
            // Q15 fix, this is the moment the row's `scoreType` gets
            // permanently corrected — dashboard will start rendering the
            // score block on the next load.
            scoreType: this.scoreType(),
            status: 'Completed',
            scoreResult: scoreResult || null,
            notes: trimmedNotes || null,
            duration,
            exerciseLogs,
            updatedAt: new Date().toISOString(),
          });
          if (sync?.resolution === 'Forbidden') {
            this.snackBar.open(
              SYNC_RESULT_MESSAGES['Forbidden'] ?? 'You cannot log this workout.',
              'Dismiss',
              { duration: 4000 },
            );
            return;
          }
          if (sync?.resolution === 'ScoreRequiresCompleted') {
            // Shouldn't happen — we always send Completed here — but surface
            // a useful message instead of silently no-op'ing.
            this.snackBar.open('Mark the workout completed before adding a score.', 'Dismiss', {
              duration: 4000,
            });
            return;
          }
        }

        this.snackBar.open(
          this.isUpdate() ? 'Logs updated.' : 'Workout logged.',
          'Dismiss',
          { duration: 2500 },
        );
        await this.router.navigateByUrl(this.returnUrl());
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not save the workout log.');
      }
    });
  }

  protected onCancel(): Promise<boolean> {
    return this.router.navigateByUrl(this.returnUrl());
  }

  // ─── Score / duration helpers ──────────────────────────────────────────

  private populateExistingScore(scoreResult: string): void {
    const hasTime = TIME_SCORE_TYPES.has(this.scoreType());
    const hasNumeric =
      this.scoreType() !== 'None' &&
      this.scoreType() !== 'TimeToComplete' &&
      this.scoreType() !== 'TieBreakTime';
    if (hasTime && hasNumeric) {
      const [t, n] = scoreResult.split(' | ', 2);
      if (t) this.parseTimeIntoFields(t);
      if (n != null) this.scoreNumericValue.set(n);
    } else if (hasTime) {
      this.parseTimeIntoFields(scoreResult);
    } else if (hasNumeric) {
      this.scoreNumericValue.set(scoreResult);
    }
  }

  private parseTimeIntoFields(time: string): void {
    const [m, s] = time.split(':', 2);
    if (m != null) this.scoreMinutes.set(m);
    if (s != null) this.scoreSeconds.set(s);
  }

  /**
   * Prefill the workout-duration inputs from a `hh:mm:ss` string (server
   * format) or pass-through `null`. Used for both the scheduled row's own
   * logged duration and the workout template's prescribed duration as a
   * fallback when the row has no logged duration yet.
   */
  private prefillDuration(iso: string | null): void {
    if (!iso) return;
    const [h, m, s] = iso.split(':').map(Number);
    const total = (h || 0) * 60 + (m || 0);
    this.durationMinutes.set(String(total).padStart(2, '0'));
    this.durationSeconds.set(String(s || 0).padStart(2, '0'));
  }

  private buildScoreResult(): string {
    if (!this.showScoreSection()) return '';
    const time = this.formatTimeFromFields(this.scoreMinutes(), this.scoreSeconds());
    if (this.showTimeInput() && this.showNumericInput()) {
      const n = this.scoreNumericValue().trim();
      return n ? `${time} | ${n}` : time;
    }
    if (this.showTimeInput()) return time;
    return this.scoreNumericValue().trim();
  }

  private formatTimeFromFields(minutes: string, seconds: string): string {
    const m = Number(minutes) || 0;
    const s = Number(seconds) || 0;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /**
   * Build the `hh:mm:ss` duration string the server expects. For time-typed
   * scores the score IS the duration, so we mirror the score's mins/secs
   * into the duration field. For non-time scores, read from the dedicated
   * duration inputs. Returns null when both are zero (no duration recorded).
   */
  private buildDurationIso(): string | null {
    const [m, s] = this.showTimeInput()
      ? [Number(this.scoreMinutes()) || 0, Number(this.scoreSeconds()) || 0]
      : [Number(this.durationMinutes()) || 0, Number(this.durationSeconds()) || 0];
    if (m === 0 && s === 0) return null;
    const hours = Math.floor(m / 60);
    const mins = m % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(mins)}:${pad(s)}`;
  }

  // ─── Exercise log group construction ───────────────────────────────────

  private buildExerciseGroups(
    workout: WorkoutResponse | null,
    existingLogs: ReadonlyArray<{
      id?: string | null;
      workoutExerciseId?: string | null;
      setNumber?: number | null;
      roundNumber?: number | null;
      actualReps?: string | null;
      actualWeightLbs?: number | null;
      actualDurationSeconds?: number | null;
      actualDistance?: number | null;
      actualDistanceUnit?: DistanceUnit | null;
      actualCalories?: number | null;
    }>,
  ): ExerciseLogGroup[] {
    if (!workout) return [];
    const isIntervals = workout.workoutType === 'Intervals';
    const roundCount = workout.roundCount ?? 1;
    const groups: ExerciseLogGroup[] = [];

    const logsByExercise = new Map<string, typeof existingLogs>();
    for (const log of existingLogs) {
      if (!log.workoutExerciseId) continue;
      const arr = (logsByExercise.get(log.workoutExerciseId) ?? []) as Array<typeof log>;
      arr.push(log);
      logsByExercise.set(log.workoutExerciseId, arr);
    }

    const exercises = (workout.exercises ?? [])
      .filter((e) => !e.isDeleted && e.id)
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

    for (const exercise of exercises) {
      const matching = (logsByExercise.get(exercise.id!) ?? []) as Array<{
        id?: string | null;
        setNumber?: number | null;
        roundNumber?: number | null;
        actualReps?: string | null;
        actualWeightLbs?: number | null;
        actualDurationSeconds?: number | null;
        actualDistance?: number | null;
        actualDistanceUnit?: DistanceUnit | null;
        actualCalories?: number | null;
      }>;

      const rows: ExerciseLogRow[] = [];
      if (isIntervals && exercise.perRoundMetric) {
        for (let round = 1; round <= roundCount; round++) {
          const log = matching.find((l) => l.roundNumber === round);
          rows.push(this.createIntervalRow(exercise, round, log));
        }
      } else if (!isIntervals && (exercise.sets ?? 0) > 0) {
        const repTargets = exercise.reps
          ? exercise.reps
              .split(/[,-]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        const sets = exercise.sets ?? 0;
        for (let set = 1; set <= sets; set++) {
          const target =
            repTargets.length > 0
              ? set <= repTargets.length
                ? repTargets[set - 1]
                : repTargets[repTargets.length - 1]
              : null;
          const log = matching.find((l) => l.setNumber === set);
          rows.push(this.createStraightSetRow(exercise, set, target, log));
        }
      }
      if (rows.length === 0) continue;

      groups.push({
        workoutExerciseId: exercise.id!,
        exerciseName: exercise.userEnteredExerciseName ?? 'Exercise',
        exerciseSummary: this.buildExerciseSummary(exercise, isIntervals),
        orderIndex: exercise.orderIndex ?? 0,
        rows,
      });
    }
    return groups;
  }

  private createStraightSetRow(
    exercise: WorkoutExerciseResponse,
    setNumber: number,
    targetReps: string | null,
    existingLog?: {
      id?: string | null;
      actualReps?: string | null;
      actualWeightLbs?: number | null;
      actualDurationSeconds?: number | null;
      actualDistance?: number | null;
      actualDistanceUnit?: DistanceUnit | null;
      actualCalories?: number | null;
    },
  ): ExerciseLogRow {
    const measurement: MeasurementType =
      exercise.measurementType && exercise.measurementType !== 'None'
        ? exercise.measurementType
        : this.inferMeasurementType(exercise);

    const showReps = measurement === 'Reps' || measurement === 'Weight';
    const showWeight = measurement === 'Weight';
    const showDuration = measurement === 'Time';
    const showDistance = measurement === 'Distance';
    const showCalories = measurement === 'Calories';

    const row: ExerciseLogRow = {
      label: `Set ${setNumber}`,
      setNumber,
      roundNumber: null,
      existingLogId: existingLog?.id ?? null,
      showRepsInput: showReps,
      showWeightInput: showWeight,
      showDurationInput: showDuration,
      showDistanceInput: showDistance,
      showCaloriesInput: showCalories,
      repInputLabel: 'Reps',
      actualReps: '',
      actualWeightLbs: '',
      actualDurationMinutes: '',
      actualDurationSeconds: '',
      actualDistance: '',
      actualDistanceUnit: showDistance
        ? (existingLog?.actualDistanceUnit ?? exercise.targetDistanceUnit ?? 'Meters')
        : null,
      actualCalories: '',
    };

    if (existingLog) {
      if (showReps) row.actualReps = existingLog.actualReps ?? '';
      if (showWeight) row.actualWeightLbs = numToString(existingLog.actualWeightLbs);
      if (showDuration && existingLog.actualDurationSeconds != null) {
        row.actualDurationMinutes = String(Math.floor(existingLog.actualDurationSeconds / 60));
        row.actualDurationSeconds = String(existingLog.actualDurationSeconds % 60);
      }
      if (showDistance) row.actualDistance = numToString(existingLog.actualDistance);
      if (showCalories) row.actualCalories = numToString(existingLog.actualCalories);
    } else {
      if (showReps) row.actualReps = targetReps ?? '';
      if (showWeight && exercise.targetWeight != null)
        row.actualWeightLbs = String(exercise.targetWeight);
      if (showDuration && exercise.duration) {
        const [, m, s] = exercise.duration.split(':').map(Number);
        row.actualDurationMinutes = String(m || 0);
        row.actualDurationSeconds = String(s || 0);
      }
      if (showDistance && exercise.targetDistance != null)
        row.actualDistance = String(exercise.targetDistance);
      if (showCalories && exercise.targetCalories != null)
        row.actualCalories = String(exercise.targetCalories);
    }

    return row;
  }

  private createIntervalRow(
    exercise: WorkoutExerciseResponse,
    roundNumber: number,
    existingLog?: {
      id?: string | null;
      actualReps?: string | null;
      actualWeightLbs?: number | null;
      actualDurationSeconds?: number | null;
      actualDistance?: number | null;
      actualDistanceUnit?: DistanceUnit | null;
      actualCalories?: number | null;
    },
  ): ExerciseLogRow {
    const metric = exercise.perRoundMetric!;
    const showReps = metric === 'Reps' || metric === 'CustomValue' || metric === 'Weight';
    const showWeight = metric === 'Weight';
    const showDuration = metric === 'Duration';
    const showDistance = metric === 'Distance';
    const showCalories = metric === 'Calories';

    const row: ExerciseLogRow = {
      label: `Round ${roundNumber}`,
      setNumber: null,
      roundNumber,
      existingLogId: existingLog?.id ?? null,
      showRepsInput: showReps,
      showWeightInput: showWeight,
      showDurationInput: showDuration,
      showDistanceInput: showDistance,
      showCaloriesInput: showCalories,
      repInputLabel: metric === 'CustomValue' ? 'Value' : 'Reps',
      actualReps: '',
      actualWeightLbs: '',
      actualDurationMinutes: '',
      actualDurationSeconds: '',
      actualDistance: '',
      actualDistanceUnit: showDistance
        ? (existingLog?.actualDistanceUnit ?? exercise.targetDistanceUnit ?? 'Meters')
        : null,
      actualCalories: '',
    };

    if (existingLog) {
      if (showReps) row.actualReps = existingLog.actualReps ?? '';
      if (showWeight) row.actualWeightLbs = numToString(existingLog.actualWeightLbs);
      if (showDuration && existingLog.actualDurationSeconds != null) {
        row.actualDurationMinutes = String(Math.floor(existingLog.actualDurationSeconds / 60));
        row.actualDurationSeconds = String(existingLog.actualDurationSeconds % 60);
      }
      if (showDistance) row.actualDistance = numToString(existingLog.actualDistance);
      if (showCalories) row.actualCalories = numToString(existingLog.actualCalories);
    }

    return row;
  }

  private inferMeasurementType(exercise: WorkoutExerciseResponse): MeasurementType {
    if (exercise.targetCalories != null) return 'Calories';
    if (exercise.targetDistance != null) return 'Distance';
    if (exercise.targetWeight != null) return 'Weight';
    if (exercise.duration) return 'Time';
    return 'Reps';
  }

  private buildExerciseSummary(
    exercise: WorkoutExerciseResponse,
    isIntervals: boolean,
  ): string | null {
    if (isIntervals) {
      return exercise.perRoundMetric
        ? `Records ${exercise.perRoundMetric.toLowerCase()} per round`
        : null;
    }
    const parts: string[] = [];
    if (exercise.reps != null && exercise.sets != null) parts.push(`${exercise.sets} × ${exercise.reps}`);
    else if (exercise.sets != null && exercise.sets > 0) parts.push(`${exercise.sets} sets`);
    if (exercise.targetWeight != null) parts.push(`@ ${exercise.targetWeight} lbs`);
    if (exercise.duration) parts.push(exercise.duration);
    if (exercise.targetDistance != null)
      parts.push(`${exercise.targetDistance} ${exercise.targetDistanceUnit ?? ''}`.trim());
    if (exercise.targetCalories != null) parts.push(`${exercise.targetCalories} cal`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  // ─── Save payload construction ────────────────────────────────────────

  private buildExerciseLogPayloads(scheduledWorkoutId: string): WorkoutExerciseLogRequest[] {
    const out: WorkoutExerciseLogRequest[] = [];
    const now = new Date().toISOString();
    for (const group of this.exerciseGroups()) {
      for (const row of group.rows) {
        let durationSeconds: number | null = null;
        if (row.showDurationInput) {
          const m = Number(row.actualDurationMinutes) || 0;
          const s = Number(row.actualDurationSeconds) || 0;
          durationSeconds = m * 60 + s;
        }
        out.push({
          id: row.existingLogId ?? crypto.randomUUID(),
          scheduledWorkoutId,
          workoutExerciseId: group.workoutExerciseId,
          exerciseName: group.exerciseName,
          setNumber: row.setNumber,
          roundNumber: row.roundNumber,
          actualReps:
            row.showRepsInput && row.actualReps.trim() ? row.actualReps.trim() : null,
          actualWeightLbs:
            row.showWeightInput && row.actualWeightLbs.trim()
              ? Number(row.actualWeightLbs)
              : null,
          actualDurationSeconds: durationSeconds,
          actualDistance:
            row.showDistanceInput && row.actualDistance.trim()
              ? Number(row.actualDistance)
              : null,
          actualDistanceUnit: row.showDistanceInput ? row.actualDistanceUnit : null,
          actualCalories:
            row.showCaloriesInput && row.actualCalories.trim()
              ? Number(row.actualCalories)
              : null,
          orderIndex: row.setNumber ?? row.roundNumber ?? 1,
          updatedAt: now,
        });
      }
    }
    return out;
  }

  // ─── Two-way binding helpers (signals don't bind to ngModel directly) ──

  protected setRowField<K extends keyof ExerciseLogRow>(
    groupIndex: number,
    rowIndex: number,
    field: K,
    value: ExerciseLogRow[K],
  ): void {
    this.exerciseGroups.update((groups) => {
      const next = groups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r })) }));
      const row = next[groupIndex]?.rows?.[rowIndex];
      if (row) row[field] = value;
      return next;
    });
  }
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function numToString(n: number | null | undefined): string {
  return n == null ? '' : String(n);
}
