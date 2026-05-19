import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';

import { GymsService } from '../../core/gyms/gyms.service';
import { TrainingGroupResponse } from '../../core/api/generated/models/training-group-response';
import { WorkoutResponse } from '../../core/api/generated/models/workout-response';

export interface ScheduleWorkoutDialogData {
  gymId: string;
  /** Pre-selected group when launched from a specific group row. */
  initialGroupId?: string;
  /** Pre-selected date when launched from a calendar cell. ISO `YYYY-MM-DD`. */
  initialDate?: string;
}

/**
 * Result of the schedule dialog. Two flavors:
 *  - `existing` — user picked a workout already in the gym library; the caller
 *    should sync one `scheduledWorkout` per group in `trainingGroupIds`.
 *  - `create` — user wants to author a new workout. The caller should navigate
 *    to the workout editor with these params; the editor will auto-schedule
 *    the saved workout against every `trainingGroupIds` entry on `scheduledDate`.
 */
export type ScheduleWorkoutDialogResult =
  | {
      mode: 'existing';
      trainingGroupIds: string[];
      workoutId: string;
      scheduledDate: string;
    }
  | {
      mode: 'create';
      trainingGroupIds: string[];
      scheduledDate: string;
    };

type Mode = 'existing' | 'create';

@Component({
  selector: 'app-schedule-workout-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatRadioModule,
    MatButtonModule,
    MatDatepickerModule,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './schedule-workout-dialog.html',
  styleUrl: './schedule-workout-dialog.scss',
})
export class ScheduleWorkoutDialog implements OnInit {
  private readonly dialogRef =
    inject(MatDialogRef<ScheduleWorkoutDialog, ScheduleWorkoutDialogResult>);
  private readonly gymsService = inject(GymsService);
  protected readonly data = inject<ScheduleWorkoutDialogData>(MAT_DIALOG_DATA);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly groups = signal<TrainingGroupResponse[]>([]);
  protected readonly workouts = signal<WorkoutResponse[]>([]);

  protected readonly groupIds = signal<string[]>([]);
  protected readonly workoutId = signal<string | null>(null);
  protected readonly date = signal<Date | null>(parseInitialDate(this.data.initialDate));
  protected readonly mode = signal<Mode>('existing');

  protected readonly libraryEmpty = computed(() => this.workouts().length === 0);
  protected readonly hasGroups = computed(() => this.groups().length > 0);
  protected readonly multipleGroupsSelected = computed(() => this.groupIds().length > 1);

  protected readonly canSubmit = computed(() => {
    if (this.groupIds().length === 0 || !this.date()) return false;
    if (this.mode() === 'existing') return !!this.workoutId();
    return true;
  });

  protected readonly submitLabel = computed(() => {
    if (this.mode() !== 'existing') return 'Continue';
    return this.multipleGroupsSelected() ? `Schedule (${this.groupIds().length})` : 'Schedule';
  });

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      const [groups, workouts] = await Promise.all([
        this.gymsService.listGroups(this.data.gymId),
        this.gymsService.listGymWorkouts(this.data.gymId),
      ]);
      this.groups.set(groups.filter((g) => !g.isDeleted));
      this.workouts.set(workouts.filter((w) => !w.isDeleted && !w.isArchived));

      // Default the mode to whichever branch is available. If the library is
      // empty the "existing" radio is disabled, so start the user on "create".
      this.mode.set(this.libraryEmpty() ? 'create' : 'existing');

      if (this.data.initialGroupId) {
        this.groupIds.set([this.data.initialGroupId]);
      } else if (this.groups().length === 1 && this.groups()[0].id) {
        this.groupIds.set([this.groups()[0].id!]);
      }
    } catch {
      this.error.set('Could not load groups or workouts. Try again.');
    } finally {
      this.loading.set(false);
    }
  }

  protected onModeChange(mode: Mode): void {
    this.mode.set(mode);
    if (mode === 'create') {
      this.workoutId.set(null);
    }
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }

  protected onSubmit(): void {
    if (!this.canSubmit()) return;
    const ids = this.groupIds();
    const dateIso = toIsoDate(this.date()!);
    if (this.mode() === 'existing') {
      this.dialogRef.close({
        mode: 'existing',
        trainingGroupIds: ids,
        workoutId: this.workoutId()!,
        scheduledDate: dateIso,
      });
    } else {
      this.dialogRef.close({
        mode: 'create',
        trainingGroupIds: ids,
        scheduledDate: dateIso,
      });
    }
  }
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
