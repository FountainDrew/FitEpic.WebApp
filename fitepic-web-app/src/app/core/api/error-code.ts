import { HttpErrorResponse } from '@angular/common/http';

import { GymErrorResponse } from './generated/models/gym-error-response';
import { ParseWorkoutErrorResponse } from './generated/models/parse-workout-error-response';
import { WebAppErrorCode } from './generated/models/web-app-error-code';
import { WebAppErrorEnvelope } from './generated/models/web-app-error-envelope';

/**
 * Single representation of an error returned by any FitEpic API endpoint, regardless
 * of which envelope shape the underlying response used (`WebAppErrorEnvelope`,
 * `GymErrorResponse`, or `ParseWorkoutErrorResponse`). `code` is the machine-readable
 * code if one was present; `message` is the human-readable text if one was present.
 */
export interface NormalizedApiError {
  code: string | null;
  message: string | null;
}

const EMPTY: NormalizedApiError = { code: null, message: null };

/**
 * Normalizes an unknown thrown value into a {@link NormalizedApiError}. Returns
 * `{ code: null, message: null }` for anything that is not a recognized API error
 * (network failure, non-HttpErrorResponse exception, body of an unexpected shape).
 */
export function getApiError(err: unknown): NormalizedApiError {
  if (!(err instanceof HttpErrorResponse)) return EMPTY;
  const body = err.error as unknown;
  if (!body || typeof body !== 'object') return EMPTY;

  // WebAppErrorEnvelope: nested `{ error: { code, message } }`. We detect it by the
  // shape of `body.error` — an object (not a string), since Gym/Parse responses put
  // a string there.
  const nestedError = (body as { error?: unknown }).error;
  if (nestedError && typeof nestedError === 'object' && !Array.isArray(nestedError)) {
    const innerCode = (nestedError as { code?: unknown }).code;
    const innerMessage = (nestedError as { message?: unknown }).message;
    return {
      code: typeof innerCode === 'string' ? innerCode : null,
      message: typeof innerMessage === 'string' ? innerMessage : null,
    };
  }

  // Flat envelopes: GymErrorResponse `{ code, error }` and ParseWorkoutErrorResponse
  // `{ reason, error }`. Both put the human-readable text on `error`.
  const flat = body as Partial<GymErrorResponse> & Partial<ParseWorkoutErrorResponse>;
  const flatCode = flat.code ?? flat.reason;
  return {
    code: typeof flatCode === 'string' ? flatCode : null,
    message: typeof flat.error === 'string' ? flat.error : null,
  };
}

export function getApiErrorCode(err: unknown): string | null {
  return getApiError(err).code;
}

export function getApiErrorMessage(err: unknown): string | null {
  return getApiError(err).message;
}

/**
 * Legacy helper retained for callsites that want the strict `WebAppErrorCode` union
 * type back (e.g., comparison against specific known codes). Returns null when the
 * response is not a WebApp-shaped envelope.
 */
export function getWebAppErrorCode(err: unknown): WebAppErrorCode | null {
  if (!(err instanceof HttpErrorResponse)) return null;
  const body = err.error as WebAppErrorEnvelope | null | undefined;
  return body?.error?.code ?? null;
}

export function getWebAppErrorMessage(err: unknown): string | null {
  return getApiErrorMessage(err);
}
