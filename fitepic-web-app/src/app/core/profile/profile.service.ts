import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiConfiguration } from '../api/generated/api-configuration';
import { apiWebappAthletesProfileV1Get } from '../api/generated/fn/web-app-athletes/api-webapp-athletes-profile-v-1-get';
import { apiWebappAthletesProfileV1Put } from '../api/generated/fn/web-app-athletes/api-webapp-athletes-profile-v-1-put';
import { apiGymsMeOwnerFlagPut } from '../api/generated/fn/gyms/api-gyms-me-owner-flag-put';
import { MyAthleteProfileResponse } from '../api/generated/models/my-athlete-profile-response';
import { UpdateMyAthleteProfileRequest } from '../api/generated/models/update-my-athlete-profile-request';

/**
 * Tri-state per-field semantics on the wire (server contract):
 *   - key omitted   → leave unchanged
 *   - key = null    → clear
 *   - key = <value> → set
 *
 * `displayName` is required on every PUT.
 */
export interface ProfileUpdate {
  displayName: string;
  timezone?: string | null;
  /** ISO date `YYYY-MM-DD`. */
  streakAndDayCountStartDate?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);

  private readonly profileSignal = signal<MyAthleteProfileResponse | null>(null);
  readonly profile = this.profileSignal.asReadonly();

  async load(): Promise<MyAthleteProfileResponse> {
    const res = await firstValueFrom(
      apiWebappAthletesProfileV1Get(this.http, this.config.rootUrl),
    );
    this.profileSignal.set(res.body);
    return res.body;
  }

  async update(updates: ProfileUpdate): Promise<MyAthleteProfileResponse> {
    // Only spread keys that were explicitly provided so omitted fields keep
    // their server-side value (tri-state partial-update contract).
    const body: Record<string, unknown> = { displayName: updates.displayName };
    if ('timezone' in updates) body['timezone'] = updates.timezone;
    if ('streakAndDayCountStartDate' in updates) {
      body['streakAndDayCountStartDate'] = updates.streakAndDayCountStartDate;
    }

    const res = await firstValueFrom(
      apiWebappAthletesProfileV1Put(this.http, this.config.rootUrl, {
        body: body as unknown as UpdateMyAthleteProfileRequest,
      }),
    );
    this.profileSignal.set(res.body);
    return res.body;
  }

  /**
   * Toggles the caller's `IsGymOwner` flag via `PUT /api/gyms/me/owner-flag`.
   * On success, patches the in-memory profile from the response — the profile GET
   * is `Cache-Control: private, max-age=60`, so a refetch would race the cache; the
   * optimistic update keeps the UI in sync without a follow-up request. On failure
   * (e.g., `GymsStillOwned` when toggling off), the in-memory state is left
   * untouched and the caller decides how to surface the error.
   */
  async setGymOwnerFlag(value: boolean): Promise<MyAthleteProfileResponse> {
    const res = await firstValueFrom(
      apiGymsMeOwnerFlagPut(this.http, this.config.rootUrl, {
        body: { isGymOwner: value },
      }),
    );
    const persisted = res.body?.isGymOwner ?? value;
    const current = this.profileSignal();
    const next: MyAthleteProfileResponse = current
      ? { ...current, isGymOwner: persisted }
      : { isGymOwner: persisted };
    this.profileSignal.set(next);
    return next;
  }

  /**
   * Loads the profile (if not already loaded) and auto-sets the timezone from
   * the browser when the API has none on file.
   */
  async ensureTimezone(): Promise<MyAthleteProfileResponse> {
    let profile = this.profileSignal() ?? (await this.load());
    if (!profile.timezone) {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      profile = await this.update({
        displayName: profile.displayName ?? '',
        timezone: browserTz,
      });
    }
    return profile;
  }

  clear(): void {
    this.profileSignal.set(null);
  }
}
