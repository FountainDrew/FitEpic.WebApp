import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';

import { DistanceUnit } from '../../core/api/generated/models/distance-unit';
import { MeasurementType } from '../../core/api/generated/models/measurement-type';
import { PerRoundMetric } from '../../core/api/generated/models/per-round-metric';
import { DraftExercise } from '../../core/workouts/draft-models';

export interface ExerciseConfigDialogData {
  /** Initial values; either a brand-new stub or an existing exercise being edited. */
  initial: Partial<DraftExercise> & { userEnteredExerciseName: string };
  /**
   * Whether the parent workout type is `Intervals`. Controls whether the
   * Measurement Type or the Per-Round Metric picker is shown (mutually
   * exclusive — Intervals uses per-round; everything else uses measurement).
   */
  isIntervals: boolean;
  mode: 'add' | 'edit';
}

/** Subset of `DraftExercise` that this dialog can change. */
export type ExerciseConfigDialogResult = Pick<
  DraftExercise,
  | 'userEnteredExerciseName'
  | 'standardExerciseId'
  | 'sets'
  | 'reps'
  | 'duration'
  | 'targetWeight'
  | 'targetDistance'
  | 'targetDistanceUnit'
  | 'targetCalories'
  | 'measurementType'
  | 'perRoundMetric'
>;

const MEASUREMENT_TYPES: MeasurementType[] = ['None', 'Weight', 'Time', 'Distance', 'Calories', 'Reps'];
const PER_ROUND_METRICS: PerRoundMetric[] = [
  'Weight',
  'Duration',
  'Distance',
  'Calories',
  'Reps',
  'CustomValue',
];
const DISTANCE_UNITS: DistanceUnit[] = ['Meters', 'Kilometers', 'Miles', 'Feet'];

@Component({
  selector: 'app-exercise-config-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  templateUrl: './exercise-config-dialog.html',
  styleUrl: './exercise-config-dialog.scss',
})
export class ExerciseConfigDialog {
  private readonly dialogRef =
    inject(MatDialogRef<ExerciseConfigDialog, ExerciseConfigDialogResult>);
  protected readonly data = inject<ExerciseConfigDialogData>(MAT_DIALOG_DATA);

  protected readonly name = signal(this.data.initial.userEnteredExerciseName ?? '');
  protected readonly standardExerciseId = signal<string | null>(
    this.data.initial.standardExerciseId ?? null,
  );
  protected readonly sets = signal<string>(toInputString(this.data.initial.sets));
  protected readonly reps = signal<string>(this.data.initial.reps ?? '');
  protected readonly duration = signal<string>(this.data.initial.duration ?? '');
  protected readonly targetWeight = signal<string>(toInputString(this.data.initial.targetWeight));
  protected readonly targetDistance = signal<string>(
    toInputString(this.data.initial.targetDistance),
  );
  protected readonly targetDistanceUnit = signal<DistanceUnit | null>(
    this.data.initial.targetDistanceUnit ?? null,
  );
  protected readonly targetCalories = signal<string>(
    toInputString(this.data.initial.targetCalories),
  );
  protected readonly measurementType = signal<MeasurementType>(
    this.data.initial.measurementType ?? 'None',
  );
  protected readonly perRoundMetric = signal<PerRoundMetric | null>(
    this.data.initial.perRoundMetric ?? null,
  );

  protected readonly measurementTypes = MEASUREMENT_TYPES;
  protected readonly perRoundMetrics = PER_ROUND_METRICS;
  protected readonly distanceUnits = DISTANCE_UNITS;

  protected readonly canSave = computed(() => this.name().trim().length > 0);

  protected onCancel(): void {
    this.dialogRef.close();
  }

  protected onSave(): void {
    if (!this.canSave()) return;
    const distance = parseNumber(this.targetDistance());
    const result: ExerciseConfigDialogResult = {
      userEnteredExerciseName: this.name().trim(),
      standardExerciseId: this.standardExerciseId(),
      sets: parseNumber(this.sets()),
      reps: this.reps().trim() || null,
      duration: this.duration().trim() || null,
      targetWeight: parseNumber(this.targetWeight()),
      targetDistance: distance,
      targetDistanceUnit: distance != null ? this.targetDistanceUnit() ?? 'Meters' : null,
      targetCalories: parseNumber(this.targetCalories()),
      measurementType: this.data.isIntervals ? undefined : this.measurementType(),
      perRoundMetric: this.data.isIntervals ? this.perRoundMetric() : null,
    };
    this.dialogRef.close(result);
  }
}

function toInputString(value: number | null | undefined): string {
  if (value == null) return '';
  return String(value);
}

/**
 * Coerce a signal value to a numeric `DraftExercise` field. The number-typed
 * inputs (`type="number"`) emit numbers from `(ngModelChange)` even though
 * the signal is typed `signal<string>`, so this needs to tolerate both. A
 * previous version assumed string-only and threw `TypeError: value.trim is
 * not a function` on the number path — silent JS error swallowed by the
 * dialog click handler, which made the Add button look like a no-op.
 */
function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}
