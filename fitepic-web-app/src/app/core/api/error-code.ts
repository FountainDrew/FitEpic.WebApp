import { HttpErrorResponse } from '@angular/common/http';

import { WebAppErrorCode } from './generated/models/web-app-error-code';
import { WebAppErrorEnvelope } from './generated/models/web-app-error-envelope';

export function getWebAppErrorCode(err: unknown): WebAppErrorCode | null {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as WebAppErrorEnvelope | null | undefined;
    return body?.error?.code ?? null;
  }
  return null;
}

export function getWebAppErrorMessage(err: unknown): string | null {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as WebAppErrorEnvelope | null | undefined;
    return body?.error?.message ?? null;
  }
  return null;
}
