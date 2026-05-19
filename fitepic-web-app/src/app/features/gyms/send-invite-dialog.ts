import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';

import { GymRole } from '../../core/api/generated/models/gym-role';

export interface SendInviteDialogData {
  /** Whether the caller can offer the Admin role (Owner-only). */
  canOfferAdmin: boolean;
}

export interface SendInviteDialogResult {
  email: string;
  offeredRole: GymRole;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-send-invite-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  templateUrl: './send-invite-dialog.html',
})
export class SendInviteDialog {
  private readonly dialogRef = inject(MatDialogRef<SendInviteDialog, SendInviteDialogResult>);
  protected readonly data = inject<SendInviteDialogData>(MAT_DIALOG_DATA);

  protected readonly email = signal('');
  protected readonly offeredRole = signal<GymRole>('Athlete');

  protected readonly roleOptions = computed<GymRole[]>(() =>
    this.data.canOfferAdmin ? ['Athlete', 'Coach', 'Admin'] : ['Athlete', 'Coach'],
  );

  protected readonly canSubmit = computed(() => EMAIL_PATTERN.test(this.email().trim()));

  protected onCancel(): void {
    this.dialogRef.close();
  }

  protected onSubmit(): void {
    if (!this.canSubmit()) return;
    this.dialogRef.close({
      email: this.email().trim(),
      offeredRole: this.offeredRole(),
    });
  }
}
