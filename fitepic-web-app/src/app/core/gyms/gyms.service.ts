import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiConfiguration } from '../api/generated/api-configuration';
import { apiGymsGet } from '../api/generated/fn/gyms/api-gyms-get';
import { apiAthletesMeGymMembershipsGet } from '../api/generated/fn/gym-memberships/api-athletes-me-gym-memberships-get';
import { GymResponse } from '../api/generated/models/gym-response';
import { GymMembershipResponse } from '../api/generated/models/gym-membership-response';

type GymRoleFilter = 'member' | 'owner';

/**
 * Thin wrapper over the generated `Gyms` and `GymMemberships` clients. Holds the
 * caller's gym list and membership list as signals so feature components can read
 * them reactively and so {@link GymRoleService} can derive the per-gym role map.
 *
 * This service grows per phase — Phase 0 seeds it with the read methods needed
 * for role computation. CRUD/mutation methods are added in their respective
 * phases (gym CRUD in Phase 2, membership management in Phase 3, etc).
 */
@Injectable({ providedIn: 'root' })
export class GymsService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);

  private readonly gymsSignal = signal<GymResponse[]>([]);
  private readonly membershipsSignal = signal<GymMembershipResponse[]>([]);

  readonly gyms = this.gymsSignal.asReadonly();
  readonly memberships = this.membershipsSignal.asReadonly();

  async loadMyGyms(role: GymRoleFilter = 'member'): Promise<GymResponse[]> {
    const res = await firstValueFrom(
      apiGymsGet(this.http, this.config.rootUrl, { role }),
    );
    const body = res.body ?? [];
    this.gymsSignal.set(body);
    return body;
  }

  async loadMyMemberships(): Promise<GymMembershipResponse[]> {
    const res = await firstValueFrom(
      apiAthletesMeGymMembershipsGet(this.http, this.config.rootUrl),
    );
    const body = res.body ?? [];
    this.membershipsSignal.set(body);
    return body;
  }

  /** Loads both gyms and memberships in parallel. */
  async bootstrap(): Promise<void> {
    await Promise.all([this.loadMyGyms(), this.loadMyMemberships()]);
  }

  clear(): void {
    this.gymsSignal.set([]);
    this.membershipsSignal.set([]);
  }
}
