import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

export interface TrainingGroupDialogData {
  mode: 'create' | 'edit';
  name?: string;
  description?: string | null;
}

export interface TrainingGroupDialogResult {
  name: string;
  description: string | null;
}

const NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;

@Component({
  selector: 'app-training-group-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.mode === 'create' ? 'Create training group' : 'Edit group' }}</h2>
    <mat-dialog-content>
      <form class="dialog-form" (ngSubmit)="onSave()">
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input
            matInput
            name="name"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
            [maxlength]="nameMax"
            required
            autocomplete="off"
          />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Description (optional)</mat-label>
          <textarea
            matInput
            name="description"
            [ngModel]="description()"
            (ngModelChange)="description.set($event)"
            [maxlength]="descriptionMax"
            rows="3"
          ></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button
        mat-flat-button
        color="primary"
        [disabled]="!canSave()"
        (click)="onSave()"
      >
        {{ data.mode === 'create' ? 'Create' : 'Save' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class TrainingGroupDialog {
  private readonly dialogRef =
    inject(MatDialogRef<TrainingGroupDialog, TrainingGroupDialogResult>);
  protected readonly data = inject<TrainingGroupDialogData>(MAT_DIALOG_DATA);

  protected readonly name = signal(this.data.name ?? '');
  protected readonly description = signal(this.data.description ?? '');
  protected readonly nameMax = NAME_MAX;
  protected readonly descriptionMax = DESCRIPTION_MAX;

  protected readonly canSave = computed(() => {
    const len = this.name().trim().length;
    if (len === 0 || len > NAME_MAX) return false;
    if (this.description().length > DESCRIPTION_MAX) return false;
    if (this.data.mode === 'edit') {
      const nameUnchanged = this.name().trim() === (this.data.name?.trim() ?? '');
      const descUnchanged =
        this.description().trim() === (this.data.description?.trim() ?? '');
      if (nameUnchanged && descUnchanged) return false;
    }
    return true;
  });

  protected onCancel(): void {
    this.dialogRef.close();
  }
  protected onSave(): void {
    if (!this.canSave()) return;
    const trimmedDesc = this.description().trim();
    this.dialogRef.close({
      name: this.name().trim(),
      description: trimmedDesc.length === 0 ? null : trimmedDesc,
    });
  }
}
