import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

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
import { WorkoutCard } from './workout-card/workout-card';
import { WorkoutDrawer } from './workout-drawer/workout-drawer';

interface FutureGroup {
  date: string;
  cards: DashboardWorkoutCardResponse[];
}

@Component({
  selector: 'app-dashboard-page',
  imports: [
    DatePipe,
    DecimalPipe,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    QuoteCard,
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
