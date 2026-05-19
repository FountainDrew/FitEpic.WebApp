import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

export interface EditGymDialogData {
  name: string;
  description: string | null;
}

export interface EditGymDialogResult {
  name: string;
  description: string | null;
}

const NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;

@Component({
  selector: 'app-edit-gym-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './edit-gym-dialog.html',
})
export class EditGymDialog {
  private readonly dialogRef = inject(MatDialogRef<EditGymDialog, EditGymDialogResult>);
  private readonly data = inject<EditGymDialogData>(MAT_DIALOG_DATA);

  protected readonly name = signal(this.data.name);
  protected readonly description = signal(this.data.description ?? '');

  protected readonly nameMax = NAME_MAX;
  protected readonly descriptionMax = DESCRIPTION_MAX;

  protected readonly canSave = computed(() => {
    const len = this.name().trim().length;
    if (len === 0 || len > NAME_MAX) return false;
    if (this.description().length > DESCRIPTION_MAX) return false;
    const nameUnchanged = this.name().trim() === this.data.name.trim();
    const descUnchanged =
      this.description().trim() === (this.data.description?.trim() ?? '');
    return !(nameUnchanged && descUnchanged);
  });

  protected onCancel(): void {
    this.dialogRef.close();
  }

  protected onSave(): void {
    if (!this.canSave()) return;
    const trimmedDescription = this.description().trim();
    this.dialogRef.close({
      name: this.name().trim(),
      description: trimmedDescription.length === 0 ? null : trimmedDescription,
    });
  }
}
