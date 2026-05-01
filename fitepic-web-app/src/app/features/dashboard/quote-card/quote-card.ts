import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';

import { QuoteService } from '../../../core/quotes/quote.service';
import { QuoteOfTheDayResponse } from '../../../core/api/generated/models/quote-of-the-day-response';

@Component({
  selector: 'app-quote-card',
  imports: [MatCardModule, MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './quote-card.html',
  styleUrl: './quote-card.scss',
})
export class QuoteCard implements OnInit {
  private readonly quotes = inject(QuoteService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly today = signal<QuoteOfTheDayResponse | null>(null);
  protected readonly loading = signal(true);
  // Whether to suppress the entire card. Set on 204 (empty pool) or non-204 errors.
  protected readonly suppressed = signal(false);
  protected readonly busy = signal(false);

  protected readonly isPinned = computed(() => this.today()?.isPinned === true);
  protected readonly text = computed(() => this.today()?.quote?.text ?? '');
  protected readonly author = computed(() => this.today()?.quote?.author ?? null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.quotes.getToday();
      if (!res || !res.quote) {
        this.suppressed.set(true);
        this.today.set(null);
      } else {
        this.suppressed.set(false);
        this.today.set(res);
      }
    } catch {
      // Decorative widget — silently suppress on any error rather than blocking the dashboard.
      this.suppressed.set(true);
      this.today.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected async onRefresh(): Promise<void> {
    if (this.busy() || this.isPinned()) return;
    const previous = this.today();
    this.busy.set(true);
    try {
      const res = await this.quotes.refreshToday();
      if (!res || !res.quote) {
        // Pool went empty between the initial load and the refresh — suppress the card.
        this.suppressed.set(true);
        this.today.set(null);
      } else {
        this.today.set(res);
      }
    } catch {
      this.today.set(previous);
      this.snackBar.open('Could not load a new quote. Try again.', 'Dismiss', { duration: 3000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected async onTogglePin(): Promise<void> {
    if (this.busy()) return;
    const previous = this.today();
    if (!previous?.quote?.id) return;

    // Optimistic toggle of the pin flag for instant feedback.
    this.today.set({ ...previous, isPinned: !previous.isPinned });
    this.busy.set(true);
    try {
      const res = previous.isPinned
        ? await this.quotes.unpin()
        : await this.quotes.pin(previous.quote.id);
      if (res?.quote) {
        this.today.set(res);
      } else {
        // unpin returned 204 (no current pin) — keep the optimistic update which already cleared the flag.
        this.today.set({ ...previous, isPinned: false });
      }
    } catch {
      this.today.set(previous);
      this.snackBar.open('Could not update the pin. Try again.', 'Dismiss', { duration: 3000 });
    } finally {
      this.busy.set(false);
    }
  }
}
