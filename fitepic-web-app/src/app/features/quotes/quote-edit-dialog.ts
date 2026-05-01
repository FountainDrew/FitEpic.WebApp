import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

import { QuoteResponse } from '../../core/api/generated/models/quote-response';

export interface QuoteEditDialogData {
  // Existing quote when editing; omitted (or null) when creating.
  quote?: QuoteResponse | null;
}

export interface QuoteEditDialogResult {
  text: string;
  author: string | null;
}

const TEXT_MAX = 1000;
const AUTHOR_MAX = 200;

@Component({
  selector: 'app-quote-edit-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './quote-edit-dialog.html',
  styleUrl: './quote-edit-dialog.scss',
})
export class QuoteEditDialog {
  private readonly dialogRef = inject(MatDialogRef<QuoteEditDialog, QuoteEditDialogResult>);
  private readonly data = inject<QuoteEditDialogData>(MAT_DIALOG_DATA);

  protected readonly isEdit = !!this.data?.quote?.id;

  protected readonly text = signal(this.data?.quote?.text ?? '');
  protected readonly author = signal(this.data?.quote?.author ?? '');

  protected readonly textMax = TEXT_MAX;
  protected readonly authorMax = AUTHOR_MAX;

  protected readonly textTrimmedLength = computed(() => this.text().trim().length);
  protected readonly authorTrimmedLength = computed(() => this.author().trim().length);

  protected readonly textInvalid = computed(() => {
    const len = this.textTrimmedLength();
    return len === 0 || len > TEXT_MAX;
  });
  protected readonly authorInvalid = computed(() => this.authorTrimmedLength() > AUTHOR_MAX);
  protected readonly canSave = computed(() => !this.textInvalid() && !this.authorInvalid());

  protected onCancel(): void {
    this.dialogRef.close();
  }

  protected onSave(): void {
    if (!this.canSave()) return;
    const trimmedAuthor = this.author().trim();
    this.dialogRef.close({
      text: this.text().trim(),
      author: trimmedAuthor.length === 0 ? null : trimmedAuthor,
    });
  }
}
