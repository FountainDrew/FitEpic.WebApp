import { Component, HostListener, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { WorkoutsService } from '../../../core/workouts/workouts.service';
import { showGymError, SYNC_RESULT_MESSAGES } from '../../../core/gyms/gym-error-messages';
import { createPendingAction } from '../../../core/async/pending-action';
import { WorkoutExerciseResponse } from '../../../core/api/generated/models/workout-exercise-response';
import {
  ConfirmActionDialog,
  ConfirmActionDialogData,
} from '../confirm-action-dialog';
import {
  RescheduleWorkoutDialog,
  RescheduleWorkoutDialogData,
  RescheduleWorkoutDialogResult,
} from '../reschedule-workout-dialog';
import { GymScheduleDrawerService } from './gym-schedule-drawer.service';

/**
 * Coach-facing details + actions drawer for a gym-scheduled workout. Mirrors
 * the dashboard's `WorkoutDrawer` (athlete view) but exposes the actions a
 * coach has on a group row: edit the underlying workout template, reschedule
 * the row, unschedule it. No "delete logs" action — per-athlete log clearing
 * lives in the athlete's own drawer.
 */
@Component({
  selector: 'app-gym-schedule-drawer',
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './gym-schedule-drawer.html',
  styleUrl: './gym-schedule-drawer.scss',
})
export class GymScheduleDrawer {
  protected readonly service = inject(GymScheduleDrawerService);
  private readonly workoutsService = inject(WorkoutsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  private readonly action = createPendingAction<void>();
  protected readonly actionPending = this.action.pending;

  protected readonly metaLine = computed(() => {
    const row = this.service.row();
    if (!row) return '';
    const w = row.workout;
    const segments: string[] = [];
    if (w?.workoutType) segments.push(w.workoutType);
    const count = (w?.exercises ?? []).filter((e) => !e.isDeleted).length;
    if (count > 0) segments.push(count === 1 ? '1 exercise' : `${count} exercises`);
    return segments.join(' · ');
  });

  protected readonly hasRawText = computed(() =>
    Boolean(this.service.row()?.workout?.rawText?.trim()),
  );

  protected readonly visibleExercises = computed(() =>
    (this.service.row()?.workout?.exercises ?? [])
      .filter((e) => !e.isDeleted)
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
  );

  protected readonly hasExercises = computed(() => this.visibleExercises().length > 0);

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.service.isOpen()) this.service.close();
  }

  protected close(): void {
    this.service.close();
  }

  protected exerciseSummary(e: WorkoutExerciseResponse): string {
    const parts: string[] = [];
    if (e.sets != null && e.reps) parts.push(`${e.sets}×${e.reps}`);
    else if (e.reps) parts.push(e.reps);
    else if (e.sets != null) parts.push(`${e.sets} sets`);
    if (e.targetWeight != null) parts.push(`@${e.targetWeight}lb`);
    if (e.duration) parts.push(e.duration);
    return parts.join(' · ');
  }

  protected async editWorkout(): Promise<void> {
    const row = this.service.row();
    const workoutId = row?.workout?.id ?? row?.scheduled.workoutId;
    const gymId = row?.workout?.gymId;
    if (!workoutId || !gymId) return;
    this.service.close();
    await this.router.navigate(['/workouts', workoutId, 'edit'], {
      queryParams: {
        gymId,
        returnUrl: `/gyms/${gymId}/schedule`,
      },
    });
  }

  protected async reschedule(): Promise<void> {
    const row = this.service.row();
    if (!row) return;
    const r = row.scheduled;
    if (!r.id || !r.workoutId || !r.scheduledDate) return;
    const result = await this.dialog
      .open<
        RescheduleWorkoutDialog,
        RescheduleWorkoutDialogData,
        RescheduleWorkoutDialogResult | undefined
      >(RescheduleWorkoutDialog, {
        data: { workoutName: row.workoutName, currentDate: r.scheduledDate },
        width: '420px',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .toPromise();
    if (!result) return;
    await this.action.run(async () => {
      try {
        const sync = await this.workoutsService.syncScheduledWorkout({
          id: r.id!,
          workoutId: r.workoutId!,
          trainingGroupId: r.trainingGroupId ?? null,
          athleteId: r.athleteId ?? null,
          scheduledDate: result.scheduledDate,
          status: r.status,
          exerciseLogs: [],
          updatedAt: new Date().toISOString(),
        });
        if (sync?.resolution === 'Forbidden') {
          this.snackBar.open(
            SYNC_RESULT_MESSAGES['Forbidden'] ?? 'You cannot reschedule this workout.',
            'Dismiss',
            { duration: 4000 },
          );
          return;
        }
        this.snackBar.open('Workout rescheduled.', 'Dismiss', { duration: 2500 });
        this.service.close();
        this.service.notifyActionCompleted();
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not reschedule the workout.');
      }
    });
  }

  protected async unschedule(): Promise<void> {
    const row = this.service.row();
    if (!row) return;
    const r = row.scheduled;
    if (!r.id || !r.workoutId) return;
    const dateLabel = r.scheduledDate ?? 'this date';
    const confirmed = await this.dialog
      .open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(ConfirmActionDialog, {
        data: {
          title: 'Unschedule this workout?',
          message: `Remove "${row.workoutName}" from the schedule for ${dateLabel}? Any athletes who already completed it keep it in their personal history.`,
          confirmLabel: 'Unschedule',
          warn: true,
        },
        width: '480px',
      })
      .afterClosed()
      .toPromise();
    if (!confirmed) return;
    await this.action.run(async () => {
      try {
        const sync = await this.workoutsService.syncScheduledWorkout({
          id: r.id!,
          workoutId: r.workoutId!,
          trainingGroupId: r.trainingGroupId ?? null,
          athleteId: r.athleteId ?? null,
          scheduledDate: r.scheduledDate ?? '',
          status: r.status,
          exerciseLogs: [],
          isDeleted: true,
          updatedAt: new Date().toISOString(),
        });
        if (sync?.resolution === 'Forbidden') {
          this.snackBar.open(
            SYNC_RESULT_MESSAGES['Forbidden'] ?? 'You cannot unschedule this workout.',
            'Dismiss',
            { duration: 4000 },
          );
          return;
        }
        this.snackBar.open('Workout unscheduled.', 'Dismiss', { duration: 2500 });
        this.service.close();
        this.service.notifyActionCompleted();
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not unschedule the workout.');
      }
    });
  }
}
