import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';

import { routes } from './app.routes';
import { provideFitEpicApi } from './core/api/api.providers';
import { authInterceptor } from './core/auth/auth.interceptor';
import { notGymOwnerInterceptor } from './core/gyms/not-gym-owner.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([authInterceptor, notGymOwnerInterceptor])),
    provideFitEpicApi(),
    // Apply the project's opaque surface + standard form-dialog layout to every
    // dialog by default. Components that need a different look (e.g. the
    // dashboard's `fe-info-dialog`) override `panelClass` per-call. See
    // `styles.scss` for the `.fe-dialog` rules.
    { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { panelClass: 'fe-dialog' } },
  ],
};
