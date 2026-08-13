import type { MessageKey } from '@hamro/shared';

/**
 * Errors the client is allowed to see.
 *
 * Two identifiers, on purpose:
 *   · `key` is an i18n key the client renders. No English sentence crosses
 *     the wire — a school in Doha reads this product in Arabic.
 *   · `code` is stable and machine-readable, so client logic and our logs do
 *     not break when the wording changes.
 *
 * Anything that is not an AppError is a bug, and the error handler turns it
 * into a generic 500 without leaking the stack to the browser.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly key: MessageKey,
    readonly fields?: Record<string, string>,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${key}`, options);
    this.name = 'AppError';
  }
}

export const unauthenticated = (key: MessageKey = 'error.unauthenticated'): AppError =>
  new AppError(401, 'UNAUTHENTICATED', key);

export const forbidden = (key: MessageKey = 'error.forbidden'): AppError =>
  new AppError(403, 'FORBIDDEN', key);

export const notFound = (key: MessageKey = 'error.not_found'): AppError =>
  new AppError(404, 'NOT_FOUND', key);

export const validationFailed = (fields?: Record<string, string>): AppError =>
  new AppError(422, 'VALIDATION_FAILED', 'error.validation', fields);

/**
 * Login failures are deliberately indistinguishable. "No such user", "wrong
 * password" and "no such school" all return this, because the difference tells
 * an attacker which parents hold accounts at which school.
 */
export const invalidCredentials = (): AppError =>
  new AppError(401, 'INVALID_CREDENTIALS', 'error.auth.invalid_credentials');
