import { isValidSchoolSlug } from './index.js';

/**
 * Login identifiers.
 *
 * A person signs in as `sunita@modelschool`, not as an email address. The part
 * after the `@` is the school's slug, so the identifier says which tenant it
 * belongs to without anyone choosing from a list.
 *
 * On a school's own subdomain the suffix is optional: `sunita` is enough,
 * because the address bar already said `modelschool`. On the shared sign-in it
 * is required, because nothing else identifies the school.
 *
 * ⚠ This is an identifier, not a mailbox. Nothing can be sent to it. Password
 * resets, fee reminders and absence notifications need `contactEmail` or
 * `phone` on the user, which are separate fields for exactly this reason.
 *
 * ⚠ A school's slug is therefore permanent. Change it and every identifier in
 * the school stops matching, so there is deliberately no way to edit it.
 */

export interface ParsedIdentifier {
  /** The part before the `@`, lowercased. */
  username: string;
  /** The school this identifier belongs to. */
  schoolSlug: string;
  /** The full stored form, `username@slug`. */
  identifier: string;
}

/** Local-part rules: letters, digits, dot, underscore, hyphen. */
export function isValidUsername(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/.test(value);
}

/**
 * Works out who is signing in and where.
 *
 * `hostSlug` is the school from the hostname, or null on the shared sign-in.
 * When both the host and the identifier name a school, **the host wins** — the
 * same rule as everywhere else, so a typed suffix can never reach across into
 * another tenant.
 */
export function parseLoginIdentifier(
  raw: string,
  hostSlug: string | null,
): ParsedIdentifier | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;

  const at = value.lastIndexOf('@');

  if (at === -1) {
    // Bare username. Only meaningful on a school's own subdomain.
    if (!hostSlug) return null;
    if (!isValidUsername(value)) return null;
    return { username: value, schoolSlug: hostSlug, identifier: `${value}@${hostSlug}` };
  }

  const username = value.slice(0, at);
  const suffix = value.slice(at + 1);
  if (!isValidUsername(username)) return null;

  // On a subdomain the host decides, and a mismatched suffix is simply wrong —
  // not an invitation to sign in somewhere else.
  if (hostSlug) {
    if (suffix !== hostSlug) return null;
    return { username, schoolSlug: hostSlug, identifier: `${username}@${hostSlug}` };
  }

  if (!isValidSchoolSlug(suffix)) return null;
  return { username, schoolSlug: suffix, identifier: `${username}@${suffix}` };
}

/** The stored form for a new account. */
export function buildIdentifier(username: string, schoolSlug: string): string {
  return `${username.trim().toLowerCase()}@${schoolSlug.trim().toLowerCase()}`;
}
