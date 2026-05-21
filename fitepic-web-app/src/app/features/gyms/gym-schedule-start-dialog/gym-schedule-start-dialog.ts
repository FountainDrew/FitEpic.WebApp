import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';

import { TrainingGroupResponse } from '../../../core/api/generated/models/training-group-response';

export interface GymScheduleStartDialogData {
  /** Live, non-deleted training groups in the gym. Pre-loaded by the caller so
   * the dialog opens instantly. */
  groups: TrainingGroupResponse[];
  /**
   * Pre-selected groups. Typically the caller passes the schedule tab's
   * current multi-group selection so the dialog opens with the same set ticked.
   */
  initialGroupIds?: string[];
  /** Pre-selected date when launched from a calendar cell. ISO `YYYY-MM-DD`. */
  initialDate?: string;
}

export type GymScheduleStartDialogResult =
  | { mode: 'create'; trainingGroupIds: string[]; scheduledDate: string }
  | { mode: 'pick'; trainingGroupIds: string[]; scheduledDate: string };

/**
 * Gym-side equivalent of `DashboardScheduleDialog`: a small "start" dialog
 * that collects the schedule parameters (date + one or more training groups)
 * and asks the coach whether to author a new workout or pick from the gym
 * library. Loads no data on open — the caller (`ScheduleTab`) passes the
 * pre-fetched group list via `data`.
 *
 * Follow-up data fetches happen after this dialog closes:
 *   - `mode: 'create'` → navigate to the workout editor with the schedule
 *     params on the query string.
 *   - `mode: 'pick'` → open the gym workout library slideout.
 */
@Component({
  selector: 'app-gym-schedule-start-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
  ],
  providers: [provideNativeDateAdapter()],
  template: `
    <h2 mat-dialog-title>Schedule a workout</h2>
    <mat-dialog-content>
      @if (!hasGroups()) {
        <p class="dialog-note">
          No training groups yet — create one before scheduling workouts.
        </p>
      } @else {
        <form class="dialog-form">
          <mat-form-field appearance="outline">
            <mat-label>Training groups</mat-label>
            <mat-select
              multiple
              [ngModel]="groupIds()"
              (ngModelChange)="groupIds.set($event)"
              name="groupIds"
              required
            >
              @for (g of data.groups; track g.id) {
                <mat-option [value]="g.id">{{ g.name }}</mat-option>
              }
            </mat-select>
            <mat-hint>
              @if (multipleGroupsSelected()) {
                One scheduled workout will be created per group.
              } @else {
                Pick one or more groups to schedule.
              }
            </mat-hint>
          </mat-form-field>

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
              Pick from gym library
            </button>
          </div>
        </form>
      }
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
      .dialog-note {
        margin: 0;
        opacity: 0.8;
      }
    `,
  ],
})
export class GymScheduleStartDialog {
  private readonly dialogRef =
    inject(MatDialogRef<GymScheduleStartDialog, GymScheduleStartDialogResult>);
  protected readonly data = inject<GymScheduleStartDialogData>(MAT_DIALOG_DATA);

  protected readonly date = signal<Date | null>(parseInitialDate(this.data.initialDate));
  protected readonly groupIds = signal<string[]>(initialGroupIds(this.data));

  protected readonly hasGroups = computed(() => this.data.groups.length > 0);
  protected readonly multipleGroupsSelected = computed(() => this.groupIds().length > 1);

  protected readonly canSubmit = computed(
    () => this.groupIds().length > 0 && !!this.date(),
  );

  protected onCreate(): void {
    if (!this.canSubmit()) return;
    this.dialogRef.close({
      mode: 'create',
      trainingGroupIds: this.groupIds(),
      scheduledDate: toIsoDate(this.date()!),
    });
  }

  protected onPick(): void {
    if (!this.canSubmit()) return;
    this.dialogRef.close({
      mode: 'pick',
      trainingGroupIds: this.groupIds(),
      scheduledDate: toIsoDate(this.date()!),
    });
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}

function initialGroupIds(data: GymScheduleStartDialogData): string[] {
  if (data.initialGroupIds && data.initialGroupIds.length > 0) {
    return [...data.initialGroupIds];
  }
  if (data.groups.length === 1 && data.groups[0].id) return [data.groups[0].id];
  return [];
}

/** Parse `YYYY-MM-DD` into a local-time Date (avoids UTC drift). */
function parseInitialDate(iso: string | undefined): Date {
  if (!iso) return new Date();
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

/** Format a Date as `YYYY-MM-DD` using local time so the calendar day matches. */
function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
