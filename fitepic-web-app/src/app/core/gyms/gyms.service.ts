import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiConfiguration } from '../api/generated/api-configuration';
import { apiGymsGet } from '../api/generated/fn/gyms/api-gyms-get';
import { apiGymsPost } from '../api/generated/fn/gyms/api-gyms-post';
import { apiGymsIdGet } from '../api/generated/fn/gyms/api-gyms-id-get';
import { apiGymsIdPatch } from '../api/generated/fn/gyms/api-gyms-id-patch';
import { apiGymsIdDelete } from '../api/generated/fn/gyms/api-gyms-id-delete';
import { apiGymsIdRegenerateCodePost } from '../api/generated/fn/gyms/api-gyms-id-regenerate-code-post';
import { apiAthletesMeGymMembershipsGet } from '../api/generated/fn/gym-memberships/api-athletes-me-gym-memberships-get';
import { apiGymsGymIdMembersGet } from '../api/generated/fn/gym-memberships/api-gyms-gym-id-members-get';
import { apiGymsGymIdMembersAthleteIdPatch } from '../api/generated/fn/gym-memberships/api-gyms-gym-id-members-athlete-id-patch';
import { apiGymsGymIdMembersAthleteIdDelete } from '../api/generated/fn/gym-memberships/api-gyms-gym-id-members-athlete-id-delete';
import { apiGymsGymIdLeavePost } from '../api/generated/fn/gym-memberships/api-gyms-gym-id-leave-post';
import { apiGymsJoinRequestsPost } from '../api/generated/fn/gym-join-requests/api-gyms-join-requests-post';
import { apiGymsGymIdJoinRequestsGet } from '../api/generated/fn/gym-join-requests/api-gyms-gym-id-join-requests-get';
import { apiAthletesMeGymJoinRequestsGet } from '../api/generated/fn/gym-join-requests/api-athletes-me-gym-join-requests-get';
import { apiGymsJoinRequestsIdApprovePost } from '../api/generated/fn/gym-join-requests/api-gyms-join-requests-id-approve-post';
import { apiGymsJoinRequestsIdDenyPost } from '../api/generated/fn/gym-join-requests/api-gyms-join-requests-id-deny-post';
import { apiGymsJoinRequestsIdCancelPost } from '../api/generated/fn/gym-join-requests/api-gyms-join-requests-id-cancel-post';
import { apiGymsGymIdInvitesPost } from '../api/generated/fn/gym-invites/api-gyms-gym-id-invites-post';
import { apiGymsGymIdInvitesGet } from '../api/generated/fn/gym-invites/api-gyms-gym-id-invites-get';
import { apiAthletesMeGymInvitesGet } from '../api/generated/fn/gym-invites/api-athletes-me-gym-invites-get';
import { apiGymsInvitesIdAcceptPost } from '../api/generated/fn/gym-invites/api-gyms-invites-id-accept-post';
import { apiGymsInvitesIdRejectPost } from '../api/generated/fn/gym-invites/api-gyms-invites-id-reject-post';
import { apiGymsInvitesIdRevokePost } from '../api/generated/fn/gym-invites/api-gyms-invites-id-revoke-post';
import { apiGymsGymIdGroupsGet } from '../api/generated/fn/training-groups/api-gyms-gym-id-groups-get';
import { apiGymsGymIdGroupsPost } from '../api/generated/fn/training-groups/api-gyms-gym-id-groups-post';
import { apiGymsGymIdGroupsGroupIdPatch } from '../api/generated/fn/training-groups/api-gyms-gym-id-groups-group-id-patch';
import { apiGymsGymIdGroupsGroupIdDelete } from '../api/generated/fn/training-groups/api-gyms-gym-id-groups-group-id-delete';
import { apiGymsGymIdGroupsGroupIdMembersGet } from '../api/generated/fn/training-groups/api-gyms-gym-id-groups-group-id-members-get';
import { apiGymsGymIdGroupsGroupIdMembersPost } from '../api/generated/fn/training-groups/api-gyms-gym-id-groups-group-id-members-post';
import { apiGymsGymIdGroupsGroupIdMembersAthleteIdDelete } from '../api/generated/fn/training-groups/api-gyms-gym-id-groups-group-id-members-athlete-id-delete';
import { apiGymsGymIdWorkoutsGet } from '../api/generated/fn/gyms/api-gyms-gym-id-workouts-get';
import { apiMobileWorkoutsSyncPost } from '../api/generated/fn/mobile-workouts/api-mobile-workouts-sync-post';
import { ApproveGymJoinRequestResponse } from '../api/generated/models/approve-gym-join-request-response';
import { AcceptGymInviteResponse } from '../api/generated/models/accept-gym-invite-response';
import { CreateGymRequest } from '../api/generated/models/create-gym-request';
import { GymJoinRequestResponse } from '../api/generated/models/gym-join-request-response';
import { GymJoinRequestStatus } from '../api/generated/models/gym-join-request-status';
import { GymMembershipInviteResponse } from '../api/generated/models/gym-membership-invite-response';
import { GymMembershipInviteStatus } from '../api/generated/models/gym-membership-invite-status';
import { GymResponse } from '../api/generated/models/gym-response';
import { GymMembershipResponse } from '../api/generated/models/gym-membership-response';
import { GymRole } from '../api/generated/models/gym-role';
import { SendGymInviteResponse } from '../api/generated/models/send-gym-invite-response';
import { CreateTrainingGroupRequest } from '../api/generated/models/create-training-group-request';
import { TrainingGroupResponse } from '../api/generated/models/training-group-response';
import { TrainingGroupMembershipResponse } from '../api/generated/models/training-group-membership-response';
import { UpdateTrainingGroupRequest } from '../api/generated/models/update-training-group-request';
import { SyncItemResult } from '../api/generated/models/sync-item-result';
import { WorkoutRequest } from '../api/generated/models/workout-request';
import { WorkoutResponse } from '../api/generated/models/workout-response';
import { UpdateGymRequest } from '../api/generated/models/update-gym-request';

type GymRoleFilter = 'member' | 'owner';

/**
 * Thin wrapper over the generated gym-domain clients. Holds the caller's gym list
 * and membership list as signals so feature components can read them reactively
 * and so {@link GymRoleService} can derive the per-gym role map.
 *
 * This service grows per phase — Phase 0 seeds read methods; Phase 2 adds gym
 * CRUD; later phases add invites, groups, etc.
 */
@Injectable({ providedIn: 'root' })
export class GymsService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);

  private readonly gymsSignal = signal<GymResponse[]>([]);
  private readonly membershipsSignal = signal<GymMembershipResponse[]>([]);

  readonly gyms = this.gymsSignal.asReadonly();
  readonly memberships = this.membershipsSignal.asReadonly();

  // ─── Reads ─────────────────────────────────────────────────────────────

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

  async getGym(id: string): Promise<GymResponse> {
    const res = await firstValueFrom(
      apiGymsIdGet(this.http, this.config.rootUrl, { id }),
    );
    const gym = res.body;
    this.upsertGym(gym);
    return gym;
  }

  // ─── Mutations ─────────────────────────────────────────────────────────

  async createGym(body: CreateGymRequest): Promise<GymResponse> {
    const res = await firstValueFrom(
      apiGymsPost(this.http, this.config.rootUrl, { body }),
    );
    const gym = res.body;
    this.upsertGym(gym);
    return gym;
  }

  async updateGym(id: string, body: UpdateGymRequest): Promise<GymResponse> {
    const res = await firstValueFrom(
      apiGymsIdPatch(this.http, this.config.rootUrl, { id, body }),
    );
    const gym = res.body;
    this.upsertGym(gym);
    return gym;
  }

  async deleteGym(id: string): Promise<void> {
    await firstValueFrom(apiGymsIdDelete(this.http, this.config.rootUrl, { id }));
    this.gymsSignal.update((list) => list.filter((g) => g.id !== id));
  }

  async regenerateCode(id: string): Promise<GymResponse> {
    const res = await firstValueFrom(
      apiGymsIdRegenerateCodePost(this.http, this.config.rootUrl, { id }),
    );
    const gym = res.body;
    this.upsertGym(gym);
    return gym;
  }

  // ─── Membership management ─────────────────────────────────────────────

  async listMembers(gymId: string): Promise<GymMembershipResponse[]> {
    const res = await firstValueFrom(
      apiGymsGymIdMembersGet(this.http, this.config.rootUrl, { gymId }),
    );
    return res.body ?? [];
  }

  async changeMemberRole(
    gymId: string,
    athleteId: string,
    role: GymRole,
  ): Promise<GymMembershipResponse> {
    const res = await firstValueFrom(
      apiGymsGymIdMembersAthleteIdPatch(this.http, this.config.rootUrl, {
        gymId,
        athleteId,
        body: { role },
      }),
    );
    return res.body;
  }

  async removeMember(gymId: string, athleteId: string): Promise<void> {
    await firstValueFrom(
      apiGymsGymIdMembersAthleteIdDelete(this.http, this.config.rootUrl, {
        gymId,
        athleteId,
      }),
    );
  }

  async leaveGym(gymId: string): Promise<void> {
    await firstValueFrom(apiGymsGymIdLeavePost(this.http, this.config.rootUrl, { gymId }));
    // Local membership cache: drop any active row for this gym.
    this.membershipsSignal.update((list) =>
      list.filter((m) => !(m.gymId === gymId && !m.isDeleted)),
    );
  }

  // ─── Join requests ─────────────────────────────────────────────────────

  async submitJoinRequest(
    gymCode: string,
    requestedRole: GymRole,
    clientId?: string,
  ): Promise<GymJoinRequestResponse> {
    const res = await firstValueFrom(
      apiGymsJoinRequestsPost(this.http, this.config.rootUrl, {
        body: { gymCode, requestedRole, id: clientId ?? null },
      }),
    );
    return res.body;
  }

  async listGymJoinRequests(
    gymId: string,
    status?: GymJoinRequestStatus,
  ): Promise<GymJoinRequestResponse[]> {
    const res = await firstValueFrom(
      apiGymsGymIdJoinRequestsGet(this.http, this.config.rootUrl, { gymId, status }),
    );
    return res.body ?? [];
  }

  async listMyJoinRequests(): Promise<GymJoinRequestResponse[]> {
    const res = await firstValueFrom(
      apiAthletesMeGymJoinRequestsGet(this.http, this.config.rootUrl),
    );
    return res.body ?? [];
  }

  async approveJoinRequest(id: string): Promise<ApproveGymJoinRequestResponse> {
    const res = await firstValueFrom(
      apiGymsJoinRequestsIdApprovePost(this.http, this.config.rootUrl, { id }),
    );
    return res.body;
  }

  async denyJoinRequest(id: string): Promise<GymJoinRequestResponse> {
    const res = await firstValueFrom(
      apiGymsJoinRequestsIdDenyPost(this.http, this.config.rootUrl, { id }),
    );
    return res.body;
  }

  async cancelJoinRequest(id: string): Promise<GymJoinRequestResponse> {
    const res = await firstValueFrom(
      apiGymsJoinRequestsIdCancelPost(this.http, this.config.rootUrl, { id }),
    );
    return res.body;
  }

  // ─── Invites ───────────────────────────────────────────────────────────

  async sendInvite(
    gymId: string,
    email: string,
    offeredRole: GymRole,
  ): Promise<SendGymInviteResponse> {
    const res = await firstValueFrom(
      apiGymsGymIdInvitesPost(this.http, this.config.rootUrl, {
        gymId,
        body: { email, offeredRole },
      }),
    );
    return res.body;
  }

  async listGymInvites(
    gymId: string,
    status?: GymMembershipInviteStatus,
  ): Promise<GymMembershipInviteResponse[]> {
    const res = await firstValueFrom(
      apiGymsGymIdInvitesGet(this.http, this.config.rootUrl, { gymId, status }),
    );
    return res.body ?? [];
  }

  async listMyInvites(): Promise<GymMembershipInviteResponse[]> {
    const res = await firstValueFrom(
      apiAthletesMeGymInvitesGet(this.http, this.config.rootUrl),
    );
    return res.body ?? [];
  }

  async acceptInvite(id: string): Promise<AcceptGymInviteResponse> {
    const res = await firstValueFrom(
      apiGymsInvitesIdAcceptPost(this.http, this.config.rootUrl, { id }),
    );
    return res.body;
  }

  async rejectInvite(id: string): Promise<GymMembershipInviteResponse> {
    const res = await firstValueFrom(
      apiGymsInvitesIdRejectPost(this.http, this.config.rootUrl, { id }),
    );
    return res.body;
  }

  async revokeInvite(id: string): Promise<GymMembershipInviteResponse> {
    const res = await firstValueFrom(
      apiGymsInvitesIdRevokePost(this.http, this.config.rootUrl, { id }),
    );
    return res.body;
  }

  // ─── Training groups ───────────────────────────────────────────────────

  async listGroups(gymId: string): Promise<TrainingGroupResponse[]> {
    const res = await firstValueFrom(
      apiGymsGymIdGroupsGet(this.http, this.config.rootUrl, { gymId }),
    );
    return res.body ?? [];
  }

  async createGroup(
    gymId: string,
    body: CreateTrainingGroupRequest,
  ): Promise<TrainingGroupResponse> {
    const res = await firstValueFrom(
      apiGymsGymIdGroupsPost(this.http, this.config.rootUrl, { gymId, body }),
    );
    return res.body;
  }

  async updateGroup(
    gymId: string,
    groupId: string,
    body: UpdateTrainingGroupRequest,
  ): Promise<TrainingGroupResponse> {
    const res = await firstValueFrom(
      apiGymsGymIdGroupsGroupIdPatch(this.http, this.config.rootUrl, { gymId, groupId, body }),
    );
    return res.body;
  }

  async deleteGroup(gymId: string, groupId: string): Promise<void> {
    await firstValueFrom(
      apiGymsGymIdGroupsGroupIdDelete(this.http, this.config.rootUrl, { gymId, groupId }),
    );
  }

  async listGroupMembers(
    gymId: string,
    groupId: string,
  ): Promise<TrainingGroupMembershipResponse[]> {
    const res = await firstValueFrom(
      apiGymsGymIdGroupsGroupIdMembersGet(this.http, this.config.rootUrl, { gymId, groupId }),
    );
    return res.body ?? [];
  }

  async assignToGroup(
    gymId: string,
    groupId: string,
    athleteId: string,
  ): Promise<TrainingGroupMembershipResponse> {
    const res = await firstValueFrom(
      apiGymsGymIdGroupsGroupIdMembersPost(this.http, this.config.rootUrl, {
        gymId,
        groupId,
        body: { athleteId },
      }),
    );
    return res.body;
  }

  async removeFromGroup(
    gymId: string,
    groupId: string,
    athleteId: string,
  ): Promise<void> {
    await firstValueFrom(
      apiGymsGymIdGroupsGroupIdMembersAthleteIdDelete(this.http, this.config.rootUrl, {
        gymId,
        groupId,
        athleteId,
      }),
    );
  }

  // ─── Gym workouts ──────────────────────────────────────────────────────

  async listGymWorkouts(
    gymId: string,
    options?: { includeArchived?: boolean; includeDeleted?: boolean },
  ): Promise<WorkoutResponse[]> {
    const res = await firstValueFrom(
      apiGymsGymIdWorkoutsGet(this.http, this.config.rootUrl, {
        gymId,
        includeArchived: options?.includeArchived,
        includeDeleted: options?.includeDeleted,
      }),
    );
    return res.body ?? [];
  }

  /**
   * Submits a single-element batch to the workouts sync endpoint. Returns the
   * per-row `SyncItemResult` so callers can branch on `BlockedByHistory` (gym
   * workout delete blocked by completed history) or `Forbidden`.
   */
  async syncWorkout(payload: WorkoutRequest): Promise<SyncItemResult | null> {
    const res = await firstValueFrom(
      apiMobileWorkoutsSyncPost(this.http, this.config.rootUrl, { body: [payload] }),
    );
    return res.body?.results?.[0] ?? null;
  }

  clear(): void {
    this.gymsSignal.set([]);
    this.membershipsSignal.set([]);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private upsertGym(gym: GymResponse): void {
    if (!gym.id) return;
    this.gymsSignal.update((list) => {
      const idx = list.findIndex((g) => g.id === gym.id);
      if (idx === -1) return [...list, gym];
      const next = list.slice();
      next[idx] = gym;
      return next;
    });
  }
}
