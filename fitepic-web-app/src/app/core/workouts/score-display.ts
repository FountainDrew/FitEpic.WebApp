import { WorkoutScoreType } from '../api/generated/models/workout-score-type';

/**
 * Map a `WorkoutScoreType` to its human display label.
 *
 * Mirrors `FitEpic.Mobile.Models.WorkoutUIModel.GetScoreTypeDisplay` so a
 * completed workout's score reads identically across mobile and web. Mobile
 * is the canonical implementation because it derives display from raw
 * fields off its local SQLite store; the web app now does the same instead
 * of leaning on the dashboard endpoint's `score.displayValue` (see
 * `gym-ownership-webapp-contract.md` round 8 note on displayValue
 * deprecation).
 *
 * Keep in sync with mobile when new score types land.
 */
export function getScoreTypeDisplay(scoreType: WorkoutScoreType | null | undefined): string {
  switch (scoreType) {
    case 'TimeToComplete':
      return 'Time to Complete';
    case 'TimeCapPlusReps':
      return 'Time Cap + Reps';
    case 'TotalReps':
      return 'Total Reps';
    case 'RepsPerRound':
      return 'Reps Per Round';
    case 'HeaviestLoad':
      return 'Heaviest Load';
    case 'TotalLoad':
      return 'Total Load';
    case 'TimeAndLoad':
      return 'Time + Load';
    case 'RepsAndLoad':
      return 'Reps + Load';
    case 'PointsSystem':
      return 'Points System';
    case 'RoundsAndReps':
      return 'Rounds + Reps';
    case 'Meters':
      return 'Meters';
    case 'Calories':
      return 'Calories';
    case 'Miles':
      return 'Miles';
    case 'Feet':
      return 'Feet';
    case 'TieBreakTime':
      return 'Tie Break Time';
    case 'CustomNumeric':
      return 'Custom Numeric';
    default:
      return 'None';
  }
}

/**
 * Format the completion-score display string for a scheduled workout.
 *
 * Returns `"Score: <result> <type-label>"` when the row qualifies as scored
 * — `status === 'Completed'`, `scoreType` is set and not `None`, and
 * `scoreResult` is non-empty. Returns `null` otherwise; callers should not
 * render a Score section in that case.
 *
 * Mirrors the mobile `ScheduledWorkoutUIModel.ToCardModel` rule:
 *
 * ```csharp
 * IsCompleted && !string.IsNullOrWhiteSpace(ScoreResult) && ScoreType != None
 *   ? $"Score: {ScoreResult} {GetScoreTypeDisplay(ScoreType)}"
 *   : null
 * ```
 *
 * No synthesis from duration / workoutType is done here — a `ForTime`
 * workout whose template was authored without a `scoreType` falls through
 * to `null` and the duration is shown in the Duration section instead.
 * Fix the workout template (set `scoreType = TimeToComplete`) to surface
 * the time as a labeled score.
 */
export function formatScoreDisplay(input: {
  status: string | null | undefined;
  scoreType: WorkoutScoreType | null | undefined;
  scoreResult: string | null | undefined;
}): string | null {
  if (input.status !== 'Completed') return null;
  if (!input.scoreType || input.scoreType === 'None') return null;
  const result = input.scoreResult?.trim();
  if (!result) return null;
  return `Score: ${result} ${getScoreTypeDisplay(input.scoreType)}`;
}

/**
 * Split form of {@link formatScoreDisplay} for surfaces that render the
 * score in two pieces — a section header that names the score type, and a
 * separate body that shows just the raw result. Avoids "Score:" appearing
 * twice on the same card / drawer.
 *
 * Returns `{ title, value }` when the row qualifies as scored, else `null`.
 * Title is `"Score: <type-display>"`, value is the raw `scoreResult` (e.g.
 * `"9:33"`, `"225"`, `"5+12"`).
 */
export function formatScoreTitleAndValue(input: {
  status: string | null | undefined;
  scoreType: WorkoutScoreType | null | undefined;
  scoreResult: string | null | undefined;
}): { title: string; value: string } | null {
  if (input.status !== 'Completed') return null;
  if (!input.scoreType || input.scoreType === 'None') return null;
  const value = input.scoreResult?.trim();
  if (!value) return null;
  return {
    title: `Score: ${getScoreTypeDisplay(input.scoreType)}`,
    value,
  };
}

/**
 * Score types whose primary value is a time, used to decide whether the
 * duration section is redundant alongside the score. Mirrors the same
 * subset used by the log page's score input branching.
 */
export function isTimeBasedScoreType(scoreType: WorkoutScoreType | null | undefined): boolean {
  return (
    scoreType === 'TimeToComplete' ||
    scoreType === 'TieBreakTime' ||
    scoreType === 'TimeCapPlusReps' ||
    scoreType === 'TimeAndLoad'
  );
}
