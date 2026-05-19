import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';

import { GymsService } from '../../../core/gyms/gyms.service';
import { GymRoleService } from '../../../core/gyms/gym-role.service';
import { canManageGym } from '../../../core/gyms/gym-role';
import { showGymError } from '../../../core/gyms/gym-error-messages';
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
    MatFormFieldModule,
    MatSelectModule,
  ],
  templateUrl: './group-detail.html',
  styleUrl: './group-detail.scss',
})
export class GroupDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly gymsService = inject(GymsService);
  private readonly roleService = inject(GymRoleService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly gymId = signal<string | null>(null);
  protected readonly groupId = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly group = signal<TrainingGroupResponse | null>(null);
  protected readonly members = signal<TrainingGroupMembershipResponse[]>([]);
  protected readonly gymMembers = signal<GymMembershipResponse[]>([]);
  protected readonly selectedAthleteId = signal<string | null>(null);

  protected readonly role = computed(() => this.roleService.forGym(this.gymId()));
  protected readonly canManage = computed(() => canManageGym(this.role()));

  protected readonly displayedColumns = ['athlete', 'assignedAt', 'actions'];

  /** Gym members not already assigned to this group, for the picker. */
  protected readonly assignableMembers = computed(() => {
    const inGroup = new Set(
      this.members().filter((m) => !m.isDeleted).map((m) => m.athleteId),
    );
    return this.gymMembers().filter(
      (m) => !m.isDeleted && m.athleteId && !inGroup.has(m.athleteId),
    );
  });

  protected readonly activeMembers = computed(() =>
    this.members().filter((m) => !m.isDeleted),
  );

  async ngOnInit(): Promise<void> {
    // gymId is on the grandparent route (`gyms/:gymId`), groupId on this route.
    this.gymId.set(this.route.parent?.parent?.snapshot.paramMap.get('gymId') ?? null);
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
      this.snackBar.open('Member added to group.', 'Dismiss', { duration: 2500 });
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not add the member.');
    }
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
