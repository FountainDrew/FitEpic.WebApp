import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiConfiguration } from '../../core/api/generated/api-configuration';
import { apiWebappScheduleCalendarV1Get } from '../../core/api/generated/fn/web-app-schedule/api-webapp-schedule-calendar-v-1-get';
import { apiWebappScheduleListV1Get } from '../../core/api/generated/fn/web-app-schedule/api-webapp-schedule-list-v-1-get';
import { CalendarScheduleResponse } from '../../core/api/generated/models/calendar-schedule-response';
import { ScheduleListResponse } from '../../core/api/generated/models/schedule-list-response';

export interface ScheduleListParams {
  pastCursor?: string;
  futureCursor?: string;
  pastLimit?: number;
  futureLimit?: number;
}

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);

  async loadCalendar(year: number, month: number): Promise<CalendarScheduleResponse> {
    const res = await firstValueFrom(
      apiWebappScheduleCalendarV1Get(this.http, this.config.rootUrl, { year, month }),
    );
    return res.body;
  }

  async loadList(params: ScheduleListParams = {}): Promise<ScheduleListResponse> {
    const res = await firstValueFrom(
      apiWebappScheduleListV1Get(this.http, this.config.rootUrl, params),
    );
    return res.body;
  }
}
