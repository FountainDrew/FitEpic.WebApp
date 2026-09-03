import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { WorkoutDeletionPreviewResponse } from '../../core/api/generated/models/workout-deletion-preview-response';
import { WorkoutsService } from '../../core/workouts/workouts.service';
import { getApiError } from '../../core/api/error-code';

export interface DeleteWorkoutDialogData {
  workoutId: string;
  workoutName: string;
}

/** One "N thing(s)" row in the cascade breakdown. */
interface CascadeLine {
  label: string;
  count: number;
}

/**
 * Confirmation for deleting a personal workout.
 *
 * Fetches the deletion preview itself rather than being handed one, so the
 * dialog opens instantly on click and shows a skeleton while the counts load —
 * the alternative leaves the user staring at an unresponsive drawer button.
 * Confirm stays disabled until the preview resolves, so nobody can confirm a
 * cascade they haven't been shown.
 *
 * Closes with `true` only when the user confirms; the caller performs the
 * delete. Preview counts are advisory — the server recomputes the cascade —
 * so they're framed as what will be removed, not as a guarantee.
 */
@Component({
  selector: 'app-delete-workout-dialog',
  imports: [DatePipe, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './delete-workout-dialog.html',
  styleUrl: './delete-workout-dialog.scss',
})
export class DeleteWorkoutDialog implements OnInit {
  protected readonly dialogRef = inject(MatDialogRef<DeleteWorkoutDialog, boolean>);
  protected readonly data = inject<DeleteWorkoutDialogData>(MAT_DIALOG_DATA);
  private readonly workoutsService = inject(WorkoutsService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly preview = signal<WorkoutDeletionPreviewResponse | null>(null);

  /**
   * The cascade, as display rows. Zero counts are dropped — listing
   * "0 comments" is noise that buries the lines that matter. The workout's own
   * exercises are omitted too: they aren't a separate consequence, they're
   * part of the workout the user is already deleting.
   */
  protected readonly cascadeLines = computed<CascadeLine[]>(() => {
    const p = this.preview();
    if (!p) return [];
    const lines: CascadeLine[] = [
      { label: 'scheduled instance', count: p.scheduledInstanceCount ?? 0 },
      { label: 'logged exercise entry', count: p.exerciseLogCount ?? 0 },
      { label: 'group result', count: p.groupResultCount ?? 0 },
      { label: 'reaction', count: p.reactionCount ?? 0 },
      { label: 'comment', count: p.commentCount ?? 0 },
    ];
    return lines.filter((l) => l.count > 0);
  });

  /** Nothing references this workout — deleting it affects only itself. */
  protected readonly isIsolated = computed(
    () => this.preview() !== null && this.cascadeLines().length === 0,
  );

  /**
   * Completed history the athlete permanently loses. Called out separately
   * from the cascade list because personal workouts have no completed-history
   * gate — unlike gym-scoped ones, nothing stops this delete, so the warning
   * is the only thing standing between the athlete and losing the record.
   */
  protected readonly completedCount = computed(() => this.preview()?.completedInstanceCount ?? 0);

  /**
   * Instances this delete removes from someone else's calendar — non-zero
   * when the athlete programmed their own workout for a client. Worth its own
   * warning because the consequence lands on a person who isn't in the room.
   */
  protected readonly otherAthleteCount = computed(
    () => this.preview()?.instancesOnOtherAthletesCalendars ?? 0,
  );

  /** Both ends of the affected schedule range, when any instances exist. */
  protected readonly dateRange = computed(() => {
    const p = this.preview();
    if (!p?.earliestScheduledDate || !p?.latestScheduledDate) return null;
    return { from: p.earliestScheduledDate, to: p.latestScheduledDate };
  });

  /**
   * Dialog title. Named workouts are quoted so the name is unambiguous;
   * unnamed ones fall back to bare prose rather than rendering
   * `Delete "this workout"?`. The preview echoes the name back, so prefer it
   * once loaded — it's authoritative if the workout was renamed elsewhere.
   */
  protected readonly dialogTitle = computed(() => {
    const name = (this.preview()?.workoutName ?? this.data.workoutName)?.trim();
    return name ? `Delete "${name}"?` : 'Delete this workout?';
  });

  async ngOnInit(): Promise<void> {
    try {
      this.preview.set(await this.workoutsService.previewWorkoutDeletion(this.data.workoutId));
    } catch (err) {
      const { code } = getApiError(err);
      this.error.set(
        code === 'NOT_FOUND'
          ? 'This workout is no longer available. It may already have been deleted.'
          : 'Could not check what deleting this workout would remove. Try again.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected plural(count: number, label: string): string {
    return `${count} ${label}${count === 1 ? '' : 's'}`;
  }

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}
