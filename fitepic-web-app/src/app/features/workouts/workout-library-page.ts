import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { WorkoutResponse } from '../../core/api/generated/models/workout-response';
import { WorkoutsService } from '../../core/workouts/workouts.service';
import { LibraryWorkoutCard } from '../shared/library-workout-card/library-workout-card';
import { WorkoutDetailDrawer } from './workout-detail-drawer/workout-detail-drawer';
import { WorkoutDetailDrawerService } from './workout-detail-drawer/workout-detail-drawer.service';

/**
 * The athlete's personal workout library — every workout they've authored,
 * searchable, with the full details of any one of them a click away.
 *
 * Search runs client-side over the whole library. That's a deliberate choice
 * while libraries are small: one fetch on load, then instant filtering with no
 * per-keystroke round trip. See `readmes/workout-library-api-requirements.md`
 * §1 — if libraries grow past what's reasonable to hold in memory, the fix is
 * a server-side search contract, not a debounce here.
 */
@Component({
  selector: 'app-workout-library-page',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    LibraryWorkoutCard,
    WorkoutDetailDrawer,
  ],
  templateUrl: './workout-library-page.html',
  styleUrl: './workout-library-page.scss',
})
export class WorkoutLibraryPage implements OnInit {
  private readonly workoutsService = inject(WorkoutsService);
  private readonly drawer = inject(WorkoutDetailDrawerService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly workouts = signal<WorkoutResponse[]>([]);
  protected readonly query = signal('');

  /**
   * Matches on workout name, raw text, and exercise names — the three places
   * an athlete would look for "that one with the thrusters". Matching raw
   * text matters most: plenty of workouts are saved unnamed, and the raw text
   * is all the card shows for those.
   */
  protected readonly filtered = computed<WorkoutResponse[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.workouts();
    return this.workouts().filter((w) => {
      if ((w.name ?? '').toLowerCase().includes(q)) return true;
      if ((w.rawText ?? '').toLowerCase().includes(q)) return true;
      return (w.exercises ?? []).some(
        (e) => !e.isDeleted && (e.userEnteredExerciseName ?? '').toLowerCase().includes(q),
      );
    });
  });

  /** Library has nothing in it at all, as opposed to nothing matching a search. */
  protected readonly empty = computed(() => !this.loading() && this.workouts().length === 0);

  protected readonly resultCount = computed(() => {
    const total = this.workouts().length;
    const shown = this.filtered().length;
    if (this.query().trim() && shown !== total) return `${shown} of ${total} workouts`;
    return total === 1 ? '1 workout' : `${total} workouts`;
  });

  constructor() {
    // Reload after a drawer action mutates the library (currently: delete), so
    // the deleted card disappears without a manual refresh.
    this.drawer.actionCompleted.pipe(takeUntilDestroyed()).subscribe(() => void this.load());
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.workouts.set(await this.workoutsService.listWorkoutLibrary());
    } catch {
      this.error.set('Could not load your workout library. Try again.');
    } finally {
      this.loading.set(false);
    }
  }

  protected retry(): void {
    void this.load();
  }

  protected onSelect(workout: WorkoutResponse): void {
    this.drawer.open(workout);
  }
}
