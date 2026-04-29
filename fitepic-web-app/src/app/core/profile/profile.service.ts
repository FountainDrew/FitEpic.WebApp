import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiConfiguration } from '../api/generated/api-configuration';
import { apiWebappAthletesProfileV1Get } from '../api/generated/fn/web-app-athletes/api-webapp-athletes-profile-v-1-get';
import { apiWebappAthletesProfileV1Put } from '../api/generated/fn/web-app-athletes/api-webapp-athletes-profile-v-1-put';
import { MyAthleteProfileResponse } from '../api/generated/models/my-athlete-profile-response';

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

  async update(displayName: string, timezone: string | null): Promise<MyAthleteProfileResponse> {
    const res = await firstValueFrom(
      apiWebappAthletesProfileV1Put(this.http, this.config.rootUrl, {
        body: { displayName, timezone },
      }),
    );
    this.profileSignal.set(res.body);
    return res.body;
  }

  /**
   * Loads the profile (if not already loaded) and auto-sets the timezone from
   * the browser when the API has none on file.
   */
  async ensureTimezone(): Promise<MyAthleteProfileResponse> {
    let profile = this.profileSignal() ?? (await this.load());
    if (!profile.timezone) {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      profile = await this.update(profile.displayName ?? '', browserTz);
    }
    return profile;
  }

  clear(): void {
    this.profileSignal.set(null);
  }
}
