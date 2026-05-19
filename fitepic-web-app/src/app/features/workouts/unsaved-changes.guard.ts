import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import {
  ConfirmActionDialog,
  ConfirmActionDialogData,
} from '../gyms/confirm-action-dialog';
import { WorkoutEditorPage } from './workout-editor-page';

/**
 * Route guard that prompts the user before navigating away from the workout
 * editor with unsaved changes. Works for back-button, sidebar clicks, and any
 * other route change — the component's own Cancel button has its own confirm
 * before triggering navigation.
 */
export const workoutEditorCanDeactivate: CanDeactivateFn<WorkoutEditorPage> = async (
  component,
) => {
  if (!component.hasUnsavedChanges()) return true;
  const dialog = inject(MatDialog);
  const ref = dialog.open<ConfirmActionDialog, ConfirmActionDialogData, boolean>(
    ConfirmActionDialog,
    {
      data: {
        title: 'Discard changes?',
        message: 'You have unsaved changes. Leave the editor anyway?',
        confirmLabel: 'Discard',
        warn: true,
      },
      width: '420px',
    },
  );
  const result = await firstValueFrom(ref.afterClosed());
  return !!result;
};
