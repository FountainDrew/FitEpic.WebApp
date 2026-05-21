import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GymsService } from '../../../core/gyms/gyms.service';
import { GymRoleService } from '../../../core/gyms/gym-role.service';
import { ProfileService } from '../../../core/profile/profile.service';
import { WorkoutsService } from '../../../core/workouts/workouts.service';
import { canProgramWorkouts } from '../../../core/gyms/gym-role';
import { showGymError, SYNC_RESULT_MESSAGES } from '../../../core/gyms/gym-error-messages';
import { createPendingAction } from '../../../core/async/pending-action';
import { ScheduledWorkoutResponse } from '../../../core/api/generated/models/scheduled-workout-response';
import { TrainingGroupResponse } from '../../../core/api/generated/models/training-group-response';
import { WorkoutResponse } from '../../../core/api/generated/models/workout-response';
import {
  GymScheduleStartDialog,
  GymScheduleStartDialogData,
  GymScheduleStartDialogResult,
} from '../gym-schedule-start-dialog/gym-schedule-start-dialog';
import {
  GymWorkoutLibraryDrawer,
  GymWorkoutLibraryDrawerData,
} from '../gym-workout-library-drawer/gym-workout-library-drawer';
import {
  GymScheduleCard,
  GymScheduleCardRow,
} from '../gym-schedule-card/gym-schedule-card';
import { GymScheduleDrawer } from '../gym-schedule-drawer/gym-schedule-drawer';
import { GymScheduleDrawerService } from '../gym-schedule-drawer/gym-schedule-drawer.service';

interface DayGroup {
  date: string;
  rows: GymScheduleCardRow[];
}

@Component({
  selector: 'app-schedule-tab',
  imports: [
    DatePipe,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatSelectModule,
    GymScheduleCard,
    GymScheduleDrawer,
  ],
  templateUrl: './schedule-tab.html',
  styleUrl: './schedule-tab.scss',
})
export class ScheduleTab implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly gymsService = inject(GymsService);
  private readonly roleService = inject(GymRoleService);
  private readonly profileService = inject(ProfileService);
  private readonly workoutsService = inject(WorkoutsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly drawerService = inject(GymScheduleDrawerService);

  private readonly scheduleAction = createPendingAction<void>();

  protected readonly gymId = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly scheduling = this.scheduleAction.pending;

  protected readonly groups = signal<TrainingGroupResponse[]>([]);
  /**
   * Training group(s) the user has selected to view. The dropdown is
   * multi-select so a coach can see several groups' schedules at once; the
   * loader fans out one parallel request per selection and merges the results
   * into {@link scheduled}.
   */
  protected readonly selectedGroupIds = signal<string[]>([]);
  protected readonly scheduled = signal<ScheduledWorkoutResponse[]>([]);
  protected readonly workoutsById = signal<Map<string, WorkoutResponse>>(new Map());
  protected readonly groupNameById = computed<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const g of this.groups()) {
      if (g.id && g.name) m.set(g.id, g.name);
    }
    return m;
  });
  /**
   * Athlete-id → display-name lookup, populated from the gym membership list
   * plus the gym owner. Used to surface "Programmed by" on each schedule card.
   * The gym owner doesn't have a membership row so they're added separately.
   */
  protected readonly displayNameByAthleteId = signal<Map<string, string>>(new Map());

  /** Inclusive start of the visible 7-day window. ISO `YYYY-MM-DD`. */
  protected readonly windowStart = signal<string>(startOfWeekIso(new Date()));
  protected readonly windowEnd = computed(() => addDaysIso(this.windowStart(), 6));

  protected readonly role = computed(() => this.roleService.forGym(this.gymId()));
  protected readonly canSchedule = computed(() => canProgramWorkouts(this.role()));

  protected readonly visibleRows = computed<GymScheduleCardRow[]>(() => {
    const workouts = this.workoutsById();
    const names = this.displayNameByAthleteId();
    const groupNames = this.groupNameById();
    return this.scheduled()
      .filter((s) => !s.isDeleted)
      .map((s) => {
        const workout = workouts.get(s.workoutId ?? '') ?? null;
        const programmedById = s.programmedByAthleteId;
        // The per-group oversight endpoint projects `LoggedCount` + `GroupSize`
        // on every row (see contract Q12 — round 4 response). The fields are
        // nullable to stay forward-compatible with any future endpoint that
        // doesn't project them; the card hides the chip when either side is
        // null.
        const completion =
          s.loggedCount != null && s.groupSize != null
            ? { logged: s.loggedCount, total: s.groupSize }
            : null;
        return {
          scheduled: s,
          workout,
          workoutName: workout?.name ?? 'Untitled workout',
          trainingGroupName: s.trainingGroupId
            ? (groupNames.get(s.trainingGroupId) ?? null)
            : null,
          programmedByName: programmedById ? (names.get(programmedById) ?? null) : null,
          completion,
        };
      });
  });

  protected readonly dayGroups = computed<DayGroup[]>(() => {
    const buckets = new Map<string, GymScheduleCardRow[]>();
    for (const row of this.visibleRows()) {
      const key = row.scheduled.scheduledDate ?? 'unknown';
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rows]) => ({ date, rows }));
  });

  constructor() {
    // Reload when the selection or the visible week changes.
    effect(() => {
      const gymId = this.gymId();
      const groupIds = this.selectedGroupIds();
      // Track week boundary as a dependency so changing the window reloads.
      this.windowStart();
      if (gymId && groupIds.length > 0) {
        void this.loadSchedule(gymId, groupIds);
      } else {
        this.scheduled.set([]);
      }
    });

    // Drawer actions (reschedule / unschedule) bump this Subject on success;
    // reload the visible week so the card list reflects the change.
    this.drawerService.actionCompleted
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        const gymId = this.gymId();
        const groupIds = this.selectedGroupIds();
        if (gymId && groupIds.length > 0) void this.loadSchedule(gymId, groupIds);
      });
  }

  async ngOnInit(): Promise<void> {
    this.gymId.set(this.route.parent?.snapshot.paramMap.get('gymId') ?? null);
    await this.loadGroupsAndWorkouts();
  }

  protected onGroupChange(groupIds: string[]): void {
    this.selectedGroupIds.set(groupIds);
  }

  protected async onPreviousWeek(): Promise<void> {
    this.windowStart.set(addDaysIso(this.windowStart(), -7));
  }

  protected async onNextWeek(): Promise<void> {
    this.windowStart.set(addDaysIso(this.windowStart(), 7));
  }

  protected async onToday(): Promise<void> {
    this.windowStart.set(startOfWeekIso(new Date()));
  }

  /**
   * Coach-facing schedule flow. Mirrors the athlete dashboard's two-step
   * process (`DashboardScheduleDialog` → editor *or* library slideout):
   *
   *  1. Small start dialog (instant — no data fetch) collects the schedule
   *     parameters (date + one or more training groups) and asks whether to
   *     author a new workout or pick from the gym library.
   *  2a. **Create** → navigate to the workout editor with `gymId` +
   *      `scheduleGroupId` + `scheduleDate` on the query string. The editor
   *      handles auto-schedule on save.
   *  2b. **Pick** → open a right-side library slideout populated from the
   *      already-loaded gym workouts. Selecting one syncs a scheduled-workout
   *      row per selected group.
   */
  protected async openSchedule(): Promise<void> {
    const id = this.gymId();
    if (!id) return;
    const result = await this.dialog
      .open<
        GymScheduleStartDialog,
        GymScheduleStartDialogData,
        GymScheduleStartDialogResult | undefined
      >(GymScheduleStartDialog, {
        data: {
          groups: this.groups(),
          initialGroupIds: this.selectedGroupIds(),
        },
        width: '460px',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .toPromise();
    if (!result) return;

    if (result.mode === 'create') {
      await this.router.navigate(['/workouts/new'], {
        queryParams: {
          gymId: id,
          scheduleGroupId: result.trainingGroupIds,
          scheduleDate: result.scheduledDate,
          returnUrl: `/gyms/${id}/schedule`,
        },
      });
      return;
    }

    // Pick branch: open the gym library slideout. The drawer takes the
    // pre-loaded gym workouts from this component so it opens instantly.
    const liveWorkouts = [...this.workoutsById().values()].filter(
      (w) => !w.isDeleted && !w.isArchived,
    );
    const picked = await this.dialog
      .open<
        GymWorkoutLibraryDrawer,
        GymWorkoutLibraryDrawerData,
        WorkoutResponse | undefined
      >(GymWorkoutLibraryDrawer, {
        data: {
          workouts: liveWorkouts,
          scheduledDate: result.scheduledDate,
          groupCount: result.trainingGroupIds.length,
        },
        panelClass: ['fe-dialog', 'fe-slideout'],
        position: { right: '0', top: '0' },
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .toPromise();
    if (!picked?.id) return;

    await this.scheduleAction.run(async () => {
      const me = this.profileService.profile()?.id ?? null;
      let succeeded = 0;
      let forbidden = 0;
      let errored = 0;
      const now = new Date().toISOString();
      for (const groupId of result.trainingGroupIds) {
        try {
          const sync = await this.workoutsService.syncScheduledWorkout({
            id: crypto.randomUUID(),
            workoutId: picked.id!,
            trainingGroupId: groupId,
            athleteId: null,
            scheduledDate: result.scheduledDate,
            // Carry the workout template's score type onto the scheduled row
            // so the server renders the right score affordance to athletes.
            scoreType: picked.scoreType,
            // Coach scheduling for a group: stamp the programmer so the
            // "Programmed by" chip resolves and v8 lock-rule caller-awareness
            // sees the right author.
            programmedByAthleteId: me,
            status: 'Pending',
            exerciseLogs: [],
            createdAt: now,
            updatedAt: now,
          });
          if (sync?.resolution === 'Forbidden') forbidden += 1;
          else succeeded += 1;
        } catch {
          errored += 1;
        }
      }
      // Refresh the currently-viewed groups; if the coach scheduled for a
      // group not in the current selection the effect won't fire, so reload
      // defensively.
      const current = this.selectedGroupIds();
      if (current.length > 0 && id) await this.loadSchedule(id, current);
      this.snackBar.open(
        this.buildScheduleSummary(succeeded, forbidden, errored, result.trainingGroupIds.length),
        'Dismiss',
        { duration: 4000 },
      );
    });
  }

  private buildScheduleSummary(
    succeeded: number,
    forbidden: number,
    errored: number,
    total: number,
  ): string {
    if (succeeded === total && total === 1) return 'Workout scheduled.';
    if (succeeded === total) return `Workout scheduled for ${total} groups.`;
    if (succeeded === 0 && forbidden === total) {
      return SYNC_RESULT_MESSAGES['Forbidden'] ?? 'You cannot schedule for those groups.';
    }
    if (succeeded === 0) return 'Could not schedule the workout for any group.';
    const parts = [`Scheduled for ${succeeded} of ${total} groups.`];
    if (forbidden > 0) parts.push(`${forbidden} rejected.`);
    if (errored > 0) parts.push(`${errored} failed.`);
    return parts.join(' ');
  }

  /**
   * One-time fetch of the group list + workout library + member roster for the
   * gym. The group dropdown defaults to the first non-deleted group. The actual
   * schedule fetch is driven by the effect in the constructor whenever group
   * or window changes.
   */
  private async loadGroupsAndWorkouts(): Promise<void> {
    const id = this.gymId();
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const [groups, workouts, members, gym] = await Promise.all([
        this.gymsService.listGroups(id),
        this.gymsService.listGymWorkouts(id, { includeArchived: true }),
        this.gymsService.listMembers(id),
        this.gymsService.getGym(id),
      ]);
      const liveGroups = groups.filter((g) => !g.isDeleted);
      this.groups.set(liveGroups);
      this.workoutsById.set(
        new Map(workouts.filter((w) => w.id).map((w) => [w.id!, w])),
      );
      // Build the athlete-id → display-name lookup. Members carry their own
      // display names. The owner doesn't have a `GymMembership` row but
      // `GymResponse.OwnerDisplayName` was added in API round 4 (Q13) so we
      // seed the lookup with the owner too. Athlete-tier callers get
      // `OwnerAthleteId` / `OwnerDisplayName` redacted to null per the v7 rule
      // — staff get the populated values, which is who can see this page
      // anyway since the schedule tab is gated to Coach+.
      const names = new Map<string, string>();
      for (const m of members) {
        if (m.athleteId && m.athleteDisplayName) {
          names.set(m.athleteId, m.athleteDisplayName);
        }
      }
      if (gym?.ownerAthleteId && gym.ownerDisplayName) {
        names.set(gym.ownerAthleteId, gym.ownerDisplayName);
      }
      this.displayNameByAthleteId.set(names);
      // Default to the first group if no selection yet.
      if (this.selectedGroupIds().length === 0 && liveGroups.length > 0 && liveGroups[0].id) {
        this.selectedGroupIds.set([liveGroups[0].id]);
      }
    } catch {
      this.error.set('Could not load the schedule.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Fetch the scheduled workouts for the selected group(s) via the oversight
   * endpoint and merge them into a single list. Per v6, no mid-flight rule
   * and no `TrainingGroupMembership` requirement — staff see the full
   * schedule for any group in their gym.
   *
   * Fan-out is N parallel requests for N selected groups. The API doesn't
   * expose a multi-group oversight endpoint, so this is the simplest correct
   * path; in practice coaches view 1–3 groups at a time.
   */
  private async loadSchedule(gymId: string, groupIds: string[]): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const from = this.windowStart();
      const to = this.windowEnd();
      const perGroup = await Promise.all(
        groupIds.map((groupId) =>
          this.workoutsService.listGroupScheduledWorkouts(gymId, groupId, from, to),
        ),
      );
      this.scheduled.set(perGroup.flat());
    } catch (err) {
      // 403 means the caller isn't Coach+ — shouldn't normally happen since
      // the tab is already role-gated, but surface a useful message.
      const status =
        typeof err === 'object' && err && 'status' in err
          ? (err as { status: number }).status
          : 0;
      this.error.set(
        status === 403
          ? 'You do not have permission to view this gym’s schedule.'
          : 'Could not load the schedule.',
      );
      this.scheduled.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}

function startOfWeekIso(d: Date): string {
  const day = d.getDay();
  const offset = (day + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
  return monday.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, day] = iso.split('-').map(Number);
  const next = new Date(y, (m ?? 1) - 1, (day ?? 1) + days);
  return next.toISOString().slice(0, 10);
}
