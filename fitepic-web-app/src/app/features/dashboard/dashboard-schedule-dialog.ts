import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';

/**
 * Small "start" dialog that opens from the dashboard's "Schedule workout"
 * button. The user picks a date and then decides whether to author a fresh
 * workout (which leads them into the workout editor with auto-schedule
 * wired) or pick from their existing library (which leads to a slideout the
 * dashboard opens separately).
 *
 * Critically: this dialog loads no data on open — it's instant. The library
 * fetch is deferred to the slideout step, with a skeleton while it loads,
 * and {@link WorkoutsService.listPersonalWorkouts} is cached so repeated
 * picker opens are snappy.
 */
export type DashboardScheduleDialogResult =
  | { mode: 'create'; scheduledDate: string }
  | { mode: 'pick'; scheduledDate: string };

@Component({
  selector: 'app-dashboard-schedule-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
  ],
  providers: [provideNativeDateAdapter()],
  template: `
    <h2 mat-dialog-title>Schedule a workout</h2>
    <mat-dialog-content>
      <form class="dialog-form">
        <mat-form-field appearance="outline">
          <mat-label>Date</mat-label>
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

        <div class="option-row">
          <button
            mat-stroked-button
            type="button"
            class="option-button"
            [disabled]="!canSubmit()"
            (click)="onCreate()"
          >
            <mat-icon>add</mat-icon>
            Create a workout
          </button>
          <button
            mat-stroked-button
            type="button"
            class="option-button"
            [disabled]="!canSubmit()"
            (click)="onPick()"
          >
            <mat-icon>library_books</mat-icon>
            Pick from your library
          </button>
        </div>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="onCancel()">Cancel</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .option-row {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 4px;
      }
      .option-button {
        justify-content: flex-start;
        width: 100%;
        padding: 16px;
        height: auto;
      }
    `,
  ],
})
export class DashboardScheduleDialog {
  private readonly dialogRef =
    inject(MatDialogRef<DashboardScheduleDialog, DashboardScheduleDialogResult>);

  protected readonly date = signal<Date | null>(new Date());
  protected readonly canSubmit = computed(() => !!this.date());

  protected onCreate(): void {
    if (!this.canSubmit()) return;
    this.dialogRef.close({ mode: 'create', scheduledDate: toIsoDate(this.date()!) });
  }

  protected onPick(): void {
    if (!this.canSubmit()) return;
    this.dialogRef.close({ mode: 'pick', scheduledDate: toIsoDate(this.date()!) });
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
