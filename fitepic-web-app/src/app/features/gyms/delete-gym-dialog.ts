import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

export interface DeleteGymDialogData {
  gymName: string;
}

@Component({
  selector: 'app-delete-gym-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './delete-gym-dialog.html',
})
export class DeleteGymDialog {
  private readonly dialogRef = inject(MatDialogRef<DeleteGymDialog, boolean>);
  protected readonly data = inject<DeleteGymDialogData>(MAT_DIALOG_DATA);
  protected readonly typedName = signal('');

  protected readonly canDelete = computed(
    () => this.typedName().trim() === this.data.gymName.trim(),
  );

  protected onCancel(): void {
    this.dialogRef.close(false);
  }

  protected onConfirm(): void {
    if (!this.canDelete()) return;
    this.dialogRef.close(true);
  }
}
