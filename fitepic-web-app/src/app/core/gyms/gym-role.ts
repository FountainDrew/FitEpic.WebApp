import { GymResponse } from '../api/generated/models/gym-response';
import { GymMembershipResponse } from '../api/generated/models/gym-membership-response';
import { GymRole } from '../api/generated/models/gym-role';

/**
 * The full set of roles an athlete can hold in a single gym, as understood by the
 * web app. `Owner` is NOT a value of the wire {@link GymRole} enum — the API
 * identifies the Owner solely via `Gym.OwnerAthleteId` and the Owner has no
 * `GymMembership` row. The web app folds Owner into a single effective-role type
 * so UI components can switch on one value.
 */
export type EffectiveGymRole = 'Owner' | 'Admin' | 'Coach' | 'Athlete';

const RANK: Record<EffectiveGymRole, number> = {
  Athlete: 0,
  Coach: 1,
  Admin: 2,
  Owner: 3,
};

/**
 * Resolves the caller's effective role in a single gym from the gym row plus the
 * caller's membership row (if any) for that gym. Returns null when the caller
 * has no relationship to the gym.
 */
export function computeEffectiveRole(
  gym: Pick<GymResponse, 'ownerAthleteId'> | null | undefined,
  membership: Pick<GymMembershipResponse, 'role' | 'isDeleted'> | null | undefined,
  myAthleteId: string | null | undefined,
): EffectiveGymRole | null {
  if (!myAthleteId) return null;
  if (gym?.ownerAthleteId === myAthleteId) return 'Owner';
  if (!membership || membership.isDeleted) return null;
  return promoteWireRole(membership.role);
}

/**
 * Builds a `{ gymId → role }` map for every gym the caller has any active
 * relationship with. Gyms with no caller relationship are omitted.
 */
export function buildRoleMap(
  gyms: ReadonlyArray<GymResponse>,
  memberships: ReadonlyArray<GymMembershipResponse>,
  myAthleteId: string | null | undefined,
): Record<string, EffectiveGymRole> {
  const result: Record<string, EffectiveGymRole> = {};
  if (!myAthleteId) return result;

  const myMembershipsByGym = new Map<string, GymMembershipResponse>();
  for (const m of memberships) {
    if (!m.gymId || m.isDeleted || m.athleteId !== myAthleteId) continue;
    myMembershipsByGym.set(m.gymId, m);
  }

  for (const g of gyms) {
    if (!g.id || g.isDeleted) continue;
    const role = computeEffectiveRole(g, myMembershipsByGym.get(g.id) ?? null, myAthleteId);
    if (role) result[g.id] = role;
  }
  return result;
}

export function hasAtLeast(role: EffectiveGymRole | null, minimum: EffectiveGymRole): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[minimum];
}

export const canManageGym = (role: EffectiveGymRole | null): boolean => hasAtLeast(role, 'Admin');
export const canProgramWorkouts = (role: EffectiveGymRole | null): boolean =>
  hasAtLeast(role, 'Coach');
export const canViewRoster = (role: EffectiveGymRole | null): boolean => hasAtLeast(role, 'Coach');
export const isOwner = (role: EffectiveGymRole | null): boolean => role === 'Owner';

function promoteWireRole(role: GymRole | undefined): EffectiveGymRole | null {
  switch (role) {
    case 'Admin':
    case 'Coach':
    case 'Athlete':
      return role;
    default:
      return null;
  }
}
