import { Component, HostListener, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { DashboardWorkoutLogResponse } from '../../../core/api/generated/models/dashboard-workout-log-response';
import { WorkoutsService } from '../../../core/workouts/workouts.service';
import { showGymError, SYNC_RESULT_MESSAGES } from '../../../core/gyms/gym-error-messages';
import { createPendingAction } from '../../../core/async/pending-action';
import {
  ConfirmActionDialog,
  ConfirmActionDialogData,
} from '../../gyms/confirm-action-dialog';
import {
  RescheduleWorkoutDialog,
  RescheduleWorkoutDialogData,
  RescheduleWorkoutDialogResult,
} from '../../gyms/reschedule-workout-dialog';
import { WorkoutDrawerService } from './workout-drawer.service';

@Component({
  selector: 'app-workout-drawer',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './workout-drawer.html',
  styleUrl: './workout-drawer.scss',
})
export class WorkoutDrawer {
  protected readonly service = inject(WorkoutDrawerService);
  private readonly workoutsService = inject(WorkoutsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  private readonly action = createPendingAction<void>();
  protected readonly actionPending = this.action.pending;

  protected readonly metaLine = computed(() => {
    const c = this.service.workout();
    if (!c) return '';
    const segments: string[] = [];
    if (c.workoutType) segments.push(c.workoutType);
    const count = c.exerciseCount ?? 0;
    if (count > 0) segments.push(count === 1 ? '1 exercise' : `${count} exercises`);
    return segments.join(' · ');
  });

  protected readonly durationDisplay = computed(() =>
    this.formatDuration(this.service.workout()?.durationMinutes),
  );

  protected readonly hasExercises = computed(() => (this.service.workout()?.exercises?.length ?? 0) > 0);
  protected readonly hasRawText = computed(() => Boolean(this.service.workout()?.rawText?.trim()));
  protected readonly isCompleted = computed(() => this.service.workout()?.status === 'Completed');

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.service.isOpen()) this.service.close();
  }

  protected close(): void {
    this.service.close();
  }

  /**
   * Clear the caller's completion state for the scheduled workout while
   * keeping the row on the schedule. Server semantics: post `Status = Pending`
   * with cleared score/notes/duration/exercise-logs. For group workouts the
   * server dispatches this into the per-athlete result row; the template
   * stays untouched.
   */
  protected async deleteLogs(): Promise<void> {
    const w = this.service.workout();
    if (!w?.id || !w.scheduledDate) return;
    const confirmed = await this.confirm({
      title: 'Delete this workout’s logs?',
      message: 'Removes your completion and any logged scores or notes. The workout stays on your schedule and you can complete it again.',
      confirmLabel: 'Delete logs',
      warn: true,
    });
    if (!confirmed) return;
    await this.action.run(async () => {
      const row = await this.workoutsService.findScheduledWorkout(w.id!, w.scheduledDate!);
      if (!row?.id || !row.workoutId) {
        this.snackBar.open('Could not find this workout. Refresh and try again.', 'Dismiss', {
          duration: 4000,
        });
        return;
      }
      try {
        const sync = await this.workoutsService.syncScheduledWorkout({
          id: row.id,
          workoutId: row.workoutId,
          trainingGroupId: row.trainingGroupId ?? null,
          athleteId: row.athleteId ?? null,
          scheduledDate: row.scheduledDate ?? w.scheduledDate!,
          // Preserve the template fields from the server row — sync is
          // last-write-wins on the whole row, so omitting these would wipe
          // the prescription's scoreType / programmer / createdAt.
          scoreType: row.scoreType,
          programmedByAthleteId: row.programmedByAthleteId ?? null,
          status: 'Pending',
          scoreResult: null,
          notes: null,
          duration: null,
          exerciseLogs: [],
          createdAt: row.createdAt,
          updatedAt: new Date().toISOString(),
        });
        if (sync?.resolution === 'Forbidden') {
          this.snackBar.open(
            SYNC_RESULT_MESSAGES['Forbidden'] ?? 'You cannot edit this workout.',
            'Dismiss',
            { duration: 4000 },
          );
          return;
        }
        this.snackBar.open('Logs deleted.', 'Dismiss', { duration: 2500 });
        this.service.close();
        this.service.notifyActionCompleted();
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not delete the logs.');
      }
    });
  }

  /**
   * Remove the scheduled workout from the user's calendar. For a completed
   * workout this also drops the per-athlete logs (no separate confirm — the
   * dialog copy below names the consequence). For group rows, athletes get
   * `Forbidden` from the server and a snackbar; for personal rows the row is
   * soft-deleted.
   */
  protected async unschedule(): Promise<void> {
    const w = this.service.workout();
    if (!w?.id || !w.scheduledDate) return;
    const isCompleted = w.status === 'Completed';
    const confirmed = await this.confirm({
      title: 'Unschedule this workout?',
      message: isCompleted
        ? 'Removes this workout from your schedule and deletes any logs you saved. Completed history attached to it goes away too.'
        : 'Removes this workout from your schedule.',
      confirmLabel: 'Unschedule',
      warn: true,
    });
    if (!confirmed) return;
    await this.action.run(async () => {
      const row = await this.workoutsService.findScheduledWorkout(w.id!, w.scheduledDate!);
      if (!row?.id || !row.workoutId) {
        this.snackBar.open('Could not find this workout. Refresh and try again.', 'Dismiss', {
          duration: 4000,
        });
        return;
      }
      try {
        const sync = await this.workoutsService.syncScheduledWorkout({
          id: row.id,
          workoutId: row.workoutId,
          trainingGroupId: row.trainingGroupId ?? null,
          athleteId: row.athleteId ?? null,
          scheduledDate: row.scheduledDate ?? w.scheduledDate!,
          // Preserve template fields from the server row (last-write-wins).
          scoreType: row.scoreType,
          programmedByAthleteId: row.programmedByAthleteId ?? null,
          status: row.status,
          exerciseLogs: [],
          isDeleted: true,
          createdAt: row.createdAt,
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

  /**
   * Move the scheduled workout to a new date. Reuses the gym Schedule tab's
   * RescheduleWorkoutDialog (date-only picker) so behavior is consistent.
   * Group rows are server-side gated: athletes get `Forbidden`.
   */
  protected async reschedule(): Promise<void> {
    const w = this.service.workout();
    if (!w?.id || !w.scheduledDate) return;
    const result = await this.dialog
      .open<
        RescheduleWorkoutDialog,
        RescheduleWorkoutDialogData,
        RescheduleWorkoutDialogResult | undefined
      >(RescheduleWorkoutDialog, {
        data: { workoutName: w.name ?? 'this workout', currentDate: w.scheduledDate },
        width: '420px',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .toPromise();
    if (!result) return;
    await this.action.run(async () => {
      const row = await this.workoutsService.findScheduledWorkout(w.id!, w.scheduledDate!);
      if (!row?.id || !row.workoutId) {
        this.snackBar.open('Could not find this workout. Refresh and try again.', 'Dismiss', {
          duration: 4000,
        });
        return;
      }
      try {
        const sync = await this.workoutsService.syncScheduledWorkout({
          id: row.id,
          workoutId: row.workoutId,
          trainingGroupId: row.trainingGroupId ?? null,
          athleteId: row.athleteId ?? null,
          scheduledDate: result.scheduledDate,
          // Preserve template fields from the server row (last-write-wins).
          scoreType: row.scoreType,
          programmedByAthleteId: row.programmedByAthleteId ?? null,
          status: row.status,
          exerciseLogs: [],
          createdAt: row.createdAt,
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

  protected setLabel(log: DashboardWorkoutLogResponse): string {
    const set = log.setNumber;
    const round = log.roundNumber;
    if (round != null && set != null) return `Round ${round} · Set ${set}`;
    if (set != null) return `Set ${set}`;
    if (round != null) return `Round ${round}`;
    return '';
  }

  private async confirm(data: ConfirmActionDialogData): Promise<boolean> {
    const ref = this.dialog.open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(
      ConfirmActionDialog,
      { data, width: '480px' },
    );
    return (await ref.afterClosed().toPromise()) ?? false;
  }

  private formatDuration(minutes: number | null | undefined): string {
    const total = Math.max(0, Math.round(minutes ?? 0));
    if (total === 0) return '';
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  }
}
