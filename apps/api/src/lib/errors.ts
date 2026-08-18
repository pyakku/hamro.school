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

/**
 * Attendance refusals.
 *
 * Each of these is a rule the product would rather state than silently work
 * around, because every one of them protects a number a school will later be
 * asked to defend.
 */

/** A holiday or closure. No register exists for it and none should (rule 6). */
export const closedDay = (): AppError =>
  new AppError(409, 'CLOSED_DAY', 'error.attendance.closed_day');

/** Half a class is worse than none: the missing children look untaken. */
export const incompleteRegister = (): AppError =>
  new AppError(422, 'INCOMPLETE_REGISTER', 'error.attendance.incomplete');

export const lockedDay = (): AppError =>
  new AppError(403, 'ATTENDANCE_LOCKED', 'error.attendance.locked');

export const amendReasonRequired = (): AppError =>
  new AppError(422, 'AMEND_REASON_REQUIRED', 'error.attendance.amend_reason');

/** Setup refusals. */
export const nameTaken = (): AppError =>
  new AppError(409, 'NAME_TAKEN', 'error.setup.name_taken');

/**
 * Something depends on this row.
 *
 * Removing a grade level with children enrolled in it, or a subject with marks
 * against it, would leave records pointing at nothing. Soft delete hides the
 * row but the references remain, so the honest answer is to refuse and say what
 * is in the way.
 */
export const stillInUse = (): AppError =>
  new AppError(409, 'STILL_IN_USE', 'error.setup.in_use');
