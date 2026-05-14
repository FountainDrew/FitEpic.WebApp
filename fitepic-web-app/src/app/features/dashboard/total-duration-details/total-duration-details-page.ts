import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { ProfileService } from '../../../core/profile/profile.service';
import { ApiConfiguration } from '../../../core/api/generated/api-configuration';
import { apiWebappDashboardsWeeklyStatsDurationBreakdownV1Get } from '../../../core/api/generated/fn/web-app-dashboards/api-webapp-dashboards-weekly-stats-duration-breakdown-v-1-get';
import { WeeklyStatsDurationBreakdownResponse } from '../../../core/api/generated/models/weekly-stats-duration-breakdown-response';
import { WeeklyStatsDurationBreakdownItemResponse } from '../../../core/api/generated/models/weekly-stats-duration-breakdown-item-response';
import { getWebAppErrorCode } from '../../../core/api/error-code';

interface DateGroup {
  date: string;
  items: WeeklyStatsDurationBreakdownItemResponse[];
}

@Component({
  selector: 'app-total-duration-details-page',
  imports: [
    DatePipe,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './total-duration-details-page.html',
  styleUrl: './total-duration-details-page.scss',
})
export class TotalDurationDetailsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);
  private readonly profileService = inject(ProfileService);
  private readonly router = inject(Router);

  protected readonly data = signal<WeeklyStatsDurationBreakdownResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly groups = computed<DateGroup[]>(() => {
    const items = this.data()?.items ?? [];
    const map = new Map<string, WeeklyStatsDurationBreakdownItemResponse[]>();
    for (const item of items) {
      const key = item.scheduledDate ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
  });

  protected readonly isEmpty = computed(() => (this.data()?.workoutCount ?? 0) === 0);

  async ngOnInit(): Promise<void> {
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
        apiWebappDashboardsWeeklyStatsDurationBreakdownV1Get(this.http, this.config.rootUrl),
      );
      this.data.set(res.body);
    } catch (err) {
      if (await this.handleTimezoneRequired(err)) {
        await this.load();
        return;
      }
      this.error.set('Could not load the workout-time breakdown. Please try again.');
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
      queryParams: { reason: 'timezone-required', returnUrl: '/dashboard/weekly-stats/duration' },
    });
    return false;
  }

  protected formatTotal(minutes: number | undefined): string {
    const total = Math.max(0, Math.round(minutes ?? 0));
    if (total === 0) return '0 minutes';
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    const hoursLabel = hours === 1 ? 'hour' : 'hours';
    const minsLabel = mins === 1 ? 'minute' : 'minutes';
    if (hours === 0) return `${mins} ${minsLabel}`;
    if (mins === 0) return `${hours} ${hoursLabel}`;
    return `${hours} ${hoursLabel} and ${mins} ${minsLabel}`;
  }

  protected formatItemDuration(minutes: number | undefined): string {
    const total = Math.max(0, Math.round(minutes ?? 0));
    if (total === 0) return '0m';
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  }
}
