import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';

export interface InfoDialogData {
  title: string;
  body: string;
  dismissLabel?: string;
}

@Component({
  selector: 'app-info-dialog',
  imports: [MatDialogModule, MatButtonModule],
  templateUrl: './info-dialog.html',
  styleUrl: './info-dialog.scss',
})
export class InfoDialog {
  protected readonly data = inject<InfoDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<InfoDialog>);

  protected get dismissLabel(): string {
    return this.data.dismissLabel ?? 'Got it';
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
