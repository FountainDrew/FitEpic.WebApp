import { Component, computed, inject, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ScheduledWorkoutResponse } from '../../../core/api/generated/models/scheduled-workout-response';
import { WorkoutResponse } from '../../../core/api/generated/models/workout-response';
import { GymScheduleDrawerService } from '../gym-schedule-drawer/gym-schedule-drawer.service';

type BodyMode = 'raw' | 'exercises' | 'placeholder';

/**
 * Wire shape consumed by the gym schedule card. The schedule tab projects each
 * scheduled-workout row into this shape so the card stays unaware of how the
 * upstream data is fetched (workout library lookup + scheduled row + member
 * counts can all evolve independently).
 *
 * `completion` is optional and stays null until the per-group completion
 * endpoint is exposed by the API. When non-null, the card surfaces an
 * "X of Y logged" chip.
 */
export interface GymScheduleCardRow {
  scheduled: ScheduledWorkoutResponse;
  workout: WorkoutResponse | null;
  workoutName: string;
  /**
   * Display name of the training group this row belongs to. Renders as a chip
   * in the card header — important when the schedule view shows multiple
   * groups at once.
   */
  trainingGroupName: string | null;
  /** Display name of the coach who programmed the workout. Null when not yet resolved. */
  programmedByName: string | null;
  /** Per-group completion counts. Null when the projection isn't available. */
  completion: { logged: number; total: number } | null;
}

@Component({
  selector: 'app-gym-schedule-card',
  imports: [MatCardModule, MatIconModule, MatTooltipModule],
  templateUrl: './gym-schedule-card.html',
  styleUrl: './gym-schedule-card.scss',
})
export class GymScheduleCard {
  private readonly drawer = inject(GymScheduleDrawerService);

  readonly row = input.required<GymScheduleCardRow>();

  protected readonly metaLine = computed(() => {
    const w = this.row().workout;
    const sw = this.row().scheduled;
    const segments: string[] = [];
    if (w?.workoutType) segments.push(w.workoutType);
    const scoreLabel = formatScoreLabel(sw.scoreType, w?.scoreLabel);
    if (scoreLabel) segments.push(scoreLabel);
    const count = (w?.exercises ?? []).filter((e) => !e.isDeleted).length;
    if (count > 0) segments.push(count === 1 ? '1 exercise' : `${count} exercises`);
    return segments.join(' · ');
  });

  protected readonly bodyMode = computed<BodyMode>(() => {
    const w = this.row().workout;
    if (w?.rawText?.trim()) return 'raw';
    if ((w?.exercises ?? []).some((e) => !e.isDeleted)) return 'exercises';
    return 'placeholder';
  });

  protected readonly visibleExercises = computed(() =>
    (this.row().workout?.exercises ?? [])
      .filter((e) => !e.isDeleted)
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
  );

  protected exerciseSummary(e: {
    sets?: number | null;
    reps?: string | null;
    targetWeight?: number | null;
    duration?: string | null;
  }): string {
    const parts: string[] = [];
    if (e.sets != null && e.reps) parts.push(`${e.sets}×${e.reps}`);
    else if (e.reps) parts.push(e.reps);
    else if (e.sets != null) parts.push(`${e.sets} sets`);
    if (e.targetWeight != null) parts.push(`@${e.targetWeight}lb`);
    if (e.duration) parts.push(e.duration);
    return parts.join(' · ');
  }

  protected open(): void {
    this.drawer.open(this.row());
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.open();
    }
  }
}

function formatScoreLabel(
  scoreType: string | null | undefined,
  workoutLabel: string | null | undefined,
): string {
  if (workoutLabel?.trim()) return workoutLabel.trim();
  if (!scoreType || scoreType === 'None') return '';
  // Convert PascalCase enum to spaced words.
  return scoreType.replace(/([a-z])([A-Z])/g, '$1 $2');
}
