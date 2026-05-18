import { Injectable, Signal, computed, inject } from '@angular/core';

import { ProfileService } from '../profile/profile.service';
import { EffectiveGymRole, buildRoleMap } from './gym-role';
import { GymsService } from './gyms.service';

/**
 * Reactive lookup of the caller's effective role in each gym they belong to.
 * Built from {@link GymsService.gyms}, {@link GymsService.memberships}, and the
 * caller's athlete ID via {@link ProfileService.profile}.
 *
 * Consumers read {@link roles} for a `{ gymId → role }` map, or call
 * {@link forGym} for a single gym lookup. The service does not fetch on its own —
 * components are responsible for calling {@link GymsService.bootstrap} (or the
 * targeted load methods) at the right time.
 */
@Injectable({ providedIn: 'root' })
export class GymRoleService {
  private readonly gyms = inject(GymsService);
  private readonly profile = inject(ProfileService);

  readonly roles: Signal<Record<string, EffectiveGymRole>> = computed(() =>
    buildRoleMap(this.gyms.gyms(), this.gyms.memberships(), this.profile.profile()?.id ?? null),
  );

  forGym(gymId: string | null | undefined): EffectiveGymRole | null {
    if (!gymId) return null;
    return this.roles()[gymId] ?? null;
  }
}
