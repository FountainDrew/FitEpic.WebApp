import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GymsService } from '../../../core/gyms/gyms.service';
import { showGymError } from '../../../core/gyms/gym-error-messages';
import { GymJoinRequestResponse } from '../../../core/api/generated/models/gym-join-request-response';
import { GymJoinRequestStatus } from '../../../core/api/generated/models/gym-join-request-status';

type StatusFilter = GymJoinRequestStatus | 'All';

@Component({
  selector: 'app-requests-tab',
  imports: [
    MatCardModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatButtonToggleModule,
  ],
  templateUrl: './requests-tab.html',
  styleUrl: './requests-tab.scss',
})
export class RequestsTab implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly gymsService = inject(GymsService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly gymId = signal<string | null>(null);
  protected readonly filter = signal<StatusFilter>('Pending');
  protected readonly requests = signal<GymJoinRequestResponse[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly displayedColumns = ['athlete', 'role', 'created', 'status', 'actions'];
  protected readonly filters: StatusFilter[] = [
    'Pending',
    'Approved',
    'Denied',
    'Cancelled',
    'All',
  ];

  protected readonly rows = computed(() =>
    this.requests().filter((r) => !r.isDeleted),
  );

  async ngOnInit(): Promise<void> {
    this.gymId.set(this.route.parent?.snapshot.paramMap.get('gymId') ?? null);
    await this.load();
  }

  protected async onFilterChange(filter: StatusFilter): Promise<void> {
    this.filter.set(filter);
    await this.load();
  }

  protected async approve(row: GymJoinRequestResponse): Promise<void> {
    if (!row.id) return;
    try {
      const result = await this.gymsService.approveJoinRequest(row.id);
      this.snackBar.open('Request approved.', 'Dismiss', { duration: 2500 });
      // Replace the pending row in-place with the approved version.
      if (result.request) {
        this.upsertRequest(result.request);
      }
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not approve the request.');
    }
  }

  protected async deny(row: GymJoinRequestResponse): Promise<void> {
    if (!row.id) return;
    try {
      const updated = await this.gymsService.denyJoinRequest(row.id);
      this.snackBar.open('Request denied.', 'Dismiss', { duration: 2500 });
      this.upsertRequest(updated);
    } catch (err) {
      showGymError(this.snackBar, err, 'Could not deny the request.');
    }
  }

  protected requesterLabel(row: GymJoinRequestResponse): string {
    return row.athleteId ?? '—';
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
      const list = await this.gymsService.listGymJoinRequests(id, status);
      this.requests.set(list);
    } catch {
      this.error.set('Could not load join requests.');
      this.requests.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private upsertRequest(updated: GymJoinRequestResponse): void {
    if (!updated.id) return;
    this.requests.update((list) => {
      const idx = list.findIndex((r) => r.id === updated.id);
      if (idx === -1) {
        return this.filter() === 'All' || this.filter() === updated.status
          ? [updated, ...list]
          : list;
      }
      if (this.filter() !== 'All' && updated.status !== this.filter()) {
        // Row no longer matches the active filter.
        return list.filter((r) => r.id !== updated.id);
      }
      const next = list.slice();
      next[idx] = updated;
      return next;
    });
  }
}
