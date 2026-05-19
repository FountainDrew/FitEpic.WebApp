import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiConfiguration } from '../api/generated/api-configuration';
import { standardExercisesGet } from '../api/generated/fn/standard-exercises/standard-exercises-get';
import { StandardExerciseResponse } from '../api/generated/models/standard-exercise-response';

/**
 * Pulls and caches the standard exercise catalog for the authoring flow's
 * exercise picker. The catalog is small and changes rarely, so we pull all
 * pages on first request and serve subsequent calls from memory.
 */
@Injectable({ providedIn: 'root' })
export class StandardExercisesService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);

  private readonly exercisesSignal = signal<StandardExerciseResponse[]>([]);
  private loadedPromise: Promise<StandardExerciseResponse[]> | null = null;

  readonly exercises = this.exercisesSignal.asReadonly();

  /** Loads and caches the full catalog. Subsequent calls return the cache. */
  async ensureLoaded(): Promise<StandardExerciseResponse[]> {
    if (this.exercisesSignal().length > 0) return this.exercisesSignal();
    if (this.loadedPromise) return this.loadedPromise;
    this.loadedPromise = this.fetchAll().finally(() => {
      this.loadedPromise = null;
    });
    return this.loadedPromise;
  }

  private async fetchAll(): Promise<StandardExerciseResponse[]> {
    const out: StandardExerciseResponse[] = [];
    let page = 1;
    const pageSize = 200;
    while (page <= 50) {
      const res = await firstValueFrom(
        standardExercisesGet(this.http, this.config.rootUrl, { page, pageSize }),
      );
      const items = (res.body?.items ?? []).filter((e) => !e.isDeleted);
      out.push(...items);
      const totalPages = res.body?.totalPages ?? 0;
      if (page >= totalPages || items.length === 0) break;
      page += 1;
    }
    out.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    this.exercisesSignal.set(out);
    return out;
  }
}
