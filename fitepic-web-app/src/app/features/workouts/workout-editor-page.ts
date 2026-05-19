import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { WorkoutAuthoringService } from '../../core/workouts/workout-authoring.service';
import { WorkoutsService } from '../../core/workouts/workouts.service';
import { GymsService } from '../../core/gyms/gyms.service';
import { GymRoleService } from '../../core/gyms/gym-role.service';
import { ProfileService } from '../../core/profile/profile.service';
import { canProgramWorkouts } from '../../core/gyms/gym-role';
import { showGymError, SYNC_RESULT_MESSAGES } from '../../core/gyms/gym-error-messages';
import { getApiErrorMessage } from '../../core/api/error-code';
import { createPendingAction } from '../../core/async/pending-action';
import { WorkoutScoreType } from '../../core/api/generated/models/workout-score-type';
import { WorkoutType } from '../../core/api/generated/models/workout-type';
import {
  ConfirmActionDialog,
  ConfirmActionDialogData,
} from '../gyms/confirm-action-dialog';
import {
  ExerciseConfigDialog,
  ExerciseConfigDialogData,
  ExerciseConfigDialogResult,
} from './exercise-config-dialog';
import {
  ExercisePickerDialog,
  ExercisePickerDialogResult,
} from './exercise-picker-dialog';
import { DraftExercise } from '../../core/workouts/draft-models';

const WORKOUT_TYPES: WorkoutType[] = [
  'StraightSets',
  'AMRAP',
  'ForTime',
  'EMOM',
  'Tabata',
  'Circuit',
  'Chipper',
  'Intervals',
  'Other',
];

const SCORE_TYPES: WorkoutScoreType[] = [
  'None',
  'TimeToComplete',
  'TimeCapPlusReps',
  'TotalReps',
  'RepsPerRound',
  'HeaviestLoad',
  'TotalLoad',
  'TimeAndLoad',
  'RepsAndLoad',
  'PointsSystem',
  'RoundsAndReps',
  'Meters',
  'Calories',
  'Miles',
  'Feet',
  'TieBreakTime',
  'CustomNumeric',
];

interface GymOption {
  gymId: string | null;
  label: string;
}

@Component({
  selector: 'app-workout-editor-page',
  imports: [
    FormsModule,
    DragDropModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
  ],
  providers: [WorkoutAuthoringService],
  templateUrl: './workout-editor-page.html',
  styleUrl: './workout-editor-page.scss',
})
export class WorkoutEditorPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly authoring = inject(WorkoutAuthoringService);
  private readonly workoutsService = inject(WorkoutsService);
  private readonly gymsService = inject(GymsService);
  private readonly roleService = inject(GymRoleService);
  private readonly profileService = inject(ProfileService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  private readonly saveAction = createPendingAction<void>();
  private readonly parseAction = createPendingAction<void>();

  /**
   * When the user clicks Cancel or Save, the component is the one driving the
   * route change and has already cleared / confirmed dirty state. Setting this
   * flag prevents the `workoutEditorCanDeactivate` guard from re-prompting.
   */
  private guardBypassed = false;

  /** Read by the CanDeactivate guard. */
  hasUnsavedChanges(): boolean {
    return !this.guardBypassed && this.authoring.dirty();
  }

  protected readonly workout = this.authoring.workout;
  protected readonly analyzing = this.parseAction.pending;
  protected readonly visibleExercises = this.authoring.visibleExercises;
  protected readonly isIntervals = this.authoring.isIntervals;
  protected readonly saving = this.saveAction.pending;

  protected readonly workoutTypes = WORKOUT_TYPES;
  protected readonly scoreTypes = SCORE_TYPES;

  protected readonly editId = signal<string | null>(null);
  protected readonly editMode = computed(() => this.editId() !== null);
  protected readonly loadingExisting = signal(false);
  protected readonly editLoadError = signal<string | null>(null);
  protected readonly returnUrl = signal<string>('/');
  protected readonly gymLocked = signal(false);

  protected readonly gymOptions = computed<GymOption[]>(() => {
    const me = this.profileService.profile()?.id ?? null;
    const roles = this.roleService.roles();
    const personal: GymOption = { gymId: null, label: 'My personal library' };
    const lockedId = this.gymLocked() ? this.workout().gymId : null;
    const allowed: GymOption[] = this.gymsService
      .gyms()
      .filter((g) => !g.isDeleted && g.id)
      .filter((g) => {
        if (lockedId) return g.id === lockedId;
        const role = g.ownerAthleteId === me ? 'Owner' : (roles[g.id!] ?? null);
        return canProgramWorkouts(role);
      })
      .map((g) => ({ gymId: g.id!, label: g.name ?? 'Gym' }));
    // When the URL pre-selected a gym, only that gym is shown.
    return lockedId ? allowed : [personal, ...allowed];
  });

  protected readonly canSave = computed(
    () => !this.saving() && this.workout().name.trim().length > 0,
  );

  async ngOnInit(): Promise<void> {
    const params = this.route.snapshot.paramMap;
    const query = this.route.snapshot.queryParamMap;

    const id = params.get('id');
    this.editId.set(id);
    this.returnUrl.set(query.get('returnUrl') ?? '/');

    const gymIdParam = query.get('gymId');
    if (gymIdParam) {
      this.gymLocked.set(true);
      this.authoring.patchWorkout({
        gymId: gymIdParam,
        origin: 'Programming',
      });
    }

    // Make sure the gym picker can render even if the user hit this route
    // directly (e.g., from a deep link).
    if (this.gymsService.gyms().length === 0) {
      try {
        await this.gymsService.bootstrap();
      } catch {
        // Picker will fall back to personal-only.
      }
    }
    if (!this.profileService.profile()) {
      try {
        await this.profileService.load();
      } catch {
        // Author id will be guarded at save time.
      }
    }

    if (id) {
      this.loadingExisting.set(true);
      try {
        const existing = await this.workoutsService.getWorkout(id);
        if (!existing) {
          this.editLoadError.set('This workout is no longer available.');
        } else {
          this.authoring.loadFromResponse(existing);
          // If the URL provided a gymId, honor it; otherwise the loaded
          // workout's gymId is what we keep.
          if (gymIdParam) {
            this.authoring.patchWorkout({ gymId: gymIdParam });
          }
        }
      } catch {
        this.editLoadError.set('Could not load this workout.');
      } finally {
        this.loadingExisting.set(false);
      }
    }
  }

  protected setName(v: string): void {
    this.authoring.patchWorkout({ name: v });
  }
  protected setInstructions(v: string): void {
    this.authoring.patchWorkout({ instructions: v });
  }
  protected setWorkoutType(v: WorkoutType): void {
    this.authoring.patchWorkout({ workoutType: v });
  }
  protected setScoreType(v: WorkoutScoreType): void {
    this.authoring.patchWorkout({ scoreType: v });
  }
  protected setRoundCount(v: string): void {
    const n = Number(v);
    this.authoring.patchWorkout({ roundCount: Number.isFinite(n) && n > 0 ? n : null });
  }
  protected setDuration(v: string): void {
    this.authoring.patchWorkout({ duration: v.trim() || null });
  }
  protected setGym(gymId: string | null): void {
    this.authoring.patchWorkout({
      gymId,
      origin: gymId ? 'Programming' : 'Personal',
    });
  }

  protected async onAnalyze(): Promise<void> {
    const text = this.workout().rawText.trim();
    if (!text || this.analyzing()) return;

    const hasExercises = this.visibleExercises().some((e) => !e.isRemoved);
    if (hasExercises) {
      const proceed = await this.dialog
        .open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(ConfirmActionDialog, {
          data: {
            title: 'Reconcile the exercise list?',
            message:
              'Analyzing will update matched exercises, add new ones, and mark missing ones for removal (you can restore them). Continue?',
            confirmLabel: 'Analyze',
          },
          width: '480px',
        })
        .afterClosed()
        .toPromise();
      if (!proceed) return;
    }

    await this.parseAction.run(async () => {
      try {
        const result = await this.workoutsService.parse(text);
        const exerciseCount = result.exercises?.length ?? 0;
        if (exerciseCount === 0) {
          this.snackBar.open(
            "We couldn't find any exercises in that text. Try describing your workout differently, or build it manually.",
            'Dismiss',
            { duration: 5000 },
          );
          return;
        }
        if (hasExercises) {
          this.authoring.mergeFromParseResult(result, text);
        } else {
          this.authoring.loadFromParseResult(result, text);
        }
        this.snackBar.open(
          `Found ${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}.`,
          'Dismiss',
          { duration: 2500 },
        );
      } catch (err) {
        this.snackBar.open(
          getApiErrorMessage(err) ??
            'Could not analyze the workout. Check your connection and try again.',
          'Dismiss',
          { duration: 4000 },
        );
      }
    });
  }

  protected onMoveUp(id: string): void {
    this.authoring.moveExercise(id, 'up');
  }

  protected onMoveDown(id: string): void {
    this.authoring.moveExercise(id, 'down');
  }

  protected onDropExercise(event: CdkDragDrop<unknown>): void {
    this.authoring.reorderExercise(event.previousIndex, event.currentIndex);
  }

  protected onRemoveExercise(id: string): void {
    this.authoring.softDeleteExercise(id);
  }

  protected onRestore(id: string): void {
    this.authoring.restoreExercise(id);
  }

  protected async onAddExercise(): Promise<void> {
    const pick = await this.dialog
      .open<ExercisePickerDialog, void, ExercisePickerDialogResult | undefined>(
        ExercisePickerDialog,
        { width: '520px', autoFocus: 'first-tabbable' },
      )
      .afterClosed()
      .toPromise();
    if (!pick) return;
    await this.openExerciseConfig({
      mode: 'add',
      isIntervals: this.isIntervals(),
      initial: {
        userEnteredExerciseName: pick.userEnteredExerciseName,
        standardExerciseId: pick.standardExerciseId,
      },
    });
  }

  protected async onEditExercise(exercise: DraftExercise): Promise<void> {
    const result = await this.openExerciseConfig({
      mode: 'edit',
      isIntervals: this.isIntervals(),
      initial: exercise,
    });
    if (result) {
      this.authoring.updateExercise(exercise.id, result);
    }
  }

  private async openExerciseConfig(
    data: ExerciseConfigDialogData,
  ): Promise<ExerciseConfigDialogResult | undefined> {
    const result = await this.dialog
      .open<ExerciseConfigDialog, ExerciseConfigDialogData, ExerciseConfigDialogResult | undefined>(
        ExerciseConfigDialog,
        { data, width: '560px', autoFocus: 'first-tabbable' },
      )
      .afterClosed()
      .toPromise();
    if (data.mode === 'add' && result) {
      this.authoring.addExercise(result);
    }
    return result;
  }

  protected exerciseSummary(e: DraftExercise): string {
    const parts: string[] = [];
    if (e.sets != null && e.reps) parts.push(`${e.sets} × ${e.reps}`);
    else if (e.sets != null) parts.push(`${e.sets} sets`);
    else if (e.reps) parts.push(`${e.reps} reps`);
    if (e.targetWeight != null) parts.push(`@ ${e.targetWeight} lb`);
    if (e.duration) parts.push(e.duration);
    if (e.targetDistance != null) {
      parts.push(`${e.targetDistance} ${e.targetDistanceUnit ?? ''}`.trim());
    }
    if (e.targetCalories != null) parts.push(`${e.targetCalories} cal`);
    if (e.perRoundMetric) parts.push(`per-round: ${e.perRoundMetric}`);
    return parts.length > 0 ? parts.join(' · ') : '—';
  }

  protected async onCancel(): Promise<void> {
    if (this.authoring.dirty()) {
      const proceed = await this.dialog
        .open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(ConfirmActionDialog, {
          data: {
            title: 'Discard changes?',
            message: 'You have unsaved changes. Leave the editor anyway?',
            confirmLabel: 'Discard',
            warn: true,
          },
          width: '420px',
        })
        .afterClosed()
        .toPromise();
      if (!proceed) return;
    }
    this.guardBypassed = true;
    await this.router.navigateByUrl(this.returnUrl());
  }

  protected async onSave(): Promise<void> {
    if (!this.canSave()) return;
    const me = this.profileService.profile()?.id;
    if (!me) {
      this.snackBar.open('Could not identify your account.', 'Dismiss', { duration: 3000 });
      return;
    }
    await this.saveAction.run(async () => {
      try {
        const payload = this.authoring.toRequestPayload(me);
        const result = await this.workoutsService.syncWorkout(payload);
        if (result?.resolution === 'Forbidden') {
          this.snackBar.open(
            SYNC_RESULT_MESSAGES['Forbidden'] ?? 'You cannot save this workout here.',
            'Dismiss',
            { duration: 4000 },
          );
          return;
        }
        this.authoring.markClean();
        this.guardBypassed = true;
        this.snackBar.open(
          this.editMode() ? 'Workout updated.' : 'Workout saved.',
          'Dismiss',
          { duration: 2500 },
        );
        await this.router.navigateByUrl(this.returnUrl());
      } catch (err) {
        showGymError(
          this.snackBar,
          err,
          getApiErrorMessage(err) ?? 'Could not save the workout.',
        );
      }
    });
  }
}
