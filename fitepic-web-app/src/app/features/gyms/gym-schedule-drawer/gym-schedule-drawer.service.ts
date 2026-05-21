import { Injectable, computed, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import { GymScheduleCardRow } from '../gym-schedule-card/gym-schedule-card';

/**
 * Owns the right-side drawer that surfaces details + coach actions for a
 * gym-scheduled workout. Mirrors `WorkoutDrawerService` shape so the consuming
 * page wires them the same way: open the drawer with a row, listen on
 * `actionCompleted` to reload, close on action.
 */
@Injectable({ providedIn: 'root' })
export class GymScheduleDrawerService {
  private readonly selected = signal<GymScheduleCardRow | null>(null);

  readonly row = this.selected.asReadonly();
  readonly isOpen = computed(() => this.selected() !== null);

  /**
   * Emits whenever a mutating drawer action (edit / reschedule / unschedule)
   * succeeds. The schedule tab subscribes via `takeUntilDestroyed` and
   * refreshes the visible week.
   */
  private readonly actionCompleted$ = new Subject<void>();
  readonly actionCompleted: Observable<void> = this.actionCompleted$.asObservable();

  open(row: GymScheduleCardRow): void {
    this.selected.set(row);
  }

  close(): void {
    this.selected.set(null);
  }

  notifyActionCompleted(): void {
    this.actionCompleted$.next();
  }
}
