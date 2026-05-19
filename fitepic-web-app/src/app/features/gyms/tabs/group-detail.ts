import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';

import { GymsService } from '../../../core/gyms/gyms.service';
import { GymRoleService } from '../../../core/gyms/gym-role.service';
import { ProfileService } from '../../../core/profile/profile.service';
import { canManageGym, canProgramWorkouts } from '../../../core/gyms/gym-role';
import { showGymError } from '../../../core/gyms/gym-error-messages';
import { createPendingAction } from '../../../core/async/pending-action';
import { TrainingGroupResponse } from '../../../core/api/generated/models/training-group-response';
import { TrainingGroupMembershipResponse } from '../../../core/api/generated/models/training-group-membership-response';
import { GymMembershipResponse } from '../../../core/api/generated/models/gym-membership-response';
import {
  ConfirmActionDialog,
  ConfirmActionDialogData,
} from '../confirm-action-dialog';

@Component({
  selector: 'app-group-detail',
  imports: [
    FormsModule,
    RouterLink,
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  templateUrl: './group-detail.html',
  styleUrl: './group-detail.scss',
})
export class GroupDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly gymsService = inject(GymsService);
  private readonly roleService = inject(GymRoleService);
  private readonly profileService = inject(ProfileService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  private readonly personalFeedAction = createPendingAction<void>();

  protected readonly gymId = signal<string | null>(null);
  protected readonly groupId = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly group = signal<TrainingGroupResponse | null>(null);
  protected readonly members = signal<TrainingGroupMembershipResponse[]>([]);
  protected readonly gymMembers = signal<GymMembershipResponse[]>([]);
  protected readonly selectedAthleteId = signal<string | null>(null);
  protected readonly personalFeedSaving = this.personalFeedAction.pending;

  protected readonly role = computed(() => this.roleService.forGym(this.gymId()));
  protected readonly canManage = computed(() => canManageGym(this.role()));
  /**
   * Staff = Coach / Admin / Owner. v6 lets staff toggle a personal-feed
   * subscription for any group in their gym independently of role-based
   * oversight. Athletes don't see this toggle — they're added to groups by
   * staff via the picker.
   */
  protected readonly canTogglePersonalFeed = computed(() =>
    canProgramWorkouts(this.role()),
  );

  /** Whether the caller currently holds an explicit `TrainingGroupMembership`. */
  protected readonly subscribedToFeed = computed(() => {
    const me = this.profileService.profile()?.id;
    if (!me) return false;
    return this.members().some((m) => !m.isDeleted && m.athleteId === me);
  });

  protected readonly displayedColumns = ['athlete', 'assignedAt', 'actions'];

  /**
   * Picker pool for adding athletes. Restricted to `Athlete` role per v6 —
   * staff/owner opt into personal-feed visibility via the toggle above,
   * not via this picker.
   */
  protected readonly assignableMembers = computed(() => {
    const inGroup = new Set(
      this.members().filter((m) => !m.isDeleted).map((m) => m.athleteId),
    );
    return this.gymMembers().filter(
      (m) =>
        !m.isDeleted &&
        m.athleteId &&
        m.role === 'Athlete' &&
        !inGroup.has(m.athleteId),
    );
  });

  protected readonly activeMembers = computed(() =>
    this.members().filter((m) => !m.isDeleted),
  );

  async ngOnInit(): Promise<void> {
    // `groups/:groupId` is a direct child of `gyms/:gymId`, so `gymId` lives
    // on the *parent* route.
    this.gymId.set(this.route.parent?.snapshot.paramMap.get('gymId') ?? null);
    this.groupId.set(this.route.snapshot.paramMap.get('groupId') ?? null);
    await this.load();
  }

  protected async assign(): Promise<void> {
    const gid = this.gymId();
    const grp = this.groupId();
    const athleteId = this.selectedAthleteId();
    if (!gid || !grp || !athleteId) return;
    try {
      const created = await this.gymsService.assignToGroup(gid, grp, athleteId);
      this.members.update((list) => [...list, created]);
      this.selectedAthleteId.set(null);
      this.snackBar.open('Athlete added to group.', 'Dismiss', { duration: 2500 });
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not add the athlete.');
    }
  }

  /**
   * Staff toggle: add/remove the caller's own `TrainingGroupMembership` for
   * this group. Adding makes the group's scheduled workouts appear in the
   * caller's personal calendar; removing turns that off (oversight via
   * Coach+ role is unaffected).
   */
  protected async onTogglePersonalFeed(next: boolean): Promise<void> {
    const gid = this.gymId();
    const grp = this.groupId();
    const me = this.profileService.profile()?.id;
    if (!gid || !grp || !me) return;
    if (this.personalFeedSaving()) return;
    const wasSubscribed = this.subscribedToFeed();
    if (next === wasSubscribed) return;
    await this.personalFeedAction.run(async () => {
      try {
        if (next) {
          const created = await this.gymsService.assignToGroup(gid, grp, me);
          this.members.update((list) => [...list, created]);
          this.snackBar.open(
            "Group's workouts will appear on your personal calendar.",
            'Dismiss',
            { duration: 2500 },
          );
        } else {
          await this.gymsService.removeFromGroup(gid, grp, me);
          this.members.update((list) => list.filter((m) => m.athleteId !== me));
          this.snackBar.open(
            "Removed from your personal calendar. You can still oversee this group's schedule from the Schedule tab.",
            'Dismiss',
            { duration: 4000 },
          );
        }
      } catch (err) {
        showGymError(this.snackBar, err, 'Could not update your calendar subscription.');
      }
    });
  }

  protected async remove(row: TrainingGroupMembershipResponse): Promise<void> {
    const gid = this.gymId();
    const grp = this.groupId();
    if (!gid || !grp || !row.athleteId) return;
    const name = row.athleteDisplayName || row.athleteEmail || 'this athlete';
    const confirmed = await this.dialog
      .open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(ConfirmActionDialog, {
        data: {
          title: 'Remove from group?',
          message: `Remove ${name}? They lose access to upcoming scheduled workouts for this group; completed history is preserved.`,
          confirmLabel: 'Remove',
          warn: true,
        },
        width: '480px',
      })
      .afterClosed()
      .toPromise();
    if (!confirmed) return;
    try {
      await this.gymsService.removeFromGroup(gid, grp, row.athleteId);
      this.members.update((list) => list.filter((m) => m.athleteId !== row.athleteId));
      this.snackBar.open('Member removed.', 'Dismiss', { duration: 2500 });
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not remove the member.');
    }
  }

  protected athleteOptionLabel(member: GymMembershipResponse): string {
    return member.athleteDisplayName || member.athleteEmail || member.athleteId || '—';
  }

  protected formatAssignedAt(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString();
  }

  private async load(): Promise<void> {
    const gid = this.gymId();
    const grp = this.groupId();
    if (!gid || !grp) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const [groups, members, gymMembers] = await Promise.all([
        this.gymsService.listGroups(gid),
        this.gymsService.listGroupMembers(gid, grp),
        this.canManage() ? this.gymsService.listMembers(gid) : Promise.resolve([]),
      ]);
      this.group.set(groups.find((g) => g.id === grp) ?? null);
      this.members.set(members);
      this.gymMembers.set(gymMembers);
    } catch {
      this.group.set(null);
      this.members.set([]);
      this.gymMembers.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
