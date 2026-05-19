import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GymsService } from '../../../core/gyms/gyms.service';
import { GymRoleService } from '../../../core/gyms/gym-role.service';
import { ProfileService } from '../../../core/profile/profile.service';
import { canManageGym, isOwner } from '../../../core/gyms/gym-role';
import { showGymError } from '../../../core/gyms/gym-error-messages';
import { GymMembershipResponse } from '../../../core/api/generated/models/gym-membership-response';
import { GymRole } from '../../../core/api/generated/models/gym-role';
import {
  ConfirmActionDialog,
  ConfirmActionDialogData,
} from '../confirm-action-dialog';

interface MemberRow {
  id: string;
  athleteId: string;
  athleteDisplayName: string | null;
  athleteEmail: string | null;
  role: GymRole | 'Owner';
  joinedAt: string | null;
  isCallerSelf: boolean;
}

const OWNER_ID = '__owner__';

@Component({
  selector: 'app-members-tab',
  imports: [
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './members-tab.html',
  styleUrl: './members-tab.scss',
})
export class MembersTab implements OnInit {
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
  protected readonly members = signal<GymMembershipResponse[]>([]);

  protected readonly role = computed(() => this.roleService.forGym(this.gymId()));
  protected readonly canManage = computed(() => canManageGym(this.role()));
  protected readonly callerIsOwner = computed(() => isOwner(this.role()));

  protected readonly displayedColumns = ['athlete', 'role', 'joinedAt', 'actions'];

  protected readonly rows = computed<MemberRow[]>(() => {
    const id = this.gymId();
    if (!id) return [];
    const gym = this.gymsService.gyms().find((g) => g.id === id);
    const me = this.profileService.profile()?.id ?? null;
    const out: MemberRow[] = [];
    if (gym?.ownerAthleteId) {
      out.push({
        id: OWNER_ID,
        athleteId: gym.ownerAthleteId,
        athleteDisplayName: gym.ownerAthleteId === me ? 'You' : 'Owner',
        athleteEmail: null,
        role: 'Owner',
        joinedAt: gym.createdAt ?? null,
        isCallerSelf: gym.ownerAthleteId === me,
      });
    }
    for (const m of this.members()) {
      if (m.isDeleted) continue;
      if (!m.id || !m.athleteId || !m.role) continue;
      out.push({
        id: m.id,
        athleteId: m.athleteId,
        athleteDisplayName: m.athleteDisplayName ?? null,
        athleteEmail: m.athleteEmail ?? null,
        role: m.role,
        joinedAt: m.joinedAt ?? null,
        isCallerSelf: m.athleteId === me,
      });
    }
    return out;
  });

  async ngOnInit(): Promise<void> {
    const id = this.route.parent?.snapshot.paramMap.get('gymId') ?? null;
    this.gymId.set(id);
    if (!id) {
      this.loading.set(false);
      return;
    }
    await this.refreshMembers();
  }

  protected canPromoteToCoach(row: MemberRow): boolean {
    return this.canManage() && row.role === 'Athlete';
  }
  protected canDemoteToAthlete(row: MemberRow): boolean {
    return this.canManage() && row.role === 'Coach';
  }
  protected canGrantAdmin(row: MemberRow): boolean {
    return this.callerIsOwner() && (row.role === 'Athlete' || row.role === 'Coach');
  }
  protected canRevokeAdmin(row: MemberRow): boolean {
    return this.callerIsOwner() && row.role === 'Admin';
  }
  protected canRemove(row: MemberRow): boolean {
    if (row.role === 'Owner') return false;
    if (row.isCallerSelf) return false;
    if (row.role === 'Admin') return this.callerIsOwner();
    return this.canManage();
  }
  protected canLeave(row: MemberRow): boolean {
    return row.isCallerSelf && row.role !== 'Owner';
  }

  protected formatJoinedAt(value: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString();
  }

  protected async changeRole(row: MemberRow, role: GymRole): Promise<void> {
    const gymId = this.gymId();
    if (!gymId) return;
    try {
      await this.gymsService.changeMemberRole(gymId, row.athleteId, role);
      this.snackBar.open(`${displayNameOrFallback(row)} → ${role}.`, 'Dismiss', {
        duration: 2500,
      });
      await this.refreshMembers();
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not change the role.');
    }
  }

  protected async remove(row: MemberRow): Promise<void> {
    const gymId = this.gymId();
    if (!gymId) return;
    const confirmed = await this.dialog
      .open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(ConfirmActionDialog, {
        data: {
          title: 'Remove member?',
          message: `Remove ${displayNameOrFallback(row)} from the gym? They will lose access to upcoming scheduled workouts but keep completed history.`,
          confirmLabel: 'Remove',
          warn: true,
        },
        width: '480px',
      })
      .afterClosed()
      .toPromise();
    if (!confirmed) return;
    try {
      await this.gymsService.removeMember(gymId, row.athleteId);
      this.snackBar.open('Member removed.', 'Dismiss', { duration: 2500 });
      await this.refreshMembers();
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not remove the member.');
    }
  }

  protected async leave(): Promise<void> {
    const gymId = this.gymId();
    if (!gymId) return;
    const confirmed = await this.dialog
      .open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(ConfirmActionDialog, {
        data: {
          title: 'Leave this gym?',
          message: 'You will lose access to upcoming scheduled workouts. Completed history is preserved.',
          confirmLabel: 'Leave',
          warn: true,
        },
        width: '480px',
      })
      .afterClosed()
      .toPromise();
    if (!confirmed) return;
    try {
      await this.gymsService.leaveGym(gymId);
      this.snackBar.open('You left the gym.', 'Dismiss', { duration: 2500 });
      await this.router.navigateByUrl('/gyms');
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not leave the gym.');
    }
  }

  private async refreshMembers(): Promise<void> {
    const id = this.gymId();
    if (!id) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const list = await this.gymsService.listMembers(id);
      this.members.set(list);
    } catch (err) {
      // 403 here means the caller is an Athlete — render that explicitly.
      const status =
        typeof err === 'object' && err && 'status' in err
          ? (err as { status: number }).status
          : 0;
      if (status === 403) {
        this.error.set('Only gym staff can see the member roster.');
      } else {
        this.error.set('Could not load members. Try again.');
      }
      this.members.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}

function displayNameOrFallback(row: MemberRow): string {
  return row.athleteDisplayName?.trim() || row.athleteEmail || 'this athlete';
}
