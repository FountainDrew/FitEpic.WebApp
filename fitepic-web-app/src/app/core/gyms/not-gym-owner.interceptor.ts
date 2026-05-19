import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, throwError } from 'rxjs';

import { getApiErrorCode } from '../api/error-code';

/**
 * Surfaces a single global snackbar whenever a gym-domain endpoint returns
 * `403 NotGymOwner`, with a one-click action that takes the user to the settings
 * page so they can flip the `IsGymOwner` toggle. The original error is rethrown
 * so feature components can still react (e.g., reset a pending submit button).
 *
 * A short cooldown prevents a burst of failed gym requests from stacking multiple
 * identical snackbars on top of each other.
 */
const NOTICE_COOLDOWN_MS = 3000;
let lastShownAt = 0;

export const notGymOwnerInterceptor: HttpInterceptorFn = (req, next) => {
  const snackBar = inject(MatSnackBar);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err) => {
      if (err instanceof HttpErrorResponse && err.status === 403) {
        const code = getApiErrorCode(err);
        if (code === 'NotGymOwner') {
          const now = Date.now();
          if (now - lastShownAt >= NOTICE_COOLDOWN_MS) {
            lastShownAt = now;
            snackBar
              .open(
                'Enable gym ownership in your profile to use this feature.',
                'Open settings',
                { duration: 6000 },
              )
              .onAction()
              .subscribe(() => void router.navigateByUrl('/settings'));
          }
        }
      }
      return throwError(() => err);
    }),
  );
};
