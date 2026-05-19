import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';

import { GymsService } from '../../../core/gyms/gyms.service';
import { GymRoleService } from '../../../core/gyms/gym-role.service';
import { ProfileService } from '../../../core/profile/profile.service';
import { canProgramWorkouts } from '../../../core/gyms/gym-role';
import { showGymError, SYNC_RESULT_MESSAGES } from '../../../core/gyms/gym-error-messages';
import { WorkoutResponse } from '../../../core/api/generated/models/workout-response';
import { WorkoutRequest } from '../../../core/api/generated/models/workout-request';
import {
  ConfirmActionDialog,
  ConfirmActionDialogData,
} from '../confirm-action-dialog';

@Component({
  selector: 'app-workouts-tab',
  imports: [
    FormsModule,
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatCheckboxModule,
  ],
  templateUrl: './workouts-tab.html',
  styleUrl: './workouts-tab.scss',
})
export class WorkoutsTab implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly gymsService = inject(GymsService);
  private readonly roleService = inject(GymRoleService);
  private readonly profileService = inject(ProfileService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly gymId = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly workouts = signal<WorkoutResponse[]>([]);
  protected readonly includeArchived = signal(false);

  protected readonly role = computed(() => this.roleService.forGym(this.gymId()));
  protected readonly canAuthor = computed(() => canProgramWorkouts(this.role()));

  protected readonly displayedColumns = ['name', 'type', 'updated', 'status', 'actions'];

  protected readonly rows = computed(() =>
    this.workouts().filter((w) => !w.isDeleted),
  );

  async ngOnInit(): Promise<void> {
    this.gymId.set(this.route.parent?.snapshot.paramMap.get('gymId') ?? null);
    await this.load();
  }

  protected async onToggleArchived(value: boolean): Promise<void> {
    this.includeArchived.set(value);
    await this.load();
  }

  protected async openCreate(): Promise<void> {
    const id = this.gymId();
    if (!id) return;
    await this.router.navigate(['/workouts/new'], {
      queryParams: { gymId: id, returnUrl: `/gyms/${id}/workouts` },
    });
  }

  protected async openEdit(row: WorkoutResponse): Promise<void> {
    const id = this.gymId();
    if (!id || !row.id) return;
    await this.router.navigate(['/workouts', row.id, 'edit'], {
      queryParams: { gymId: id, returnUrl: `/gyms/${id}/workouts` },
    });
  }

  protected async toggleArchive(row: WorkoutResponse): Promise<void> {
    if (!row.id) return;
    const target = !row.isArchived;
    try {
      const payload = this.toRequestPayload(row);
      payload.isArchived = target;
      const r = await this.gymsService.syncWorkout(payload);
      if (r?.resolution === 'Forbidden') {
        this.snackBar.open('You cannot archive this workout.', 'Dismiss', { duration: 4000 });
        return;
      }
      this.snackBar.open(
        target ? 'Workout archived.' : 'Workout restored.',
        'Dismiss',
        { duration: 2500 },
      );
      await this.load();
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not update the workout.');
    }
  }

  protected async deleteWorkout(row: WorkoutResponse): Promise<void> {
    if (!row.id) return;
    const confirmed = await this.dialog
      .open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(ConfirmActionDialog, {
        data: {
          title: 'Delete this workout?',
          message:
            'Upcoming scheduled instances will be removed. If any athletes have completed a session, the delete will be blocked — archive instead.',
          confirmLabel: 'Delete',
          warn: true,
        },
        width: '520px',
      })
      .afterClosed()
      .toPromise();
    if (!confirmed) return;
    const payload = this.toRequestPayload(row);
    payload.isDeleted = true;
    try {
      const r = await this.gymsService.syncWorkout(payload);
      if (r?.resolution === 'BlockedByHistory') {
        const archive = await this.dialog
          .open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(ConfirmActionDialog, {
            data: {
              title: 'Delete blocked',
              message:
                'This workout has completed scheduled instances and can\'t be deleted. Archive it instead so history stays resolvable?',
              confirmLabel: 'Archive instead',
            },
            width: '520px',
          })
          .afterClosed()
          .toPromise();
        if (archive) await this.toggleArchive({ ...row, isArchived: false });
        return;
      }
      if (r?.resolution === 'Forbidden') {
        this.snackBar.open('You cannot delete this workout.', 'Dismiss', { duration: 4000 });
        return;
      }
      this.snackBar.open('Workout deleted.', 'Dismiss', { duration: 2500 });
      await this.load();
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not delete the workout.');
    }
  }

  protected formatUpdated(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString();
  }

  private async load(): Promise<void> {
    const id = this.gymId();
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      this.workouts.set(
        await this.gymsService.listGymWorkouts(id, {
          includeArchived: this.includeArchived(),
        }),
      );
    } catch {
      this.error.set('Could not load gym workouts.');
      this.workouts.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /** Build a `WorkoutRequest` payload from an existing response for mutation. */
  private toRequestPayload(row: WorkoutResponse): WorkoutRequest {
    return {
      id: row.id ?? crypto.randomUUID(),
      athleteId: row.athleteId ?? this.profileService.profile()?.id ?? '',
      gymId: row.gymId ?? null,
      name: row.name ?? null,
      workoutType: row.workoutType ?? 'Other',
      origin: row.origin ?? 'Programming',
      instructions: row.instructions ?? null,
      rawText: row.rawText ?? null,
      duration: row.duration ?? null,
      roundCount: row.roundCount ?? null,
      scoreLabel: row.scoreLabel ?? null,
      scoreType: row.scoreType,
      exercises: (row.exercises ?? []).map((e) => ({
        id: e.id ?? crypto.randomUUID(),
        workoutId: row.id ?? '',
        userEnteredExerciseName: e.userEnteredExerciseName ?? '',
        reps: e.reps ?? null,
        sets: e.sets ?? null,
        duration: e.duration ?? null,
        targetDistance: e.targetDistance ?? null,
        targetDistanceUnit: e.targetDistanceUnit,
        targetWeight: e.targetWeight ?? null,
        targetCalories: e.targetCalories ?? null,
        orderIndex: e.orderIndex ?? 0,
        perRoundMetric: e.perRoundMetric,
        measurementType: e.measurementType,
        standardExerciseId: e.standardExerciseId ?? null,
        isDeleted: e.isDeleted ?? false,
        updatedAt: e.updatedAt,
      })),
      isArchived: row.isArchived ?? false,
      isDeleted: row.isDeleted ?? false,
      updatedAt: new Date().toISOString(),
    };
  }
}
