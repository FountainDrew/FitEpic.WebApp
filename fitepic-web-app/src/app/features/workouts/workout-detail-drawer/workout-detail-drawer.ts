import { Component, HostListener, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { createPendingAction } from '../../../core/async/pending-action';
import { showGymError } from '../../../core/gyms/gym-error-messages';
import { formatExerciseSummary } from '../../../core/workouts/exercise-summary';
import { formatDurationFromIso } from '../../../core/workouts/format-duration';
import { getScoreTypeDisplay } from '../../../core/workouts/score-display';
import { WorkoutsService } from '../../../core/workouts/workouts.service';
import { DeleteWorkoutDialog, DeleteWorkoutDialogData } from '../delete-workout-dialog';
import { WorkoutDetailDrawerService } from './workout-detail-drawer.service';

/**
 * Right-side slideout showing the full details of a workout *template* —
 * type, duration, how it's scored, instructions, raw text, and the complete
 * prescribed exercise list. Opened from the workout library page.
 *
 * Shares its chrome with the dashboard's scheduled-workout drawer via
 * `shared/workout-drawer/_workout-drawer.scss`, but deliberately renders no
 * status badge, score value or exercise logs: a library workout has not been
 * scheduled or performed, so it has no per-athlete state to show.
 */
@Component({
  selector: 'app-workout-detail-drawer',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './workout-detail-drawer.html',
  styleUrl: './workout-detail-drawer.scss',
})
export class WorkoutDetailDrawer {
  protected readonly service = inject(WorkoutDetailDrawerService);
  private readonly workoutsService = inject(WorkoutsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  private readonly action = createPendingAction<void>();
  protected readonly actionPending = this.action.pending;

  /** `WorkoutType · N exercises`, with empty segments dropped. */
  protected readonly metaLine = computed(() => {
    const w = this.service.workout();
    if (!w) return '';
    const segments: string[] = [];
    if (w.workoutType) segments.push(w.workoutType);
    if (w.roundCount != null && w.roundCount > 0) {
      segments.push(w.roundCount === 1 ? '1 round' : `${w.roundCount} rounds`);
    }
    const count = this.visibleExercises().length;
    if (count > 0) segments.push(count === 1 ? '1 exercise' : `${count} exercises`);
    return segments.join(' · ');
  });

  protected readonly durationDisplay = computed(() =>
    formatDurationFromIso(this.service.workout()?.duration),
  );

  /**
   * How the workout is scored, e.g. `Time to Complete`. `scoreLabel` is the
   * author's own wording when they set one and wins over the enum's label.
   */
  protected readonly scoreTypeDisplay = computed(() => {
    const w = this.service.workout();
    if (!w) return '';
    if (w.scoreLabel?.trim()) return w.scoreLabel.trim();
    if (!w.scoreType || w.scoreType === 'None') return '';
    return getScoreTypeDisplay(w.scoreType);
  });

  /** Prescribed exercises, tombstones removed, in authoring order. */
  protected readonly visibleExercises = computed(() =>
    (this.service.workout()?.exercises ?? [])
      .filter((e) => !e.isDeleted)
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
  );

  protected readonly hasRawText = computed(() => Boolean(this.service.workout()?.rawText?.trim()));
  protected readonly hasInstructions = computed(() =>
    Boolean(this.service.workout()?.instructions?.trim()),
  );
  protected readonly hasExercises = computed(() => this.visibleExercises().length > 0);

  protected readonly exerciseSummary = formatExerciseSummary;

  /**
   * Whether this is the caller's own personal workout, which gates both Edit
   * and Delete. The library only ever holds such workouts, so this is true in
   * practice — the guard is here so the drawer stays correct if it is ever
   * reused to show a gym-owned template, which belongs to the gym's library
   * rather than the athlete's and is edited and deleted from the gym surface.
   *
   * It also mirrors the delete endpoint's own scope: `DELETE
   * /api/webapp/workouts/{id}/v1` rejects gym-scoped workouts with a 404, so
   * offering the button for one would only produce a confusing failure.
   */
  protected readonly isOwnPersonalWorkout = computed(() => {
    const w = this.service.workout();
    return Boolean(w?.id) && !w?.gymId && w?.isOwner !== false;
  });

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.service.isOpen()) this.service.close();
  }

  protected close(): void {
    this.service.close();
  }

  /**
   * Open this workout in the editor, returning to the library on save or
   * cancel. Only offered for workouts the caller owns — gym-owned templates
   * belong to the gym's library and are edited from the gym's workouts tab.
   */
  protected async editWorkout(): Promise<void> {
    const w = this.service.workout();
    if (!w?.id) return;
    this.service.close();
    await this.router.navigate(['/workouts', w.id, 'edit'], {
      queryParams: { returnUrl: '/workouts/library' },
    });
  }

  /**
   * Delete this workout and everything referencing it.
   *
   * Two steps by design: the dialog fetches a deletion preview and shows the
   * athlete exactly what the cascade will remove — completed history and rows
   * on other athletes' calendars especially — and only then do we call the
   * delete. There is no undelete endpoint, so the confirmation is the only
   * safety net.
   *
   * The preview is advisory; the delete recomputes the cascade and returns the
   * authoritative counts, which is what the snackbar reports.
   */
  protected async deleteWorkout(): Promise<void> {
    const w = this.service.workout();
    if (!w?.id) return;

    const confirmed = await this.dialog
      .open<DeleteWorkoutDialog, DeleteWorkoutDialogData, boolean>(DeleteWorkoutDialog, {
        data: { workoutId: w.id, workoutName: w.name ?? '' },
        width: '480px',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .toPromise();
    if (!confirmed) return;

    await this.action.run(async () => {
      try {
        const result = await this.workoutsService.deleteWorkout(w.id!);
        this.snackBar.open(this.deletedMessage(w.name, result.deleted), 'Dismiss', {
          duration: 3500,
        });
        this.service.close();
        this.service.notifyActionCompleted();
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not delete this workout.');
      }
    });
  }

  /**
   * Snackbar copy naming what actually came off the calendar. Reports the
   * scheduled-instance count only — the athlete cares that their schedule
   * changed, not how many reaction rows were tombstoned behind it.
   */
  private deletedMessage(
    name: string | null | undefined,
    deleted: { scheduledWorkouts?: number } | null | undefined,
  ): string {
    const label = name?.trim() ? `"${name.trim()}"` : 'Workout';
    const instances = deleted?.scheduledWorkouts ?? 0;
    if (instances === 0) return `${label} deleted.`;
    const noun = instances === 1 ? 'scheduled instance' : 'scheduled instances';
    return `${label} deleted, along with ${instances} ${noun}.`;
  }
}
