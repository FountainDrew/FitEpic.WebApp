import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GymsService } from '../../core/gyms/gyms.service';
import { showGymError } from '../../core/gyms/gym-error-messages';
import { GymJoinRequestResponse } from '../../core/api/generated/models/gym-join-request-response';
import { GymMembershipInviteResponse } from '../../core/api/generated/models/gym-membership-invite-response';

@Component({
  selector: 'app-my-inbox-page',
  imports: [RouterLink, MatCardModule, MatButtonModule, MatIconModule, MatChipsModule],
  templateUrl: './my-inbox-page.html',
  styleUrl: './my-inbox-page.scss',
})
export class MyInboxPage implements OnInit {
  private readonly gymsService = inject(GymsService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly loading = signal(true);
  protected readonly invites = signal<GymMembershipInviteResponse[]>([]);
  protected readonly requests = signal<GymJoinRequestResponse[]>([]);

  protected readonly pendingInvites = computed(() =>
    this.invites().filter((i) => !i.isDeleted && i.status === 'Pending'),
  );
  protected readonly otherInvites = computed(() =>
    this.invites().filter((i) => !i.isDeleted && i.status !== 'Pending'),
  );
  protected readonly pendingRequests = computed(() =>
    this.requests().filter((r) => !r.isDeleted && r.status === 'Pending'),
  );
  protected readonly otherRequests = computed(() =>
    this.requests().filter((r) => !r.isDeleted && r.status !== 'Pending'),
  );

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected async accept(row: GymMembershipInviteResponse): Promise<void> {
    if (!row.id) return;
    try {
      const result = await this.gymsService.acceptInvite(row.id);
      this.snackBar.open('Invite accepted.', 'Dismiss', { duration: 2500 });
      if (result.invite) this.upsertInvite(result.invite);
      // Refresh memberships so the gym shows up in the user's list.
      await this.gymsService.bootstrap();
      if (result.invite?.gymId) {
        await this.router.navigateByUrl(`/gyms/${result.invite.gymId}`);
      }
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not accept the invite.');
    }
  }

  protected async reject(row: GymMembershipInviteResponse): Promise<void> {
    if (!row.id) return;
    try {
      const updated = await this.gymsService.rejectInvite(row.id);
      this.snackBar.open('Invite declined.', 'Dismiss', { duration: 2500 });
      this.upsertInvite(updated);
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not decline the invite.');
    }
  }

  protected async cancel(row: GymJoinRequestResponse): Promise<void> {
    if (!row.id) return;
    try {
      const updated = await this.gymsService.cancelJoinRequest(row.id);
      this.snackBar.open('Request cancelled.', 'Dismiss', { duration: 2500 });
      this.upsertRequest(updated);
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not cancel the request.');
    }
  }

  protected formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [invites, requests] = await Promise.all([
        this.gymsService.listMyInvites(),
        this.gymsService.listMyJoinRequests(),
      ]);
      this.invites.set(invites);
      this.requests.set(requests);
    } catch {
      this.invites.set([]);
      this.requests.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private upsertInvite(updated: GymMembershipInviteResponse): void {
    this.invites.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
  }
  private upsertRequest(updated: GymJoinRequestResponse): void {
    this.requests.update((list) => list.map((r) => (r.id === updated.id ? updated : r)));
  }
}
