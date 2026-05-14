import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';

import { ApiConfiguration } from '../../../core/api/generated/api-configuration';
import { apiWebappDashboardsStreakActivityV1Get } from '../../../core/api/generated/fn/web-app-dashboards/api-webapp-dashboards-streak-activity-v-1-get';
import { StreakActivityResponse } from '../../../core/api/generated/models/streak-activity-response';
import { getWebAppErrorCode } from '../../../core/api/error-code';
import { ProfileService } from '../../../core/profile/profile.service';
import { buildStreakRows, overflowCount } from './snake-layout';

@Component({
  selector: 'app-streak-activity',
  imports: [MatButtonModule, MatCardModule],
  templateUrl: './streak-activity.html',
  styleUrl: './streak-activity.scss',
})
export class StreakActivity implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);
  private readonly profileService = inject(ProfileService);
  private readonly router = inject(Router);

  protected readonly data = signal<StreakActivityResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly hasAnyContent = computed(() => {
    const d = this.data();
    if (!d) return false;
    return (
      (d.currentStreak ?? 0) > 0 ||
      (d.daysActive ?? 0) > 0 ||
      (d.recentDays?.length ?? 0) > 0
    );
  });

  protected readonly showStreakPill = computed(
    () => !!this.data()?.isActiveStreak && (this.data()?.currentStreak ?? 0) >= 2,
  );

  protected readonly showDaysPill = computed(() => (this.data()?.daysActive ?? 0) > 0);

  protected readonly currentStreak = computed(() => this.data()?.currentStreak ?? 0);
  protected readonly daysActive = computed(() => this.data()?.daysActive ?? 0);
  protected readonly daysInWindow = computed(() => this.data()?.daysInWindow ?? 0);
  protected readonly daysWord = computed(() => (this.daysInWindow() === 1 ? 'day' : 'days'));

  protected readonly streakRows = computed(() => buildStreakRows(this.data()?.recentDays));
  protected readonly showDotLine = computed(() => this.streakRows().length > 0);
  protected readonly overflowDays = computed(() => overflowCount(this.data()?.recentDays?.length ?? 0));
  protected readonly overflowWord = computed(() => (this.overflowDays() === 1 ? 'day' : 'days'));

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async reload(): Promise<void> {
    await this.load();
  }

  protected async retry(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(
        apiWebappDashboardsStreakActivityV1Get(this.http, this.config.rootUrl),
      );
      this.data.set(res.body);
    } catch (err) {
      if (await this.handleTimezoneRequired(err)) {
        await this.load();
        return;
      }
      this.error.set('Could not load streak activity.');
    } finally {
      this.loading.set(false);
    }
  }

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
}
