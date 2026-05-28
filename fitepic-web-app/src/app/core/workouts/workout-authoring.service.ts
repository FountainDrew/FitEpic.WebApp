import { Injectable, computed, signal } from '@angular/core';

import { ParseWorkoutResponse } from '../api/generated/models/parse-workout-response';
import { ParsedWorkoutExerciseResponse } from '../api/generated/models/parsed-workout-exercise-response';
import { WorkoutRequest } from '../api/generated/models/workout-request';
import { WorkoutResponse } from '../api/generated/models/workout-response';
import { WorkoutExerciseRequest } from '../api/generated/models/workout-exercise-request';
import { WorkoutScoreType } from '../api/generated/models/workout-score-type';
import { WorkoutType } from '../api/generated/models/workout-type';
import { DraftExercise, DraftWorkout } from './draft-models';

/**
 * Drives the editor's draft state. Intended to be **component-scoped** (not
 * `providedIn: 'root'`) so each editor instance gets its own draft and there's
 * no cross-contamination between create → cancel → create cycles.
 *
 * Note on `isRemoved` vs `isDeleted`:
 *   - `isRemoved` is the UI's soft-delete-with-restore flag.
 *   - On save, only exercises that (a) exist on the server AND (b) are still
 *     `isRemoved` emit `isDeleted: true` to the wire. New rows the user added
 *     and then removed in the same session are simply dropped from the payload.
 */
@Injectable()
export class WorkoutAuthoringService {
  private readonly workoutSignal = signal<DraftWorkout>(this.emptyWorkout());
  private readonly exercisesSignal = signal<DraftExercise[]>([]);
  private readonly dirtySignal = signal(false);

  /**
   * True once the user has typed in the name input. System-supplied names
   * (defaults set by `setDefaultName`, parser results set by
   * `loadFromParseResult`) don't flip this. We use it to decide whether a
   * later parse can overwrite the current name: it can iff the user hasn't
   * taken ownership of the field yet.
   */
  private readonly nameEditedByUser = signal(false);

  readonly workout = this.workoutSignal.asReadonly();
  readonly exercises = this.exercisesSignal.asReadonly();
  readonly dirty = this.dirtySignal.asReadonly();

  readonly visibleExercises = computed(() =>
    this.exercisesSignal()
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex),
  );

  readonly isIntervals = computed(() => this.workoutSignal().workoutType === 'Intervals');

  // ─── Workout-level patches ─────────────────────────────────────────────

  patchWorkout(patch: Partial<DraftWorkout>): void {
    this.workoutSignal.update((w) => ({ ...w, ...patch }));
    this.dirtySignal.set(true);
  }

  /**
   * Called when the user types into the name input. Records user-ownership so
   * later parses leave the name alone.
   */
  setNameFromUser(name: string): void {
    this.workoutSignal.update((w) => ({ ...w, name }));
    this.nameEditedByUser.set(true);
    this.dirtySignal.set(true);
  }

  /**
   * System-supplied default (e.g., "Workout - 5_19_26" when launched from the
   * Schedule tab). Only applies when the user hasn't typed their own name yet,
   * and doesn't mark the draft dirty — closing without further edits should
   * not prompt a "discard changes?" dialog.
   */
  setDefaultName(name: string): void {
    if (this.nameEditedByUser()) return;
    if (this.workoutSignal().name.trim().length > 0) return;
    this.workoutSignal.update((w) => ({ ...w, name }));
  }

  // ─── Exercise operations ───────────────────────────────────────────────

  addExercise(seed: Partial<DraftExercise> & { userEnteredExerciseName: string }): DraftExercise {
    const nextOrder = this.exercisesSignal().reduce(
      (max, e) => Math.max(max, e.orderIndex),
      -1,
    );
    const created: DraftExercise = {
      id: seed.id ?? crypto.randomUUID(),
      existsOnServer: false,
      isRemoved: false,
      isNew: true,
      userEnteredExerciseName: seed.userEnteredExerciseName,
      standardExerciseId: seed.standardExerciseId ?? null,
      sets: seed.sets ?? null,
      reps: seed.reps ?? null,
      duration: seed.duration ?? null,
      targetWeight: seed.targetWeight ?? null,
      targetDistance: seed.targetDistance ?? null,
      targetDistanceUnit: seed.targetDistanceUnit ?? null,
      targetCalories: seed.targetCalories ?? null,
      measurementType: seed.measurementType,
      perRoundMetric: seed.perRoundMetric ?? null,
      orderIndex: seed.orderIndex ?? nextOrder + 1,
    };
    this.exercisesSignal.update((list) => [...list, created]);
    this.dirtySignal.set(true);
    return created;
  }

  updateExercise(id: string, patch: Partial<DraftExercise>): void {
    this.exercisesSignal.update((list) =>
      list.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
    this.dirtySignal.set(true);
  }

  softDeleteExercise(id: string): void {
    // Rows that never existed server-side (manually added this session, or new
    // rows from an initial parse) have no "removed" state worth surfacing —
    // drop them outright so the user doesn't see a strikethrough/REMOVED badge
    // for something the workout never had in the first place.
    const existing = this.exercisesSignal().find((e) => e.id === id);
    if (existing && !existing.existsOnServer) {
      this.exercisesSignal.update((list) => list.filter((e) => e.id !== id));
      this.dirtySignal.set(true);
      return;
    }
    this.updateExercise(id, { isRemoved: true });
  }

  restoreExercise(id: string): void {
    this.updateExercise(id, { isRemoved: false });
  }

  moveExercise(id: string, direction: 'up' | 'down'): void {
    const ordered = this.visibleExercises();
    const idx = ordered.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= ordered.length) return;
    this.reorderTo(idx, target);
  }

  /** Move the exercise at `fromIndex` to `toIndex` (used by drag-drop). */
  reorderExercise(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    this.reorderTo(fromIndex, toIndex);
  }

  private reorderTo(fromIndex: number, toIndex: number): void {
    const ordered = this.visibleExercises().slice();
    if (
      fromIndex < 0 ||
      fromIndex >= ordered.length ||
      toIndex < 0 ||
      toIndex >= ordered.length
    ) {
      return;
    }
    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);
    const renumbered = ordered.map((e, i) => ({ ...e, orderIndex: i }));
    this.exercisesSignal.set(renumbered);
    this.dirtySignal.set(true);
  }

  // ─── Hydration ─────────────────────────────────────────────────────────

  reset(): void {
    this.workoutSignal.set(this.emptyWorkout());
    this.exercisesSignal.set([]);
    this.dirtySignal.set(false);
    this.nameEditedByUser.set(false);
  }

  /** Initial parse — replaces the current draft with the parser's result. */
  loadFromParseResult(result: ParseWorkoutResponse, rawText: string): void {
    const current = this.workoutSignal();
    // Name precedence: user-edited > parser-supplied > current (system default
    // or empty). This lets a `Workout - m_d_yy` default from scheduling
    // context be replaced when the parser identifies a real name like "Fran".
    const nextName = this.nameEditedByUser()
      ? current.name
      : (result.name?.trim() || current.name);
    this.workoutSignal.set({
      ...current,
      name: nextName,
      instructions: result.instructions ?? current.instructions,
      rawText: rawText,
      workoutType: coerceWorkoutType(result.workoutType) ?? current.workoutType,
      scoreType: coerceScoreType(result.predictedScoreType) ?? current.scoreType,
      roundCount: result.roundCount ?? current.roundCount,
      duration: result.duration ?? current.duration,
    });
    // Initial parse sets `isNew: false` so the row baseline matches a freshly
    // loaded workout. The NEW badge then only fires for things genuinely added
    // mid-session — `addExercise` (manual picker) and the merge path's
    // newly-detected rows. Otherwise every row on a fresh create would carry
    // the badge and the signal becomes noise.
    this.exercisesSignal.set(
      (result.exercises ?? []).map((e, i) => parsedToDraft(e, i, /* isNew */ false)),
    );
    this.dirtySignal.set(true);
  }

  /**
   * Re-analyze merge — matches the parser's exercise list against the current
   * draft (by `standardExerciseId` first, then by normalized lowercase name).
   * Matched exercises have their metrics overwritten; new ones are appended;
   * unmatched draft exercises are marked `isRemoved`.
   */
  mergeFromParseResult(result: ParseWorkoutResponse, rawText: string): void {
    const incoming = result.exercises ?? [];
    const used = new Set<string>(); // ids of draft exercises matched this round
    const next: DraftExercise[] = this.exercisesSignal().map((e) => ({ ...e }));

    for (const parsed of incoming) {
      const match = findMatch(next, parsed, used);
      if (match) {
        used.add(match.id);
        const overlay = parsedToDraft(parsed, match.orderIndex, /* isNew */ false);
        // Preserve identity + server-side existence.
        Object.assign(match, {
          ...overlay,
          id: match.id,
          existsOnServer: match.existsOnServer,
          isRemoved: false,
          isNew: match.isNew,
        });
      } else {
        next.push(
          parsedToDraft(parsed, next.reduce((m, e) => Math.max(m, e.orderIndex), -1) + 1, true),
        );
      }
    }

    for (const e of next) {
      if (!used.has(e.id) && !e.isNew) {
        e.isRemoved = true;
      } else if (!used.has(e.id) && e.isNew) {
        // Brand-new manual rows not in the new parse — also mark removed so
        // the user can decide whether to keep them. Restore if they want it.
        e.isRemoved = true;
      }
    }

    this.exercisesSignal.set(next);
    this.workoutSignal.update((w) => ({
      ...w,
      rawText,
      // Workout-level fields can update too, but we don't clobber a user-
      // edited name on re-analyze.
      instructions: result.instructions ?? w.instructions,
      workoutType: coerceWorkoutType(result.workoutType) ?? w.workoutType,
      scoreType: coerceScoreType(result.predictedScoreType) ?? w.scoreType,
      roundCount: result.roundCount ?? w.roundCount,
      duration: result.duration ?? w.duration,
    }));
    this.dirtySignal.set(true);
  }

  /** Edit mode hydration — loads an existing server workout into the draft. */
  loadFromResponse(workout: WorkoutResponse): void {
    this.workoutSignal.set({
      id: workout.id ?? crypto.randomUUID(),
      existsOnServer: true,
      name: workout.name ?? '',
      instructions: workout.instructions ?? '',
      rawText: workout.rawText ?? '',
      workoutType: (workout.workoutType ?? 'Other') as WorkoutType,
      scoreType: (workout.scoreType ?? 'None') as WorkoutScoreType,
      roundCount: workout.roundCount ?? null,
      duration: workout.duration ?? null,
      origin: workout.origin ?? 'Personal',
      gymId: workout.gymId ?? null,
    });
    this.exercisesSignal.set(
      (workout.exercises ?? []).map((e) => ({
        id: e.id ?? crypto.randomUUID(),
        existsOnServer: true,
        isRemoved: false,
        isNew: false,
        userEnteredExerciseName: e.userEnteredExerciseName ?? '',
        standardExerciseId: e.standardExerciseId ?? null,
        sets: e.sets ?? null,
        reps: e.reps ?? null,
        duration: e.duration ?? null,
        targetWeight: e.targetWeight ?? null,
        targetDistance: e.targetDistance ?? null,
        targetDistanceUnit: e.targetDistanceUnit ?? null,
        targetCalories: e.targetCalories ?? null,
        measurementType: e.measurementType,
        perRoundMetric: e.perRoundMetric ?? null,
        orderIndex: e.orderIndex ?? 0,
      })),
    );
    this.dirtySignal.set(false);
    // Loaded server workout already has a real name — treat the field as
    // user-owned so a later parse doesn't clobber it.
    this.nameEditedByUser.set(true);
  }

  markClean(): void {
    this.dirtySignal.set(false);
  }

  // ─── Save ──────────────────────────────────────────────────────────────

  /**
   * Builds the `WorkoutRequest` payload to send to the sync endpoint.
   * `authorAthleteId` is the caller's id (for the `athleteId` audit field).
   */
  toRequestPayload(authorAthleteId: string): WorkoutRequest {
    const w = this.workoutSignal();
    const exercises: WorkoutExerciseRequest[] = [];
    for (const e of this.exercisesSignal()) {
      // Drop brand-new rows the user removed before saving — they never existed
      // server-side and aren't part of the workout.
      if (!e.existsOnServer && e.isRemoved) continue;
      exercises.push({
        id: e.id,
        workoutId: w.id,
        userEnteredExerciseName: e.userEnteredExerciseName,
        standardExerciseId: e.standardExerciseId,
        sets: e.sets,
        reps: e.reps,
        duration: e.duration,
        targetWeight: e.targetWeight,
        targetDistance: e.targetDistance,
        targetDistanceUnit: e.targetDistanceUnit,
        targetCalories: e.targetCalories,
        measurementType: e.measurementType,
        perRoundMetric: e.perRoundMetric,
        orderIndex: e.orderIndex,
        isDeleted: e.existsOnServer && e.isRemoved,
        updatedAt: new Date().toISOString(),
      });
    }
    return {
      id: w.id,
      athleteId: authorAthleteId,
      gymId: w.gymId,
      name: w.name.trim() || null,
      workoutType: w.workoutType,
      scoreType: w.scoreType,
      origin: w.origin,
      instructions: w.instructions.trim() || null,
      rawText: w.rawText.trim() || null,
      duration: w.duration,
      roundCount: w.workoutType === 'Intervals' ? w.roundCount ?? null : null,
      exercises,
      isArchived: false,
      isDeleted: false,
      updatedAt: new Date().toISOString(),
    };
  }

  private emptyWorkout(): DraftWorkout {
    return {
      id: crypto.randomUUID(),
      existsOnServer: false,
      name: '',
      instructions: '',
      rawText: '',
      workoutType: 'StraightSets',
      scoreType: 'None',
      roundCount: null,
      duration: null,
      origin: 'Personal',
      gymId: null,
    };
  }
}

function parsedToDraft(
  parsed: ParsedWorkoutExerciseResponse,
  orderIndex: number,
  isNew: boolean,
): DraftExercise {
  return {
    id: crypto.randomUUID(),
    existsOnServer: false,
    isRemoved: false,
    isNew,
    userEnteredExerciseName: parsed.name ?? parsed.matchedExerciseName ?? '',
    standardExerciseId: parsed.standardExerciseId ?? null,
    sets: parsed.sets ?? null,
    reps: formatReps(parsed.reps ?? null),
    duration: parsed.duration ?? null,
    targetWeight: parsed.targetWeight ?? null,
    targetDistance: parsed.targetDistance ?? null,
    targetDistanceUnit: parsed.targetDistanceUnit ?? null,
    targetCalories: parsed.targetCalories ?? null,
    measurementType: parsed.measurementType,
    perRoundMetric: parsed.perRoundMetric ?? null,
    orderIndex,
  };
}

/** Parser returns reps as `number[]` — flatten to the wire string format. */
function formatReps(reps: number[] | null): string | null {
  if (!reps || reps.length === 0) return null;
  if (reps.length === 1) return String(reps[0]);
  return reps.join('-');
}

function findMatch(
  pool: DraftExercise[],
  parsed: ParsedWorkoutExerciseResponse,
  used: Set<string>,
): DraftExercise | undefined {
  if (parsed.standardExerciseId) {
    const m = pool.find(
      (e) => !used.has(e.id) && e.standardExerciseId === parsed.standardExerciseId,
    );
    if (m) return m;
  }
  const normalized = (parsed.name ?? parsed.matchedExerciseName ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return undefined;
  return pool.find(
    (e) => !used.has(e.id) && e.userEnteredExerciseName.trim().toLowerCase() === normalized,
  );
}

const WORKOUT_TYPES: WorkoutType[] = [
  'StraightSets',
  'AMRAP',
  'ForTime',
  'EMOM',
  'Tabata',
  'Circuit',
  'Chipper',
  'Intervals',
  'Other',
];
const SCORE_TYPES: WorkoutScoreType[] = [
  'None',
  'TimeToComplete',
  'TimeCapPlusReps',
  'TotalReps',
  'RepsPerRound',
  'HeaviestLoad',
  'TotalLoad',
  'TimeAndLoad',
  'RepsAndLoad',
  'PointsSystem',
  'RoundsAndReps',
  'Meters',
  'Calories',
  'Miles',
  'Feet',
  'TieBreakTime',
  'CustomNumeric',
];

function coerceWorkoutType(value: string | null | undefined): WorkoutType | null {
  if (!value) return null;
  return (WORKOUT_TYPES as readonly string[]).includes(value) ? (value as WorkoutType) : null;
}

function coerceScoreType(value: string | null | undefined): WorkoutScoreType | null {
  if (!value) return null;
  return (SCORE_TYPES as readonly string[]).includes(value) ? (value as WorkoutScoreType) : null;
}
