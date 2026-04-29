import { Injectable, computed, signal } from '@angular/core';

import { DashboardWorkoutCardResponse } from '../../../core/api/generated/models/dashboard-workout-card-response';

@Injectable({ providedIn: 'root' })
export class WorkoutDrawerService {
  private readonly selected = signal<DashboardWorkoutCardResponse | null>(null);

  readonly workout = this.selected.asReadonly();
  readonly isOpen = computed(() => this.selected() !== null);

  open(workout: DashboardWorkoutCardResponse): void {
    this.selected.set(workout);
  }

  close(): void {
    this.selected.set(null);
  }
}
