import { MatSnackBar } from '@angular/material/snack-bar';

import { getApiError } from '../api/error-code';

/**
 * Stable error codes returned by the gym-domain API and the user-facing copy the
 * web app surfaces for each. Codes match `GymErrorResponse.code` from the API
 * contract (§5.9). Codes not in this map fall back to the server-supplied message
 * (or the caller's fallback string).
 */
export const GYM_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  GymNotFound: 'This gym is no longer available.',
  NotGymOwner: 'Enable gym ownership in your profile first.',
  InsufficientRole: 'This action requires Admin or Owner.',
  NotOwner: 'Only the gym Owner can do this.',
  GymsStillOwned:
    'You still own one or more gyms — delete them before disabling gym ownership.',
  JoinRequestDuplicate: 'A join request is already pending for this gym.',
  JoinRequestAlreadyMember: 'Already a member at that level — nothing to do.',
  JoinRequestIdMismatch: 'Could not submit the join request. Try again.',
  JoinRequestNotPending: 'This request has already been resolved.',
  JoinRequestConflict: 'Could not submit the join request.',
  InviteDuplicate: 'An invite is already pending for this athlete.',
  InviteAlreadyMember: 'Already a member at that level — nothing to do.',
  InviteNotPending: 'This invite has already been resolved.',
  InviteConflict: 'Could not send the invite.',
  RoleChangeBlocked: 'The Owner role cannot be changed via this action.',
  RemovalBlocked: 'The Owner cannot be removed via this action.',
  OwnerCannotLeave: 'Delete the gym to step away from ownership.',
  AdminNotRequestable:
    'Admin can only be granted by the Owner — request Coach instead.',
};

/**
 * Per-row sync resolution values surfaced when a workout/scheduled-workout sync
 * batch rejects a specific row. Not part of `GymErrorResponse` but mapped here
 * so callers parsing sync responses can reuse the same copy library.
 */
export const SYNC_RESULT_MESSAGES: Readonly<Record<string, string>> = {
  BlockedByHistory:
    'Workouts with completed history cannot be deleted. Archive it instead.',
  Forbidden: 'You do not have permission to perform that action.',
};

/**
 * Opens a snackbar describing an API error. Resolution order:
 *   1. Stable copy from {@link GYM_ERROR_MESSAGES} keyed by the error code.
 *   2. The server-supplied message (any envelope shape).
 *   3. The caller's fallback.
 */
export function showGymError(
  snackBar: MatSnackBar,
  err: unknown,
  fallback: string,
  durationMs = 4000,
): void {
  const { code, message } = getApiError(err);
  const text = (code && GYM_ERROR_MESSAGES[code]) ?? message ?? fallback;
  snackBar.open(text, 'Dismiss', { duration: durationMs });
}
