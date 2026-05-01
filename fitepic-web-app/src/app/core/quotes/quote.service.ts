import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiConfiguration } from '../api/generated/api-configuration';
import { apiWebappQuotesTodayV1Get } from '../api/generated/fn/web-app-quotes/api-webapp-quotes-today-v-1-get';
import { apiWebappQuotesTodayRefreshV1Post } from '../api/generated/fn/web-app-quotes/api-webapp-quotes-today-refresh-v-1-post';
import { apiWebappQuotesIdPinV1Post } from '../api/generated/fn/web-app-quotes/api-webapp-quotes-id-pin-v-1-post';
import { apiWebappQuotesPinV1Delete } from '../api/generated/fn/web-app-quotes/api-webapp-quotes-pin-v-1-delete';
import { apiWebappQuotesMineV1Get } from '../api/generated/fn/web-app-quotes/api-webapp-quotes-mine-v-1-get';
import { apiWebappQuotesMineV1Post } from '../api/generated/fn/web-app-quotes/api-webapp-quotes-mine-v-1-post';
import { apiWebappQuotesMineIdV1Put } from '../api/generated/fn/web-app-quotes/api-webapp-quotes-mine-id-v-1-put';
import { apiWebappQuotesMineIdV1Delete } from '../api/generated/fn/web-app-quotes/api-webapp-quotes-mine-id-v-1-delete';
import { QuoteOfTheDayResponse } from '../api/generated/models/quote-of-the-day-response';
import { QuoteResponse } from '../api/generated/models/quote-response';
import { PagedQuotesResponse } from '../api/generated/models/paged-quotes-response';

@Injectable({ providedIn: 'root' })
export class QuoteService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);

  // Bumped on every manage-page mutation. Dashboard `getToday()` adds a
  // cache-bust query param when this is non-zero so an HTTP cache (server
  // sends Cache-Control: private, max-age=30 on dashboard reads) cannot
  // serve a stale today response after the user just edited their pool.
  private todayCacheBust = 0;

  invalidateToday(): void {
    this.todayCacheBust++;
  }

  async getToday(): Promise<QuoteOfTheDayResponse | null> {
    if (this.todayCacheBust > 0) {
      const url = `${this.config.rootUrl}/api/webapp/quotes/today/v1`;
      const res = await firstValueFrom(
        this.http.get<QuoteOfTheDayResponse>(url, {
          observe: 'response',
          params: { _cb: String(this.todayCacheBust) },
        }),
      );
      return res.status === 204 ? null : res.body;
    }
    const res = await firstValueFrom(apiWebappQuotesTodayV1Get(this.http, this.config.rootUrl));
    return res.status === 204 ? null : res.body;
  }

  async refreshToday(): Promise<QuoteOfTheDayResponse | null> {
    const res = await firstValueFrom(
      apiWebappQuotesTodayRefreshV1Post(this.http, this.config.rootUrl),
    );
    return res.status === 204 ? null : res.body;
  }

  async pin(quoteId: string): Promise<QuoteOfTheDayResponse> {
    const res = await firstValueFrom(
      apiWebappQuotesIdPinV1Post(this.http, this.config.rootUrl, { id: quoteId }),
    );
    return res.body;
  }

  async unpin(): Promise<QuoteOfTheDayResponse | null> {
    const res = await firstValueFrom(
      apiWebappQuotesPinV1Delete(this.http, this.config.rootUrl),
    );
    return res.status === 204 ? null : res.body;
  }

  async listMine(page = 1, pageSize = 20): Promise<PagedQuotesResponse> {
    const res = await firstValueFrom(
      apiWebappQuotesMineV1Get(this.http, this.config.rootUrl, { page, pageSize }),
    );
    return res.body;
  }

  async createMine(text: string, author: string | null): Promise<QuoteResponse> {
    const res = await firstValueFrom(
      apiWebappQuotesMineV1Post(this.http, this.config.rootUrl, {
        body: { text, author },
      }),
    );
    this.invalidateToday();
    return res.body;
  }

  async updateMine(id: string, text: string, author: string | null): Promise<QuoteResponse> {
    const res = await firstValueFrom(
      apiWebappQuotesMineIdV1Put(this.http, this.config.rootUrl, {
        id,
        body: { text, author },
      }),
    );
    this.invalidateToday();
    return res.body;
  }

  async deleteMine(id: string): Promise<void> {
    await firstValueFrom(
      apiWebappQuotesMineIdV1Delete(this.http, this.config.rootUrl, { id }),
    );
    this.invalidateToday();
  }
}
