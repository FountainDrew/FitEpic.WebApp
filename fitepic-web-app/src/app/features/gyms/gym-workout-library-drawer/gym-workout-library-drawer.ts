import { Component, computed, inject, signal } from '@angular/core';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';

import { WorkoutResponse } from '../../../core/api/generated/models/workout-response';
import { LibraryWorkoutCard } from '../../shared/library-workout-card/library-workout-card';

export interface GymWorkoutLibraryDrawerData {
  /** Pre-loaded gym workout library. Schedule tab already has these in memory. */
  workouts: WorkoutResponse[];
  /** ISO `YYYY-MM-DD` date the chosen workout will be scheduled for. */
  scheduledDate: string;
  /** Number of training groups the workout will be scheduled to (used for subtitle copy). */
  groupCount: number;
}

/**
 * Right-side slideout that lists the gym workout library and lets the coach
 * pick one to schedule. Mirrors the dashboard's `WorkoutLibraryDrawer`
 * (athlete-personal library) — same layout, same `LibraryWorkoutCard` tiles,
 * same close-on-select behaviour. Doesn't load anything itself; the schedule
 * tab passes the pre-fetched gym workouts via `data` so the drawer opens
 * instantly.
 */
@Component({
  selector: 'app-gym-workout-library-drawer',
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
  templateUrl: './gym-workout-library-drawer.html',
  styleUrl: './gym-workout-library-drawer.scss',
})
export class GymWorkoutLibraryDrawer {
  private readonly dialogRef =
    inject(MatDialogRef<GymWorkoutLibraryDrawer, WorkoutResponse>);
  protected readonly data = inject<GymWorkoutLibraryDrawerData>(MAT_DIALOG_DATA);

  protected readonly query = signal('');

  protected readonly filtered = computed<WorkoutResponse[]>(() => {
    const q = this.query().trim().toLowerCase();
    const source = this.data.workouts;
    if (!q) return source;
    return source.filter((w) => {
      const name = (w.name ?? '').toLowerCase();
      const raw = (w.rawText ?? '').toLowerCase();
      if (name.includes(q) || raw.includes(q)) return true;
      return (w.exercises ?? []).some((e) =>
        (e.userEnteredExerciseName ?? '').toLowerCase().includes(q),
      );
    });
  });

  protected readonly empty = computed(() => this.data.workouts.length === 0);

  protected onSelect(workout: WorkoutResponse): void {
    this.dialogRef.close(workout);
  }

  protected onClose(): void {
    this.dialogRef.close();
  }
}
