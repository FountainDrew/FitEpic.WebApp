import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ProfileService } from '../../../core/profile/profile.service';
import { ApiConfiguration } from '../../../core/api/generated/api-configuration';
import { apiWebappDashboardsMonthlyStatsV1Get } from '../../../core/api/generated/fn/web-app-dashboards/api-webapp-dashboards-monthly-stats-v-1-get';
import { MonthlyStatsResponse } from '../../../core/api/generated/models/monthly-stats-response';
import { MonthlyStatsPeriodResponse } from '../../../core/api/generated/models/monthly-stats-period-response';
import { getWebAppErrorCode } from '../../../core/api/error-code';

type DeltaDirection = 'up' | 'down' | 'same' | 'none';

interface CardConfig {
  title: string;
  primaryValue: string;
  hasComparison: boolean;
  currentShortLabel: string;
  previousShortLabel: string;
  currentValueLabel: string;
  previousValueLabel: string;
  currentProgress: number;
  previousProgress: number;
  deltaText: string;
  deltaDirection: DeltaDirection;
  hasPacedComparison: boolean;
  pacedDeltaText: string;
  pacedDeltaDirection: DeltaDirection;
  pacedComparisonLabel: string;
  ariaSummary: string;
}

const BAR_MIN_PROGRESS = 0.04;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_SHORT_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

@Component({
  selector: 'app-monthly-stats-page',
  imports: [
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './monthly-stats-page.html',
  styleUrl: './monthly-stats-page.scss',
})
export class MonthlyStatsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);
  private readonly profileService = inject(ProfileService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly data = signal<MonthlyStatsResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly errorIsFatal = signal(false);

  protected readonly monthLabel = computed(() => {
    const d = this.data();
    if (!d || !d.year || !d.month) return '';
    return `${MONTH_NAMES[d.month - 1]} ${d.year}`;
  });

  protected readonly previousMonthLabel = computed(() => {
    const p = this.data()?.previous;
    if (!p || !p.year || !p.month) return '';
    return `${MONTH_NAMES[p.month - 1]} ${p.year}`;
  });

  protected readonly hasPreviousComparison = computed(() => !!this.data()?.previous);

  protected readonly hasNextMonth = computed(() => this.data()?.hasNextMonth ?? false);

  protected readonly showEmptyMonthNote = computed(() => {
    const d = this.data();
    if (!d?.current) return false;
    const current = d.current;
    const hasWorkouts = (current.workoutsScheduled ?? 0) > 0;
    const hasPrev = !!d.previous;
    return !hasWorkouts && !hasPrev;
  });

  protected readonly cards = computed<CardConfig[]>(() => {
    const d = this.data();
    if (!d?.current) return [];
    const current = d.current;
    const previous = d.previous ?? null;
    const paced = d.previousAtSameDay ?? null;
    const currentShort = current.month ? MONTH_SHORT_NAMES[current.month - 1] : '';
    const previousShort = previous?.month ? MONTH_SHORT_NAMES[previous.month - 1] : '';

    return [
      this.buildCard({
        title: 'Workouts Completed',
        currentVal: current.workoutsCompleted ?? 0,
        previousVal: previous?.workoutsCompleted ?? null,
        pacedVal: paced?.workoutsCompleted ?? null,
        primaryValue: `${current.workoutsCompleted ?? 0}`,
        formatVal: (v) => `${v}`,
        currentShort,
        previousShort,
        pacedDaysLabel: paced?.daysElapsed ?? null,
      }),
      this.buildCard({
        title: 'Days Worked Out',
        currentVal: current.daysWorkedOut ?? 0,
        previousVal: previous?.daysWorkedOut ?? null,
        pacedVal: paced?.daysWorkedOut ?? null,
        primaryValue: `${current.daysWorkedOut ?? 0} / ${current.daysInMonth ?? 0}`,
        formatVal: (v) => `${v}`,
        currentShort,
        previousShort,
        pacedDaysLabel: paced?.daysElapsed ?? null,
      }),
      this.buildDurationCard(current, previous, paced, currentShort, previousShort),
      this.buildCard({
        title: 'Weight Lifted',
        currentVal: current.totalWeightLiftedLbs ?? 0,
        previousVal: previous?.totalWeightLiftedLbs ?? null,
        pacedVal: paced?.totalWeightLiftedLbs ?? null,
        primaryValue: `${this.formatThousands(current.totalWeightLiftedLbs ?? 0)} lbs`,
        formatVal: (v) => `${this.formatThousands(v)} lbs`,
        currentShort,
        previousShort,
        pacedDaysLabel: paced?.daysElapsed ?? null,
        deltaFormatter: (delta) => `${delta >= 0 ? '+' : '−'}${this.formatThousands(Math.abs(delta))} lbs`,
      }),
      this.buildCard({
        title: 'Exercises',
        currentVal: current.exercisesPerformed ?? 0,
        previousVal: previous?.exercisesPerformed ?? null,
        pacedVal: paced?.exercisesPerformed ?? null,
        primaryValue: `${current.exercisesPerformed ?? 0}`,
        formatVal: (v) => `${v}`,
        currentShort,
        previousShort,
        pacedDaysLabel: paced?.daysElapsed ?? null,
      }),
    ];
  });

  async ngOnInit(): Promise<void> {
    this.route.queryParamMap.subscribe((params) => {
      const year = this.parseIntParam(params.get('year'));
      const month = this.parseIntParam(params.get('month'));
      this.load(year, month);
    });
  }

  protected async goPrev(): Promise<void> {
    const d = this.data();
    if (!d?.current?.year || !d.current.month) return;
    const { year, month } = this.shiftMonth(d.current.year, d.current.month, -1);
    await this.navigateTo(year, month);
  }

  protected async goNext(): Promise<void> {
    if (!this.hasNextMonth()) return;
    const d = this.data();
    if (!d?.current?.year || !d.current.month) return;
    const { year, month } = this.shiftMonth(d.current.year, d.current.month, 1);
    await this.navigateTo(year, month);
  }

  protected async retry(): Promise<void> {
    const d = this.data();
    await this.load(d?.year ?? undefined, d?.month ?? undefined);
  }

  private async navigateTo(year: number, month: number): Promise<void> {
    await this.router.navigate(['/dashboard/monthly-stats'], {
      queryParams: { year, month },
    });
  }

  private async load(year?: number, month?: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.errorIsFatal.set(false);
    try {
      const res = await firstValueFrom(
        apiWebappDashboardsMonthlyStatsV1Get(this.http, this.config.rootUrl, { year, month }),
      );
      this.data.set(res.body);
    } catch (err) {
      if (await this.handleTimezoneRequired(err, year, month)) {
        return;
      }
      const code = getWebAppErrorCode(err);
      if (code === 'MONTH_OUT_OF_RANGE') {
        this.error.set('That month is out of range. Pick a different month to continue.');
        this.errorIsFatal.set(true);
      } else {
        this.error.set('Could not load monthly stats. Please try again.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  private async handleTimezoneRequired(
    err: unknown,
    year: number | undefined,
    month: number | undefined,
  ): Promise<boolean> {
    if (getWebAppErrorCode(err) !== 'PROFILE_TIMEZONE_REQUIRED') return false;
    try {
      const profile = await this.profileService.ensureTimezone();
      if (profile.timezone) {
        await this.load(year, month);
        return true;
      }
    } catch {
      // fall through to routing
    }
    await this.router.navigate(['/settings'], {
      queryParams: { reason: 'timezone-required', returnUrl: '/dashboard/monthly-stats' },
    });
    return true;
  }

  private shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
    const zeroBased = (month - 1) + delta;
    const newYear = year + Math.floor(zeroBased / 12);
    const newMonth = ((zeroBased % 12) + 12) % 12 + 1;
    return { year: newYear, month: newMonth };
  }

  private parseIntParam(raw: string | null): number | undefined {
    if (raw == null) return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private buildCard(opts: {
    title: string;
    currentVal: number;
    previousVal: number | null;
    pacedVal: number | null;
    primaryValue: string;
    formatVal: (v: number) => string;
    currentShort: string;
    previousShort: string;
    pacedDaysLabel: number | null;
    deltaFormatter?: (delta: number) => string;
  }): CardConfig {
    const { currentVal, previousVal, pacedVal, currentShort, previousShort, pacedDaysLabel } = opts;
    const hasComparison = previousVal !== null && (currentVal > 0 || previousVal > 0);
    const max = Math.max(currentVal, previousVal ?? 0);
    const currentProgress = hasComparison ? this.scaleBar(currentVal, max) : 0;
    const previousProgress = hasComparison ? this.scaleBar(previousVal ?? 0, max) : 0;
    const formatDelta = opts.deltaFormatter ?? ((d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d)}`);

    let deltaText = '';
    let deltaDirection: DeltaDirection = 'none';
    if (previousVal !== null) {
      const delta = currentVal - previousVal;
      deltaText = delta === 0 ? 'No change' : formatDelta(delta);
      deltaDirection = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
    }

    let pacedDeltaText = '';
    let pacedDeltaDirection: DeltaDirection = 'none';
    let hasPacedComparison = false;
    let pacedComparisonLabel = '';
    if (pacedVal !== null && pacedDaysLabel) {
      hasPacedComparison = true;
      const pacedDelta = currentVal - pacedVal;
      pacedDeltaText = pacedDelta === 0 ? 'No change' : formatDelta(pacedDelta);
      pacedDeltaDirection = pacedDelta > 0 ? 'up' : pacedDelta < 0 ? 'down' : 'same';
      const dayWord = pacedDaysLabel === 1 ? 'day' : 'days';
      pacedComparisonLabel = `compared to last month after ${pacedDaysLabel} ${dayWord}`;
    }

    const ariaSummary = hasComparison
      ? `${opts.title} comparison: ${currentShort} ${opts.formatVal(currentVal)}, ${previousShort} ${opts.formatVal(previousVal ?? 0)}`
      : `${opts.title}: ${opts.formatVal(currentVal)}`;

    return {
      title: opts.title,
      primaryValue: opts.primaryValue,
      hasComparison,
      currentShortLabel: currentShort,
      previousShortLabel: previousShort,
      currentValueLabel: opts.formatVal(currentVal),
      previousValueLabel: previousVal !== null ? opts.formatVal(previousVal) : '',
      currentProgress,
      previousProgress,
      deltaText,
      deltaDirection,
      hasPacedComparison,
      pacedDeltaText,
      pacedDeltaDirection,
      pacedComparisonLabel,
      ariaSummary,
    };
  }

  private buildDurationCard(
    current: MonthlyStatsPeriodResponse,
    previous: MonthlyStatsPeriodResponse | null,
    paced: MonthlyStatsPeriodResponse | null,
    currentShort: string,
    previousShort: string,
  ): CardConfig {
    const currentVal = current.totalDurationMinutes ?? 0;
    const previousVal = previous ? previous.totalDurationMinutes ?? 0 : null;
    const pacedVal = paced ? paced.totalDurationMinutes ?? 0 : null;
    const showDash = currentVal === 0 && (previousVal ?? 0) === 0;
    const formatVal = (v: number) => this.formatDuration(v);
    const formatDelta = (delta: number) => `${delta >= 0 ? '+' : '−'}${this.formatDuration(Math.abs(delta))}`;
    return this.buildCard({
      title: 'Total Workout Time',
      currentVal,
      previousVal,
      pacedVal,
      primaryValue: showDash ? '—' : this.formatDuration(currentVal),
      formatVal,
      currentShort,
      previousShort,
      pacedDaysLabel: paced?.daysElapsed ?? null,
      deltaFormatter: formatDelta,
    });
  }

  private scaleBar(value: number, max: number): number {
    if (max <= 0) return 0;
    const ratio = value / max;
    if (value > 0 && ratio < BAR_MIN_PROGRESS) return BAR_MIN_PROGRESS;
    return Math.max(0, Math.min(1, ratio));
  }

  private formatDuration(minutes: number): string {
    const total = Math.max(0, Math.round(minutes));
    if (total === 0) return '0m';
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  }

  private formatThousands(value: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
  }
}
