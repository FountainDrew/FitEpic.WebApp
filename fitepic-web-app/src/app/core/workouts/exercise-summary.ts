import { DistanceUnit } from '../api/generated/models/distance-unit';

import { formatDurationFromIso } from './format-duration';

/**
 * The prescription fields of a workout exercise that contribute to its
 * one-line summary. Structurally compatible with `WorkoutExerciseResponse`,
 * but declared locally so callers holding a draft/partial shape can use this
 * too.
 */
export interface ExercisePrescription {
  sets?: number | null;
  reps?: string | null;
  targetWeight?: number | null;
  duration?: string | null;
  targetDistance?: number | null;
  targetDistanceUnit?: DistanceUnit | null;
  targetCalories?: number | null;
}

const DISTANCE_UNIT_LABELS: Record<DistanceUnit, string> = {
  Meters: 'm',
  Kilometers: 'km',
  Miles: 'mi',
  Feet: 'ft',
};

/**
 * Renders an exercise's prescription as a single compact line — the trailing
 * half of a `Thruster        3×10 @95lb` row.
 *
 * Ordering is volume first (`sets`/`reps`), then the qualifiers that modify it
 * (load, time, distance, calories), which is how the athlete reads the
 * prescription back. Every field is optional; unspecified ones are simply
 * omitted, and an exercise with no prescription at all yields `''` so callers
 * can skip rendering the span entirely.
 *
 * Distance and calories are included here — a "400m Run" or "15 Cal Row" has
 * its entire prescription in those fields, so leaving them out renders a bare
 * exercise name with no numbers at all.
 */
export function formatExerciseSummary(exercise: ExercisePrescription): string {
  const parts: string[] = [];

  if (exercise.sets != null && exercise.reps) parts.push(`${exercise.sets}×${exercise.reps}`);
  else if (exercise.reps) parts.push(exercise.reps);
  else if (exercise.sets != null) parts.push(`${exercise.sets} sets`);

  if (exercise.targetWeight != null) parts.push(`@${exercise.targetWeight}lb`);

  const duration = formatDurationFromIso(exercise.duration);
  if (duration) parts.push(duration);

  if (exercise.targetDistance != null) {
    const unit = exercise.targetDistanceUnit
      ? DISTANCE_UNIT_LABELS[exercise.targetDistanceUnit]
      : '';
    parts.push(`${exercise.targetDistance}${unit}`);
  }

  if (exercise.targetCalories != null) parts.push(`${exercise.targetCalories} cal`);

  return parts.join(' ');
}
