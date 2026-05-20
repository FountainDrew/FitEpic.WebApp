import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';

export interface RescheduleWorkoutDialogData {
  /** Display label for the workout being rescheduled. */
  workoutName: string;
  /** Current scheduled date as `YYYY-MM-DD`. */
  currentDate: string;
}

export interface RescheduleWorkoutDialogResult {
  /** New scheduled date as `YYYY-MM-DD`. */
  scheduledDate: string;
}

@Component({
  selector: 'app-reschedule-workout-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatDatepickerModule,
  ],
  providers: [provideNativeDateAdapter()],
  template: `
    <h2 mat-dialog-title>Reschedule workout</h2>
    <mat-dialog-content>
      <p class="dialog-note">
        Move <strong>{{ data.workoutName }}</strong> to a new date. Any athletes who already
        logged a completion keep their result attached to this workout.
      </p>
      <form class="dialog-form" (ngSubmit)="onSubmit()">
        <mat-form-field appearance="outline">
          <mat-label>New date</mat-label>
          <input
            matInput
            [matDatepicker]="datePicker"
            [ngModel]="date()"
            (ngModelChange)="date.set($event)"
            name="date"
            required
            readonly
          />
          <mat-datepicker-toggle matIconSuffix [for]="datePicker"></mat-datepicker-toggle>
          <mat-datepicker #datePicker></mat-datepicker>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="onCancel()">Cancel</button>
      <button
        mat-flat-button
        color="primary"
        type="button"
        [disabled]="!canSubmit()"
        (click)="onSubmit()"
      >
        Reschedule
      </button>
    </mat-dialog-actions>
  `,
})
export class RescheduleWorkoutDialog {
  private readonly dialogRef =
    inject(MatDialogRef<RescheduleWorkoutDialog, RescheduleWorkoutDialogResult>);
  protected readonly data = inject<RescheduleWorkoutDialogData>(MAT_DIALOG_DATA);

  protected readonly date = signal<Date | null>(parseIsoDate(this.data.currentDate));

  protected readonly canSubmit = computed(() => {
    const d = this.date();
    if (!d) return false;
    return toIsoDate(d) !== this.data.currentDate;
  });

  protected onCancel(): void {
    this.dialogRef.close();
  }

  protected onSubmit(): void {
    if (!this.canSubmit()) return;
    this.dialogRef.close({ scheduledDate: toIsoDate(this.date()!) });
  }
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
