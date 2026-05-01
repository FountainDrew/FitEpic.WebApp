import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { QuoteService } from '../../core/quotes/quote.service';
import { QuoteResponse } from '../../core/api/generated/models/quote-response';
import { getWebAppErrorMessage } from '../../core/api/error-code';

import {
  QuoteEditDialog,
  QuoteEditDialogData,
  QuoteEditDialogResult,
} from './quote-edit-dialog';
import { ConfirmDeleteDialog, ConfirmDeleteDialogData } from './confirm-delete-dialog';

const PREVIEW_MAX = 120;

@Component({
  selector: 'app-manage-quotes-page',
  imports: [
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatPaginatorModule,
  ],
  templateUrl: './manage-quotes-page.html',
  styleUrl: './manage-quotes-page.scss',
})
export class ManageQuotesPage implements OnInit {
  private readonly quotes = inject(QuoteService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly items = signal<QuoteResponse[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(20);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly hasItems = computed(() => this.items().length > 0);
  protected readonly pageIndex = computed(() => this.page() - 1);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected async retry(): Promise<void> {
    await this.load();
  }

  protected async onPageChange(event: PageEvent): Promise<void> {
    this.page.set(event.pageIndex + 1);
    this.pageSize.set(event.pageSize);
    await this.load();
  }

  protected async openCreate(): Promise<void> {
    const result = await this.openEditor({ quote: null });
    if (!result) return;
    try {
      await this.quotes.createMine(result.text, result.author);
      this.snackBar.open('Quote added.', 'Dismiss', { duration: 2500 });
      this.page.set(1);
      await this.load();
    } catch (err) {
      this.snackBar.open(this.errorMessage(err, 'Could not add the quote.'), 'Dismiss', {
        duration: 4000,
      });
    }
  }

  protected async openEdit(quote: QuoteResponse): Promise<void> {
    const result = await this.openEditor({ quote });
    if (!result || !quote.id) return;
    try {
      await this.quotes.updateMine(quote.id, result.text, result.author);
      this.snackBar.open('Quote updated.', 'Dismiss', { duration: 2500 });
      await this.load();
    } catch (err) {
      this.snackBar.open(this.errorMessage(err, 'Could not update the quote.'), 'Dismiss', {
        duration: 4000,
      });
    }
  }

  protected async confirmDelete(quote: QuoteResponse): Promise<void> {
    if (!quote.id) return;
    const preview = this.preview(quote.text);
    const confirmed = await this.dialog
      .open<ConfirmDeleteDialog, ConfirmDeleteDialogData, boolean>(ConfirmDeleteDialog, {
        data: { preview },
      })
      .afterClosed()
      .toPromise();
    if (!confirmed) return;
    try {
      await this.quotes.deleteMine(quote.id);
      this.snackBar.open('Quote deleted.', 'Dismiss', { duration: 2500 });
      // If we just removed the last item on a non-first page, step back one page so the
      // paginator does not show an empty page after reload.
      if (this.items().length === 1 && this.page() > 1) {
        this.page.update((p) => p - 1);
      }
      await this.load();
    } catch (err) {
      this.snackBar.open(this.errorMessage(err, 'Could not delete the quote.'), 'Dismiss', {
        duration: 4000,
      });
    }
  }

  protected authorLine(quote: QuoteResponse): string | null {
    return quote.author?.trim() ? `— ${quote.author}` : null;
  }

  private preview(text: string | null | undefined): string {
    const t = (text ?? '').trim();
    if (t.length <= PREVIEW_MAX) return t;
    return `${t.slice(0, PREVIEW_MAX).trimEnd()}…`;
  }

  private async openEditor(data: QuoteEditDialogData): Promise<QuoteEditDialogResult | undefined> {
    return await this.dialog
      .open<QuoteEditDialog, QuoteEditDialogData, QuoteEditDialogResult>(QuoteEditDialog, {
        data,
        width: '520px',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .toPromise();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.quotes.listMine(this.page(), this.pageSize());
      this.items.set(res.items ?? []);
      this.totalCount.set(res.totalCount ?? 0);
    } catch {
      this.error.set('Could not load your quotes. Try again.');
      this.items.set([]);
      this.totalCount.set(0);
    } finally {
      this.loading.set(false);
    }
  }

  private errorMessage(err: unknown, fallback: string): string {
    return getWebAppErrorMessage(err) ?? fallback;
  }
}
