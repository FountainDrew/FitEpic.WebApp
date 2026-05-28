import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';

import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { AthleteResultEntryResponse } from '../../../core/api/generated/models/athlete-result-entry-response';

export interface AthletePickerDialogData {
  /**
   * The full unified list from Q66 — every athlete in scope for this group
   * workout, plus their result (or null). Already-logged athletes render
   * with an "Edit logs" affordance instead of "Log."
   */
  athletes: AthleteResultEntryResponse[];
  /** Workout name for the dialog title. */
  workoutName: string;
  /** Scheduled date in ISO `YYYY-MM-DD` for the subtitle, or null. */
  scheduledDate: string | null;
}

export interface AthletePickerDialogResult {
  athleteId: string;
}

/**
 * Athlete picker used by the gym schedule drawer's "Log athlete result"
 * action. Lists every current group athlete; already-logged athletes are
 * surfaced with their score and an "Edit" verb so a coach can re-enter the
 * log flow from a single picker rather than juggling separate UIs for "log
 * new" vs "edit existing." Historical completers (members who left the
 * group) are not pickable — their results live in their personal history
 * and the coach can't add new entries against them.
 */
@Component({
  selector: 'app-athlete-picker-dialog',
  imports: [
    DatePipe,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './athlete-picker-dialog.html',
  styleUrl: './athlete-picker-dialog.scss',
})
export class AthletePickerDialog {
  private readonly dialogRef =
    inject(MatDialogRef<AthletePickerDialog, AthletePickerDialogResult>);
  protected readonly data = inject<AthletePickerDialogData>(MAT_DIALOG_DATA);

  protected readonly query = signal('');

  /**
   * Current group athletes only — historical completers (no current
   * membership) are filtered out because the coach can't add a new result
   * for them. Sorted: unlogged first (since logging is the common verb),
   * then logged athletes by display name.
   */
  protected readonly visibleAthletes = computed(() => {
    const q = this.query().trim().toLowerCase();
    const filtered = this.data.athletes.filter((a) => {
      if (!a.isCurrentMember) return false;
      if (!q) return true;
      return (a.displayName ?? '').toLowerCase().includes(q);
    });
    return [...filtered].sort((a, b) => {
      // Unlogged first
      const aLogged = a.result != null ? 1 : 0;
      const bLogged = b.result != null ? 1 : 0;
      if (aLogged !== bLogged) return aLogged - bLogged;
      return (a.displayName ?? '').localeCompare(b.displayName ?? '');
    });
  });

  protected readonly hasAthletes = computed(() => this.data.athletes.some((a) => a.isCurrentMember));

  protected pick(athleteId: string | null | undefined): void {
    if (!athleteId) return;
    this.dialogRef.close({ athleteId });
  }

  protected cancel(): void {
    this.dialogRef.close();
  }
}
