import { Signal, signal } from '@angular/core';

/**
 * A guarded async runner that exposes a `pending` signal. Use one per mutating
 * action on a component to prevent double-submit while a request is in flight,
 * since the gym-domain endpoints do not accept client-supplied idempotency keys
 * (see contract §12 Q8). Calls to `run()` while pending are dropped and resolve
 * to `undefined`.
 *
 * ```ts
 * private readonly saveAction = createPendingAction<GymResponse>();
 * protected readonly saving = this.saveAction.pending;
 *
 * async onSave() {
 *   await this.saveAction.run(() => this.gyms.create({ name }));
 * }
 * ```
 *
 * ```html
 * <button mat-button (click)="onSave()" [disabled]="saving()">Save</button>
 * ```
 */
export interface PendingAction<T> {
  readonly pending: Signal<boolean>;
  run(work: () => Promise<T>): Promise<T | undefined>;
}

export function createPendingAction<T = void>(): PendingAction<T> {
  const pending = signal(false);
  return {
    pending: pending.asReadonly(),
    async run(work: () => Promise<T>): Promise<T | undefined> {
      if (pending()) return undefined;
      pending.set(true);
      try {
        return await work();
      } finally {
        pending.set(false);
      }
    },
  };
}
