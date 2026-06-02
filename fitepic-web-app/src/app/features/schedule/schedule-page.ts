import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { CalendarDayResponse } from '../../core/api/generated/models/calendar-day-response';
import { CalendarScheduleResponse } from '../../core/api/generated/models/calendar-schedule-response';
import { DashboardWorkoutCardResponse } from '../../core/api/generated/models/dashboard-workout-card-response';
import { ScheduleListResponse } from '../../core/api/generated/models/schedule-list-response';
import { getWebAppErrorCode } from '../../core/api/error-code';
import { ProfileService } from '../../core/profile/profile.service';

import { WorkoutCard } from '../dashboard/workout-card/workout-card';
import { WorkoutDrawer } from '../dashboard/workout-drawer/workout-drawer';
import { WorkoutDrawerService } from '../dashboard/workout-drawer/workout-drawer.service';
import {
  DashboardScheduleDialog,
  DashboardScheduleDialogData,
  DashboardScheduleDialogResult,
} from '../dashboard/dashboard-schedule-dialog';
import {
  WorkoutLibraryDrawer,
  WorkoutLibraryDrawerData,
} from '../dashboard/workout-library-drawer/workout-library-drawer';
import { WorkoutResponse } from '../../core/api/generated/models/workout-response';
import { WorkoutsService } from '../../core/workouts/workouts.service';
import { showGymError, SYNC_RESULT_MESSAGES } from '../../core/gyms/gym-error-messages';

import { ScheduleService } from './schedule.service';

type ViewMode = 'calendar' | 'list';

interface FutureGroup {
  date: string;
  cards: DashboardWorkoutCardResponse[];
}

const MONTH_LABELS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

const DOW_HEADERS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

@Component({
  selector: 'app-schedule-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatTooltipModule, WorkoutCard, WorkoutDrawer],
  templateUrl: './schedule-page.html',
  styleUrl: './schedule-page.scss',
})
export class SchedulePage implements AfterViewInit, OnDestroy {
  private readonly schedule = inject(ScheduleService);
  private readonly profileService = inject(ProfileService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly workoutsService = inject(WorkoutsService);
  private readonly workoutDrawerService = inject(WorkoutDrawerService);

  // ── View state ────────────────────────────────────────────────────────────

  /** Default to calendar view on every page entry (per requirements §4.1). */
  protected readonly viewMode = signal<ViewMode>('calendar');
  protected readonly isCalendar = computed(() => this.viewMode() === 'calendar');
  protected readonly isList = computed(() => this.viewMode() === 'list');

  /** Day-of-week header labels (`SU`..`SA`). */
  protected readonly dowHeaders = DOW_HEADERS;

  // ── Calendar state ────────────────────────────────────────────────────────

  private readonly today0 = new Date();
  protected readonly displayedYear = signal(this.today0.getFullYear());
  protected readonly displayedMonth = signal(this.today0.getMonth() + 1); // 1..12

  /** ISO `YYYY-MM-DD`. The day whose workouts populate the pane under the grid. */
  protected readonly selectedDate = signal<string | null>(null);

  protected readonly calendar = signal<CalendarScheduleResponse | null>(null);
  protected readonly calendarLoading = signal(true);
  protected readonly calendarError = signal<string | null>(null);

  /** Token incremented per dispatch so late responses for an older month can be discarded. */
  private calendarReqToken = 0;

  protected readonly displayedMonthLabel = computed(
    () => `${MONTH_LABELS[this.displayedMonth() - 1]} ${this.displayedYear()}`,
  );

  protected readonly calendarDays = computed<CalendarDayResponse[]>(
    () => this.calendar()?.days ?? [],
  );

  protected readonly selectedDateWorkouts = computed<DashboardWorkoutCardResponse[]>(() => {
    const c = this.calendar();
    const date = this.selectedDate();
    if (!c || !date) return [];
    const filtered = (c.workouts ?? []).filter((w) => w.scheduledDate === date);
    return sortPendingFirst(filtered);
  });

  protected readonly hasSelectedDateWorkouts = computed(
    () => this.selectedDateWorkouts().length > 0,
  );

  /** Formatted heading for the selected-date pane, e.g. `Friday, May 29`. */
  protected readonly selectedDateLabel = computed(() => {
    const date = this.selectedDate();
    if (!date) return '';
    return formatLongDate(date);
  });

  // ── List state ────────────────────────────────────────────────────────────

  protected readonly list = signal<ScheduleListResponse | null>(null);
  protected readonly listLoading = signal(true);
  protected readonly listError = signal<string | null>(null);
  private listLoadedOnce = false;

  /** True while an infinite-scroll fetch is in flight, used to suppress retriggers. */
  protected readonly pastFetching = signal(false);
  protected readonly futureFetching = signal(false);

  protected readonly futureGroups = computed<FutureGroup[]>(() =>
    groupByDate(this.list()?.future ?? []),
  );
  protected readonly pastGroups = computed<FutureGroup[]>(() =>
    groupByDate(this.list()?.past ?? []),
  );

  protected readonly hasAnyListRows = computed(() => {
    const l = this.list();
    if (!l) return false;
    return (
      (l.yesterday?.length ?? 0) +
        (l.today?.length ?? 0) +
        (l.tomorrow?.length ?? 0) +
        (l.future?.length ?? 0) +
        (l.past?.length ?? 0) >
      0
    );
  });

  // ── FAB state ─────────────────────────────────────────────────────────────

  protected readonly fabExpanded = signal(false);

  // ── Infinite-scroll sentinels ─────────────────────────────────────────────

  @ViewChild('pastSentinel') private pastSentinelRef?: ElementRef<HTMLElement>;
  @ViewChild('futureSentinel') private futureSentinelRef?: ElementRef<HTMLElement>;
  private pastObserver?: IntersectionObserver;
  private futureObserver?: IntersectionObserver;

  constructor() {
    // Reload whichever view is active whenever the drawer mutates something
    // (complete / reschedule / unschedule / delete-logs).
    this.workoutDrawerService.actionCompleted
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refreshActiveView());

    // Re-fetch the calendar window whenever year/month changes. The token guard
    // discards late responses arriving after the user has moved to a different
    // month so the visible state never mismatches the response.
    effect(() => {
      const year = this.displayedYear();
      const month = this.displayedMonth();
      untracked(() => void this.loadCalendar(year, month));
    });

    // Eager-load the list once the user first switches to list view. We do not
    // load both views at first paint — calendar is the default and list is
    // strictly secondary on the personal Schedule surface.
    effect(() => {
      if (this.isList() && !this.listLoadedOnce) {
        untracked(() => void this.loadList());
      }
    });
  }

  ngAfterViewInit(): void {
    // Sentinels live inside an *ngIf for list mode, so we re-attach observers
    // each time the list becomes visible. AfterViewInit covers the first
    // attach when the user lands in list mode.
    this.attachListObservers();
  }

  ngOnDestroy(): void {
    this.pastObserver?.disconnect();
    this.futureObserver?.disconnect();
  }

  // ── View mode toggle ──────────────────────────────────────────────────────

  protected setView(mode: ViewMode): void {
    if (this.viewMode() === mode) return;
    this.viewMode.set(mode);
    // Re-attach intersection observers after Angular renders the list-view DOM.
    if (mode === 'list') queueMicrotask(() => this.attachListObservers());
  }

  // ── Calendar interactions ────────────────────────────────────────────────

  protected previousMonth(): void {
    if (this.calendarLoading()) return;
    const y = this.displayedYear();
    const m = this.displayedMonth();
    if (m === 1) {
      this.displayedYear.set(y - 1);
      this.displayedMonth.set(12);
    } else {
      this.displayedMonth.set(m - 1);
    }
  }

  protected nextMonth(): void {
    if (this.calendarLoading()) return;
    const y = this.displayedYear();
    const m = this.displayedMonth();
    if (m === 12) {
      this.displayedYear.set(y + 1);
      this.displayedMonth.set(1);
    } else {
      this.displayedMonth.set(m + 1);
    }
  }

  protected selectDay(day: CalendarDayResponse): void {
    if (!day.date) return;
    this.selectedDate.set(day.date);
  }

  protected isToday(day: CalendarDayResponse): boolean {
    const c = this.calendar();
    return !!c && !!day.date && day.date === c.today;
  }

  protected isSelected(day: CalendarDayResponse): boolean {
    return day.date === this.selectedDate();
  }

  protected dayAriaLabel(day: CalendarDayResponse): string {
    const parts: string[] = [];
    if (day.date) parts.push(formatLongDate(day.date));
    if (this.isToday(day)) parts.push('Today');
    if (this.isSelected(day)) parts.push('Selected');
    if (day.hasPending && day.hasCompleted) parts.push('Has pending and completed workouts');
    else if (day.hasPending) parts.push('Has pending workouts');
    else if (day.hasCompleted) parts.push('Has completed workouts');
    if (day.inDisplayMonth === false) parts.push('Adjacent month');
    return parts.join(', ');
  }

  protected dayNumber(day: CalendarDayResponse): number | string {
    if (!day.date) return '';
    const m = /^\d{4}-\d{2}-(\d{2})$/.exec(day.date);
    return m ? Number(m[1]) : '';
  }

  // ── Data loaders ──────────────────────────────────────────────────────────

  private async loadCalendar(year: number, month: number): Promise<void> {
    const token = ++this.calendarReqToken;
    this.calendarLoading.set(true);
    this.calendarError.set(null);
    try {
      const res = await this.schedule.loadCalendar(year, month);
      if (token !== this.calendarReqToken) return; // late response, discard
      // Discard the response if the displayed month moved while it was in
      // flight — the echo fields guard against this.
      if (res.year !== year || res.month !== month) return;

      this.calendar.set(res);
      this.resolveSelectedDateAfterLoad(res);
    } catch (err) {
      if (token !== this.calendarReqToken) return;
      if (await this.handleTimezoneRequired(err)) {
        await this.loadCalendar(year, month);
        return;
      }
      this.calendarError.set('Could not load the calendar. Please try again.');
    } finally {
      if (token === this.calendarReqToken) this.calendarLoading.set(false);
    }
  }

  private async loadList(): Promise<void> {
    this.listLoading.set(true);
    this.listError.set(null);
    try {
      const res = await this.schedule.loadList({});
      this.list.set(res);
      this.listLoadedOnce = true;
    } catch (err) {
      if (await this.handleTimezoneRequired(err)) {
        await this.loadList();
        return;
      }
      this.listError.set('Could not load your schedule. Please try again.');
    } finally {
      this.listLoading.set(false);
    }
  }

  protected async retryCalendar(): Promise<void> {
    await this.loadCalendar(this.displayedYear(), this.displayedMonth());
  }

  protected async retryList(): Promise<void> {
    await this.loadList();
  }

  /**
   * After a calendar response arrives, if the previously selected date is no
   * longer in the visible window, reset it. Prefer today (from the server's
   * timezone-correct echo); if today is also outside the window, fall back to
   * the 1st of the displayed month. Per [contract Appendix A.3 Q2].
   */
  private resolveSelectedDateAfterLoad(res: CalendarScheduleResponse): void {
    const sel = this.selectedDate();
    const start = res.windowStart;
    const end = res.windowEnd;
    if (sel && start && end && sel >= start && sel <= end) {
      return;
    }
    if (res.today && start && end && res.today >= start && res.today <= end) {
      this.selectedDate.set(res.today);
      return;
    }
    const firstOfMonth = `${String(res.year).padStart(4, '0')}-${String(res.month).padStart(2, '0')}-01`;
    this.selectedDate.set(firstOfMonth);
  }

  private async handleTimezoneRequired(err: unknown): Promise<boolean> {
    if (getWebAppErrorCode(err) !== 'PROFILE_TIMEZONE_REQUIRED') return false;
    try {
      const profile = await this.profileService.ensureTimezone();
      if (profile.timezone) return true;
    } catch {
      // fall through
    }
    await this.router.navigate(['/settings'], {
      queryParams: { reason: 'timezone-required', returnUrl: '/schedule' },
    });
    return false;
  }

  private refreshActiveView(): void {
    if (this.isCalendar()) {
      void this.loadCalendar(this.displayedYear(), this.displayedMonth());
    } else if (this.listLoadedOnce) {
      void this.loadList();
    }
  }

  // ── Infinite scroll ──────────────────────────────────────────────────────

  private attachListObservers(): void {
    this.pastObserver?.disconnect();
    this.futureObserver?.disconnect();

    const past = this.pastSentinelRef?.nativeElement;
    if (past) {
      this.pastObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) void this.loadMorePast();
        },
        { rootMargin: '256px 0px' },
      );
      this.pastObserver.observe(past);
    }

    const future = this.futureSentinelRef?.nativeElement;
    if (future) {
      this.futureObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) void this.loadMoreFuture();
        },
        { rootMargin: '256px 0px' },
      );
      this.futureObserver.observe(future);
    }
  }

  private async loadMorePast(): Promise<void> {
    const current = this.list();
    if (!current) return;
    const cursor = current.pastNextCursor;
    if (!cursor) return;
    if (this.pastFetching()) return;
    this.pastFetching.set(true);
    try {
      const res = await this.schedule.loadList({ pastCursor: cursor });
      this.list.update((prev) => {
        if (!prev) return res;
        return {
          ...prev,
          past: [...(prev.past ?? []), ...(res.past ?? [])],
          pastNextCursor: res.pastNextCursor,
        };
      });
    } catch (err) {
      // INVALID_CURSOR shouldn't happen with stateless cursors, but if it does,
      // surface a non-blocking message and drop the cursor so we stop hammering.
      if (getWebAppErrorCode(err) === 'INVALID_CURSOR') {
        this.list.update((prev) => (prev ? { ...prev, pastNextCursor: null } : prev));
        this.snackBar.open('Could not load more past workouts.', 'Dismiss', { duration: 3000 });
      } else {
        showGymError(this.snackBar, err, 'Could not load more past workouts.');
      }
    } finally {
      this.pastFetching.set(false);
    }
  }

  private async loadMoreFuture(): Promise<void> {
    const current = this.list();
    if (!current) return;
    const cursor = current.futureNextCursor;
    if (!cursor) return;
    if (this.futureFetching()) return;
    this.futureFetching.set(true);
    try {
      const res = await this.schedule.loadList({ futureCursor: cursor });
      this.list.update((prev) => {
        if (!prev) return res;
        return {
          ...prev,
          future: [...(prev.future ?? []), ...(res.future ?? [])],
          futureNextCursor: res.futureNextCursor,
        };
      });
    } catch (err) {
      if (getWebAppErrorCode(err) === 'INVALID_CURSOR') {
        this.list.update((prev) => (prev ? { ...prev, futureNextCursor: null } : prev));
        this.snackBar.open('Could not load more future workouts.', 'Dismiss', { duration: 3000 });
      } else {
        showGymError(this.snackBar, err, 'Could not load more future workouts.');
      }
    } finally {
      this.futureFetching.set(false);
    }
  }

  // ── FAB / entry points ───────────────────────────────────────────────────

  protected toggleFab(): void {
    this.fabExpanded.update((v) => !v);
  }

  protected closeFab(): void {
    this.fabExpanded.set(false);
  }

  protected async openSchedule(): Promise<void> {
    this.closeFab();
    const initialDate = this.selectedDate() ?? undefined;
    const result = await this.dialog
      .open<
        DashboardScheduleDialog,
        DashboardScheduleDialogData,
        DashboardScheduleDialogResult | undefined
      >(DashboardScheduleDialog, {
        data: { initialDate },
        width: '420px',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .toPromise();
    if (!result) return;

    if (result.mode === 'create') {
      await this.router.navigate(['/workouts/new'], {
        queryParams: { scheduleDate: result.scheduledDate, returnUrl: '/schedule' },
      });
      return;
    }

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
      this.refreshActiveView();
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not schedule the workout.');
    }
  }

  protected async openCreateWorkout(): Promise<void> {
    this.closeFab();
    const queryParams: Record<string, string> = { returnUrl: '/schedule' };
    const date = this.selectedDate();
    if (date) queryParams['scheduleDate'] = date;
    await this.router.navigate(['/workouts/new'], { queryParams });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sortPendingFirst(items: DashboardWorkoutCardResponse[]): DashboardWorkoutCardResponse[] {
  return [...items].sort((a, b) => {
    const ac = a.status === 'Completed' ? 1 : 0;
    const bc = b.status === 'Completed' ? 1 : 0;
    return ac - bc;
  });
}

function groupByDate(items: readonly DashboardWorkoutCardResponse[]): FutureGroup[] {
  const map = new Map<string, DashboardWorkoutCardResponse[]>();
  for (const item of items) {
    const key = item.scheduledDate ?? '';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return Array.from(map.entries()).map(([date, cards]) => ({ date, cards }));
}

/** Format `YYYY-MM-DD` as `Friday, May 29` without timezone-shifting the date. */
function formatLongDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
