import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';

import { WorkoutsService } from '../../../core/workouts/workouts.service';
import { WorkoutResponse } from '../../../core/api/generated/models/workout-response';
import { LibraryWorkoutCard } from '../../shared/library-workout-card/library-workout-card';

export interface WorkoutLibraryDrawerData {
  /** ISO `YYYY-MM-DD` date the chosen workout will be scheduled for. */
  scheduledDate: string;
}

/**
 * Right-side slideout that lists the caller's personal workout library and
 * lets them pick one to schedule. Renders each row using {@link LibraryWorkoutCard},
 * which visually matches the dashboard's scheduled-workout cards. Loads the
 * library on open and shows skeleton tiles while the fetch is in flight;
 * subsequent opens are instant thanks to the cache on
 * {@link WorkoutsService.listPersonalWorkouts}.
 */
@Component({
  selector: 'app-workout-library-drawer',
  imports: [
    DatePipe,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    LibraryWorkoutCard,
  ],
  templateUrl: './workout-library-drawer.html',
  styleUrl: './workout-library-drawer.scss',
})
export class WorkoutLibraryDrawer implements OnInit {
  private readonly dialogRef =
    inject(MatDialogRef<WorkoutLibraryDrawer, WorkoutResponse>);
  private readonly workoutsService = inject(WorkoutsService);
  protected readonly data = inject<WorkoutLibraryDrawerData>(MAT_DIALOG_DATA);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly workouts = signal<WorkoutResponse[]>([]);
  protected readonly query = signal('');

  protected readonly filtered = computed<WorkoutResponse[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.workouts();
    return this.workouts().filter((w) => {
      const name = (w.name ?? '').toLowerCase();
      const raw = (w.rawText ?? '').toLowerCase();
      if (name.includes(q) || raw.includes(q)) return true;
      return (w.exercises ?? []).some((e) =>
        (e.userEnteredExerciseName ?? '').toLowerCase().includes(q),
      );
    });
  });

  protected readonly empty = computed(
    () => !this.loading() && this.workouts().length === 0,
  );

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      const rows = await this.workoutsService.listPersonalWorkouts();
      this.workouts.set(rows);
    } catch {
      this.error.set('Could not load your workout library. Try again.');
    } finally {
      this.loading.set(false);
    }
  }

  protected onSelect(workout: WorkoutResponse): void {
    this.dialogRef.close(workout);
  }

  protected onClose(): void {
    this.dialogRef.close();
  }
}
