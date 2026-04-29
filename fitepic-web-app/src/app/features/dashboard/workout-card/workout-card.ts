import { Component, computed, inject, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

import { DashboardWorkoutCardResponse } from '../../../core/api/generated/models/dashboard-workout-card-response';
import { WorkoutDrawerService } from '../workout-drawer/workout-drawer.service';

type BodyMode = 'raw' | 'exercises' | 'placeholder';

@Component({
  selector: 'app-workout-card',
  imports: [MatCardModule],
  templateUrl: './workout-card.html',
  styleUrl: './workout-card.scss',
})
export class WorkoutCard {
  private readonly drawer = inject(WorkoutDrawerService);

  readonly card = input.required<DashboardWorkoutCardResponse>();

  protected readonly metaLine = computed(() => {
    const c = this.card();
    const segments: string[] = [];
    if (c.workoutType) segments.push(c.workoutType);
    const dur = this.formatDuration(c.durationMinutes);
    if (dur) segments.push(dur);
    const count = c.exerciseCount ?? 0;
    if (count > 0) segments.push(count === 1 ? '1 exercise' : `${count} exercises`);
    return segments.join(' · ');
  });

  protected readonly bodyMode = computed<BodyMode>(() => {
    const c = this.card();
    if (c.rawText?.trim()) return 'raw';
    if ((c.exercises?.length ?? 0) > 0) return 'exercises';
    return 'placeholder';
  });

  protected open(): void {
    this.drawer.open(this.card());
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.open();
    }
  }

  private formatDuration(minutes: number | null | undefined): string {
    const total = Math.max(0, Math.round(minutes ?? 0));
    if (total === 0) return '';
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  }
}
