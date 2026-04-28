import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { AuthService } from './auth.service';
import { TokenStore } from './token-store';

const AUTH_PATH_PATTERNS = [/\/User\/SignIn$/i, /\/User\/Register$/i];

function isAuthEndpoint(url: string): boolean {
  return AUTH_PATH_PATTERNS.some((pattern) => pattern.test(url));
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (isAuthEndpoint(req.url)) {
    return next(req);
  }

  const store = inject(TokenStore);
  const auth = inject(AuthService);
  const router = inject(Router);

  const stored = store.read();
  const authedReq =
    stored && store.isFresh()
      ? req.clone({ setHeaders: { Authorization: `Bearer ${stored.token}` } })
      : req;

  return next(authedReq).pipe(
    catchError((err) => {
      if (err?.status === 401) {
        auth.handleUnauthorized();
        const returnUrl = router.url && router.url !== '/login' ? router.url : null;
        router.navigate(['/login'], returnUrl ? { queryParams: { returnUrl } } : undefined);
      }
      return throwError(() => err);
    }),
  );
};
