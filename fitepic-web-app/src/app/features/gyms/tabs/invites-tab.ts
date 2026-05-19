import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GymsService } from '../../../core/gyms/gyms.service';
import { GymRoleService } from '../../../core/gyms/gym-role.service';
import { isOwner } from '../../../core/gyms/gym-role';
import { showGymError } from '../../../core/gyms/gym-error-messages';
import { GymMembershipInviteResponse } from '../../../core/api/generated/models/gym-membership-invite-response';
import { GymMembershipInviteStatus } from '../../../core/api/generated/models/gym-membership-invite-status';
import {
  SendInviteDialog,
  SendInviteDialogData,
  SendInviteDialogResult,
} from '../send-invite-dialog';

type StatusFilter = GymMembershipInviteStatus | 'All';

@Component({
  selector: 'app-invites-tab',
  imports: [
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule,
  ],
  templateUrl: './invites-tab.html',
  styleUrl: './invites-tab.scss',
})
export class InvitesTab implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly gymsService = inject(GymsService);
  private readonly roleService = inject(GymRoleService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly gymId = signal<string | null>(null);
  protected readonly filter = signal<StatusFilter>('Pending');
  protected readonly invites = signal<GymMembershipInviteResponse[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly role = computed(() => this.roleService.forGym(this.gymId()));
  protected readonly canOfferAdmin = computed(() => isOwner(this.role()));

  protected readonly displayedColumns = ['invitedAthlete', 'role', 'created', 'status', 'actions'];
  protected readonly filters: StatusFilter[] = [
    'Pending',
    'Accepted',
    'Rejected',
    'Revoked',
    'All',
  ];

  protected readonly rows = computed(() => this.invites().filter((i) => !i.isDeleted));

  async ngOnInit(): Promise<void> {
    this.gymId.set(this.route.parent?.snapshot.paramMap.get('gymId') ?? null);
    await this.load();
  }

  protected async onFilterChange(filter: StatusFilter): Promise<void> {
    this.filter.set(filter);
    await this.load();
  }

  protected async openSend(): Promise<void> {
    const id = this.gymId();
    if (!id) return;
    const result = await this.dialog
      .open<SendInviteDialog, SendInviteDialogData, SendInviteDialogResult | undefined>(
        SendInviteDialog,
        {
          data: { canOfferAdmin: this.canOfferAdmin() },
          width: '480px',
          autoFocus: 'first-tabbable',
        },
      )
      .afterClosed()
      .toPromise();
    if (!result) return;
    try {
      await this.gymsService.sendInvite(id, result.email, result.offeredRole);
      this.snackBar.open(`Invite sent to ${result.email}.`, 'Dismiss', { duration: 3000 });
      // Per Q3: response is identical for unknown vs known emails to prevent account
      // enumeration. The contract advises re-fetching the outbox to surface the new row.
      await this.load();
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not send the invite.');
    }
  }

  protected async revoke(row: GymMembershipInviteResponse): Promise<void> {
    if (!row.id) return;
    try {
      const updated = await this.gymsService.revokeInvite(row.id);
      this.snackBar.open('Invite revoked.', 'Dismiss', { duration: 2500 });
      this.upsertInvite(updated);
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not revoke the invite.');
    }
  }

  protected invitedLabel(row: GymMembershipInviteResponse): string {
    return row.invitedAthleteId ?? '—';
  }

  protected formatCreated(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString();
  }

  private async load(): Promise<void> {
    const id = this.gymId();
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const f = this.filter();
      const status = f === 'All' ? undefined : f;
      const list = await this.gymsService.listGymInvites(id, status);
      this.invites.set(list);
    } catch {
      this.error.set('Could not load invites.');
      this.invites.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private upsertInvite(updated: GymMembershipInviteResponse): void {
    if (!updated.id) return;
    this.invites.update((list) => {
      const idx = list.findIndex((r) => r.id === updated.id);
      if (idx === -1) {
        return this.filter() === 'All' || this.filter() === updated.status
          ? [updated, ...list]
          : list;
      }
      if (this.filter() !== 'All' && updated.status !== this.filter()) {
        return list.filter((r) => r.id !== updated.id);
      }
      const next = list.slice();
      next[idx] = updated;
      return next;
    });
  }
}
