import { Injectable, computed, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import { DashboardWorkoutCardResponse } from '../../../core/api/generated/models/dashboard-workout-card-response';

@Injectable({ providedIn: 'root' })
export class WorkoutDrawerService {
  private readonly selected = signal<DashboardWorkoutCardResponse | null>(null);

  readonly workout = this.selected.asReadonly();
  readonly isOpen = computed(() => this.selected() !== null);

  /**
   * Emits whenever one of the drawer's mutating actions (delete logs /
   * unschedule / reschedule) succeeds. The dashboard subscribes via
   * `takeUntilDestroyed` and reloads its workout cards. An RxJS Subject is
   * used (rather than a signal + effect) because subjects deliver every
   * notification to active subscribers without value-equality coalescing.
   */
  private readonly actionCompleted$ = new Subject<void>();
  readonly actionCompleted: Observable<void> = this.actionCompleted$.asObservable();

  open(workout: DashboardWorkoutCardResponse): void {
    this.selected.set(workout);
  }

  close(): void {
    this.selected.set(null);
  }

  notifyActionCompleted(): void {
    this.actionCompleted$.next();
  }
}
