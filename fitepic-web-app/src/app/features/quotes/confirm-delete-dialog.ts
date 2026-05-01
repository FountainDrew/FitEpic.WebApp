import { Component, inject } from '@angular/core';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface ConfirmDeleteDialogData {
  preview: string;
}

@Component({
  selector: 'app-confirm-delete-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Delete quote?</h2>
    <mat-dialog-content>
      <p class="confirm-intro">This quote will be removed from your pool. This cannot be undone.</p>
      <blockquote class="confirm-preview">"{{ data.preview }}"</blockquote>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="dialogRef.close(false)">Cancel</button>
      <button mat-flat-button color="warn" type="button" (click)="dialogRef.close(true)">
        Delete
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .confirm-intro {
        margin: 0 0 12px;
      }
      .confirm-preview {
        margin: 0;
        padding: 12px 14px;
        border-left: 3px solid var(--fe-border);
        background: var(--fe-surface-alt, rgba(0, 0, 0, 0.04));
        font-style: italic;
        color: var(--fe-text);
        opacity: 0.9;
        max-height: 160px;
        overflow: auto;
      }
    `,
  ],
})
export class ConfirmDeleteDialog {
  protected readonly dialogRef = inject(MatDialogRef<ConfirmDeleteDialog, boolean>);
  protected readonly data = inject<ConfirmDeleteDialogData>(MAT_DIALOG_DATA);
}
