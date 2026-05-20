import { Component, computed, input, output } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

import { WorkoutResponse } from '../../../core/api/generated/models/workout-response';

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
    const dur = this.formatDuration(w.duration);
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

  protected exerciseSummary(exercise: {
    reps?: string | null;
    sets?: number | null;
    targetWeight?: number | null;
    duration?: string | null;
  }): string {
    const parts: string[] = [];
    if (exercise.sets != null && exercise.reps) parts.push(`${exercise.sets}×${exercise.reps}`);
    else if (exercise.reps) parts.push(exercise.reps);
    else if (exercise.sets != null) parts.push(`${exercise.sets} sets`);
    if (exercise.targetWeight != null) parts.push(`@${exercise.targetWeight}lb`);
    if (exercise.duration) parts.push(exercise.duration);
    return parts.join(' ');
  }

  protected onClick(): void {
    this.select.emit(this.workout());
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onClick();
    }
  }

  /**
   * Format an ISO-8601 duration value (`hh:mm:ss`) as a human-readable string.
   * Mirrors the dashboard workout-card's behaviour so the library card reads
   * the same way.
   */
  private formatDuration(value: string | null | undefined): string {
    if (!value) return '';
    const [h, m, s] = value.split(':').map(Number);
    const totalMinutes = (h || 0) * 60 + (m || 0) + Math.round((s || 0) / 60);
    if (totalMinutes === 0) return '';
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  }
}
