import { Component, HostListener, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { WorkoutDrawerService } from './workout-drawer.service';

@Component({
  selector: 'app-workout-drawer',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './workout-drawer.html',
  styleUrl: './workout-drawer.scss',
})
export class WorkoutDrawer {
  protected readonly service = inject(WorkoutDrawerService);

  protected readonly metaLine = computed(() => {
    const c = this.service.workout();
    if (!c) return '';
    const segments: string[] = [];
    if (c.workoutType) segments.push(c.workoutType);
    const dur = this.formatDuration(c.durationMinutes);
    if (dur) segments.push(dur);
    const count = c.exerciseCount ?? 0;
    if (count > 0) segments.push(count === 1 ? '1 exercise' : `${count} exercises`);
    return segments.join(' · ');
  });

  protected readonly hasExercises = computed(() => (this.service.workout()?.exercises?.length ?? 0) > 0);
  protected readonly hasRawText = computed(() => Boolean(this.service.workout()?.rawText?.trim()));
  protected readonly isCompleted = computed(() => this.service.workout()?.status === 'Completed');

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.service.isOpen()) this.service.close();
  }

  protected close(): void {
    this.service.close();
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
