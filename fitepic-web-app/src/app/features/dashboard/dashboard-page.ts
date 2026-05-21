import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';

import { AuthService } from '../../core/auth/auth.service';
import { ProfileService } from '../../core/profile/profile.service';
import { ApiConfiguration } from '../../core/api/generated/api-configuration';
import { apiWebappDashboardsWeeklyStatsV1Get } from '../../core/api/generated/fn/web-app-dashboards/api-webapp-dashboards-weekly-stats-v-1-get';
import { apiWebappDashboardsWorkoutsV1Get } from '../../core/api/generated/fn/web-app-dashboards/api-webapp-dashboards-workouts-v-1-get';
import { WeeklyStatsResponse } from '../../core/api/generated/models/weekly-stats-response';
import { DashboardWorkoutCardResponse } from '../../core/api/generated/models/dashboard-workout-card-response';
import { DashboardWorkoutsResponse } from '../../core/api/generated/models/dashboard-workouts-response';
import { getWebAppErrorCode } from '../../core/api/error-code';

import { QuoteCard } from './quote-card/quote-card';
import { StreakActivity } from './streak-activity/streak-activity';
import { WorkoutCard } from './workout-card/workout-card';
import { WorkoutDrawer } from './workout-drawer/workout-drawer';
import { WorkoutDrawerService } from './workout-drawer/workout-drawer.service';
import { InfoDialog, InfoDialogData } from './info-dialog/info-dialog';
import {
  DashboardScheduleDialog,
  DashboardScheduleDialogResult,
} from './dashboard-schedule-dialog';
import {
  WorkoutLibraryDrawer,
  WorkoutLibraryDrawerData,
} from './workout-library-drawer/workout-library-drawer';
import { WorkoutsService } from '../../core/workouts/workouts.service';
import { WorkoutResponse } from '../../core/api/generated/models/workout-response';
import { showGymError, SYNC_RESULT_MESSAGES } from '../../core/gyms/gym-error-messages';
import { MatSnackBar } from '@angular/material/snack-bar';

interface FutureGroup {
  date: string;
  cards: DashboardWorkoutCardResponse[];
}

@Component({
  selector: 'app-dashboard-page',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    QuoteCard,
    StreakActivity,
    WorkoutCard,
    WorkoutDrawer,
  ],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);
  private readonly profileService = inject(ProfileService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly workoutsService = inject(WorkoutsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly workoutDrawerService = inject(WorkoutDrawerService);

  constructor() {
    // Reload the workout cards whenever the drawer reports a successful
    // mutating action (delete logs / unschedule / reschedule). The Subject
    // is subscribed via takeUntilDestroyed so we don't need manual cleanup.
    this.workoutDrawerService.actionCompleted
      .pipe(takeUntilDestroyed())
      .subscribe(() => void this.loadWorkouts());
  }

  protected readonly user = inject(AuthService).currentUser;

  protected readonly stats = signal<WeeklyStatsResponse | null>(null);
  protected readonly statsLoading = signal(true);
  protected readonly statsError = signal<string | null>(null);

  protected readonly workouts = signal<DashboardWorkoutsResponse | null>(null);
  protected readonly workoutsLoading = signal(true);
  protected readonly workoutsError = signal<string | null>(null);

  protected readonly futureGroups = computed<FutureGroup[]>(() => {
    const items = this.workouts()?.future ?? [];
    const map = new Map<string, DashboardWorkoutCardResponse[]>();
    for (const item of items) {
      const key = item.scheduledDate ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).map(([date, cards]) => ({ date, cards }));
  });

  async ngOnInit(): Promise<void> {
    await Promise.allSettled([this.loadStats(), this.loadWorkouts()]);
  }

  protected async retryStats(): Promise<void> {
    await this.loadStats();
  }

  protected async retryWorkouts(): Promise<void> {
    await this.loadWorkouts();
  }

  private async loadStats(): Promise<void> {
    this.statsLoading.set(true);
    this.statsError.set(null);
    try {
      const res = await firstValueFrom(
        apiWebappDashboardsWeeklyStatsV1Get(this.http, this.config.rootUrl),
      );
      this.stats.set(res.body);
    } catch (err) {
      if (await this.handleTimezoneRequired(err)) {
        await this.loadStats();
        return;
      }
      this.statsError.set('Could not load weekly stats. Please try again.');
    } finally {
      this.statsLoading.set(false);
    }
  }

  private async loadWorkouts(): Promise<void> {
    this.workoutsLoading.set(true);
    this.workoutsError.set(null);
    try {
      const res = await firstValueFrom(
        apiWebappDashboardsWorkoutsV1Get(this.http, this.config.rootUrl),
      );
      this.workouts.set(res.body);
    } catch (err) {
      if (await this.handleTimezoneRequired(err)) {
        await this.loadWorkouts();
        return;
      }
      this.workoutsError.set('Could not load workouts. Please try again.');
    } finally {
      this.workoutsLoading.set(false);
    }
  }

  /**
   * If the error is PROFILE_TIMEZONE_REQUIRED, attempt to auto-set from the
   * browser. Returns true when recovery succeeded and the caller should retry.
   * Returns false (and routes the user to /settings) when recovery failed.
   */
  private async handleTimezoneRequired(err: unknown): Promise<boolean> {
    if (getWebAppErrorCode(err) !== 'PROFILE_TIMEZONE_REQUIRED') return false;
    try {
      const profile = await this.profileService.ensureTimezone();
      if (profile.timezone) return true;
    } catch {
      // fall through to routing
    }
    await this.router.navigate(['/settings'], {
      queryParams: { reason: 'timezone-required', returnUrl: '/' },
    });
    return false;
  }

  protected progressDots(): boolean[] {
    const s = this.stats()?.stats;
    if (!s) return [];
    const total = s.workoutsScheduled ?? 0;
    const done = s.workoutsCompleted ?? 0;
    return Array.from({ length: total }, (_, i) => i < done);
  }

  protected openWeightLiftedInfo(): void {
    this.openInfoDialog({
      title: 'Weight lifted this week',
      body:
        "Total volume lifted across every set you've logged this week, calculated as " +
        'weight × reps for each set. Sets without a logged weight are not counted.',
    });
  }

  protected openExercisesInfo(): void {
    this.openInfoDialog({
      title: 'Exercises this week',
      body:
        'The total number of exercises across every workout you’ve completed this week. ' +
        'If a workout has 5 exercises and you complete it twice, that counts as 10.',
    });
  }

  protected openTotalDurationDetails(): void {
    this.router.navigate(['/dashboard/weekly-stats/duration']);
  }

  /**
   * Open the personal-schedule flow. Two-step:
   *  1. Small start dialog (instant — no data fetch) collects the date and
   *     asks whether to create a new workout or pick from the library.
   *  2a. **Create** → navigate to the workout editor with `scheduleDate` set;
   *      editor handles auto-schedule on save.
   *  2b. **Pick** → open a right-side slideout that loads the personal
   *      library and renders each row as a card; selecting one syncs a
   *      personal scheduled-workout row.
   */
  protected async openSchedule(): Promise<void> {
    const result = await this.dialog
      .open<DashboardScheduleDialog, void, DashboardScheduleDialogResult | undefined>(
        DashboardScheduleDialog,
        { width: '420px', autoFocus: 'first-tabbable' },
      )
      .afterClosed()
      .toPromise();
    if (!result) return;

    if (result.mode === 'create') {
      await this.router.navigate(['/workouts/new'], {
        queryParams: { scheduleDate: result.scheduledDate, returnUrl: '/' },
      });
      return;
    }

    // Pick branch: open the library slideout. The selected workout (if any)
    // is then synced as a personal scheduled-workout for the chosen date.
    const picked = await this.dialog
      .open<WorkoutLibraryDrawer, WorkoutLibraryDrawerData, WorkoutResponse | undefined>(
        WorkoutLibraryDrawer,
        {
          data: { scheduledDate: result.scheduledDate },
          panelClass: ['fe-dialog', 'fe-slideout'],
          position: { right: '0', top: '0' },
          autoFocus: 'first-tabbable',
        },
      )
      .afterClosed()
      .toPromise();
    if (!picked?.id) return;

    const me = this.profileService.profile()?.id;
    if (!me) {
      this.snackBar.open('Could not identify your account.', 'Dismiss', { duration: 3000 });
      return;
    }
    try {
      const sync = await this.workoutsService.syncScheduledWorkout({
        id: crypto.randomUUID(),
        workoutId: picked.id,
        trainingGroupId: null,
        athleteId: me,
        scheduledDate: result.scheduledDate,
        // ScoreType is a prescription field; the server doesn't infer it
        // from the workout template. Forgetting it would persist `None`.
        scoreType: picked.scoreType,
        status: 'Pending',
        exerciseLogs: [],
        updatedAt: new Date().toISOString(),
      });
      if (sync?.resolution === 'Forbidden') {
        this.snackBar.open(
          SYNC_RESULT_MESSAGES['Forbidden'] ?? 'You cannot schedule this workout.',
          'Dismiss',
          { duration: 4000 },
        );
        return;
      }
      this.snackBar.open('Workout scheduled.', 'Dismiss', { duration: 2500 });
      await this.loadWorkouts();
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not schedule the workout.');
    }
  }

  private openInfoDialog(data: InfoDialogData): void {
    this.dialog.open(InfoDialog, {
      data,
      autoFocus: 'dialog',
      restoreFocus: true,
      panelClass: 'fe-info-dialog',
      width: 'min(400px, calc(100vw - 32px))',
    });
  }

  protected formatDuration(minutes: number | undefined): string {
    const total = Math.max(0, Math.round(minutes ?? 0));
    if (total === 0) return '0 min';
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  }
}
