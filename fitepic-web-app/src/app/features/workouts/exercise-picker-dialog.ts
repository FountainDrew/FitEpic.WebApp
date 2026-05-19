import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';

import { StandardExercisesService } from '../../core/workouts/standard-exercises.service';
import { StandardExerciseResponse } from '../../core/api/generated/models/standard-exercise-response';

/** What the picker hands back when the user chooses an exercise. */
export interface ExercisePickerDialogResult {
  /** Null when the user typed a custom name with no standard match. */
  standardExerciseId: string | null;
  userEnteredExerciseName: string;
}

@Component({
  selector: 'app-exercise-picker-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
  ],
  templateUrl: './exercise-picker-dialog.html',
  styleUrl: './exercise-picker-dialog.scss',
})
export class ExercisePickerDialog implements OnInit {
  private readonly dialogRef =
    inject(MatDialogRef<ExercisePickerDialog, ExercisePickerDialogResult>);
  private readonly catalog = inject(StandardExercisesService);

  protected readonly query = signal('');
  protected readonly loading = signal(true);
  protected readonly all = this.catalog.exercises;

  protected readonly filtered = computed<StandardExerciseResponse[]>(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.all();
    if (!q) return list.slice(0, 50);
    return list
      .filter((e) => (e.name ?? '').toLowerCase().includes(q))
      .slice(0, 50);
  });

  protected readonly canAddCustom = computed(() => {
    const q = this.query().trim();
    if (q.length === 0) return false;
    return !this.all().some((e) => (e.name ?? '').toLowerCase() === q.toLowerCase());
  });

  async ngOnInit(): Promise<void> {
    try {
      await this.catalog.ensureLoaded();
    } finally {
      this.loading.set(false);
    }
  }

  protected pick(exercise: StandardExerciseResponse): void {
    if (!exercise.id || !exercise.name) return;
    this.dialogRef.close({
      standardExerciseId: exercise.id,
      userEnteredExerciseName: exercise.name,
    });
  }

  protected addCustom(): void {
    const name = this.query().trim();
    if (!name) return;
    this.dialogRef.close({
      standardExerciseId: null,
      userEnteredExerciseName: name,
    });
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}
