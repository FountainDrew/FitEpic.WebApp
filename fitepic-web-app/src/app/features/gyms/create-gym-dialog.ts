import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

export interface CreateGymDialogResult {
  name: string;
  description: string | null;
}

const NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;

@Component({
  selector: 'app-create-gym-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './create-gym-dialog.html',
})
export class CreateGymDialog {
  private readonly dialogRef = inject(MatDialogRef<CreateGymDialog, CreateGymDialogResult>);

  protected readonly name = signal('');
  protected readonly description = signal('');

  protected readonly nameMax = NAME_MAX;
  protected readonly descriptionMax = DESCRIPTION_MAX;

  protected readonly canSave = computed(() => {
    const len = this.name().trim().length;
    return len > 0 && len <= NAME_MAX && this.description().length <= DESCRIPTION_MAX;
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
