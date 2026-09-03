import { Component, computed, input, output } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

import { WorkoutResponse } from '../../../core/api/generated/models/workout-response';
import { formatExerciseSummary } from '../../../core/workouts/exercise-summary';
import { formatDurationFromIso } from '../../../core/workouts/format-duration';

/**
 * Card view for a workout in the personal library. Visually mirrors the
 * dashboard's scheduled-workout card so the slideout's list reads consistently,
 * but consumes the unprojected `WorkoutResponse` shape and projects the meta
 * line + body locally. No status badge — library items haven't been scheduled
 * yet — and click emits `select` rather than opening the drawer.
 */
type BodyMode = 'raw' | 'exercises' | 'placeholder';

@Component({
  selector: 'app-library-workout-card',
  imports: [MatCardModule],
  templateUrl: './library-workout-card.html',
  styleUrl: './library-workout-card.scss',
})
export class LibraryWorkoutCard {
  readonly workout = input.required<WorkoutResponse>();
  readonly select = output<WorkoutResponse>();

  protected readonly metaLine = computed(() => {
    const w = this.workout();
    const segments: string[] = [];
    if (w.workoutType) segments.push(w.workoutType);
    const dur = formatDurationFromIso(w.duration);
    if (dur) segments.push(dur);
    const count = (w.exercises ?? []).filter((e) => !e.isDeleted).length;
    if (count > 0) segments.push(count === 1 ? '1 exercise' : `${count} exercises`);
    return segments.join(' · ');
  });

  protected readonly bodyMode = computed<BodyMode>(() => {
    const w = this.workout();
    if (w.rawText?.trim()) return 'raw';
    if ((w.exercises?.length ?? 0) > 0) return 'exercises';
    return 'placeholder';
  });

  /** Visible exercises sorted by their `orderIndex`. */
  protected readonly visibleExercises = computed(() =>
    (this.workout().exercises ?? [])
      .filter((e) => !e.isDeleted)
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
  );

  /** Delegates to the shared formatter so cards and the detail drawer agree. */
  protected exerciseSummary = formatExerciseSummary;

  protected onClick(): void {
    this.select.emit(this.workout());
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onClick();
    }
  }
}
