import { DistanceUnit } from '../api/generated/models/distance-unit';
import { MeasurementType } from '../api/generated/models/measurement-type';
import { PerRoundMetric } from '../api/generated/models/per-round-metric';
import { WorkoutOrigin } from '../api/generated/models/workout-origin';
import { WorkoutScoreType } from '../api/generated/models/workout-score-type';
import { WorkoutType } from '../api/generated/models/workout-type';

/**
 * In-memory representation of a single exercise being edited inside the workout
 * authoring flow. Mirrors `WorkoutExerciseRequest` plus two UI-only flags:
 *
 * - `isRemoved` — soft-deleted in the editor with the option to Restore. Only
 *   converts to `isDeleted: true` on the wire when (a) the exercise exists on
 *   the server (i.e. came from a load or a prior save) AND (b) it's still
 *   `isRemoved` at save time. Brand-new exercises marked `isRemoved` are
 *   dropped from the payload entirely.
 * - `isNew` — added in this editing session (vs. loaded from the server). Used
 *   so the UI can mark them with a "NEW" badge after a re-analyze.
 */
export interface DraftExercise {
  id: string;
  /** True if this row was loaded from the server (existing row). */
  existsOnServer: boolean;
  /** Soft-deleted in the UI; can be restored. */
  isRemoved: boolean;
  /** Added in this editing session. */
  isNew: boolean;

  userEnteredExerciseName: string;
  standardExerciseId: string | null;

  sets: number | null;
  reps: string | null;
  duration: string | null;
  targetWeight: number | null;
  targetDistance: number | null;
  targetDistanceUnit: DistanceUnit | null;
  targetCalories: number | null;

  measurementType: MeasurementType | undefined;
  perRoundMetric: PerRoundMetric | null;

  orderIndex: number;
}

/**
 * In-memory representation of the workout being authored. The fields here are
 * the union of everything `WorkoutRequest` accepts plus a `dirty` flag.
 */
export interface DraftWorkout {
  id: string;
  /** True if this workout exists on the server (edit mode). */
  existsOnServer: boolean;

  name: string;
  instructions: string;
  rawText: string;

  workoutType: WorkoutType;
  scoreType: WorkoutScoreType;
  roundCount: number | null;
  /** Workout-level duration in `hh:mm:ss` form, or null. */
  duration: string | null;

  origin: WorkoutOrigin;
  /** Selected gym id (null = personal library). */
  gymId: string | null;
}
