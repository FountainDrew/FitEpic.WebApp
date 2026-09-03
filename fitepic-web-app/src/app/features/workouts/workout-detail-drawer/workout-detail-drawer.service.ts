import { Injectable, computed, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import { WorkoutResponse } from '../../../core/api/generated/models/workout-response';

/**
 * Open/close state for {@link WorkoutDetailDrawer}.
 *
 * Distinct from the dashboard's `WorkoutDrawerService`, which holds a
 * `DashboardWorkoutCardResponse` — a *scheduled* workout with per-athlete
 * status, score and logs. This one holds a bare `WorkoutResponse`: the
 * workout template itself, with no schedule or completion state attached.
 */
@Injectable({ providedIn: 'root' })
export class WorkoutDetailDrawerService {
  private readonly selected = signal<WorkoutResponse | null>(null);

  readonly workout = this.selected.asReadonly();
  readonly isOpen = computed(() => this.selected() !== null);

  /**
   * Emits when a mutating drawer action (currently: delete) succeeds. The
   * library page subscribes via `takeUntilDestroyed` and reloads its list. A
   * Subject rather than a signal + effect, matching `WorkoutDrawerService` —
   * subjects deliver every notification without value-equality coalescing.
   */
  private readonly actionCompleted$ = new Subject<void>();
  readonly actionCompleted: Observable<void> = this.actionCompleted$.asObservable();

  open(workout: WorkoutResponse): void {
    this.selected.set(workout);
  }

  close(): void {
    this.selected.set(null);
  }

  notifyActionCompleted(): void {
    this.actionCompleted$.next();
  }
}
