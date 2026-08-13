import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { Role } from '@hamro/shared';
import { env, ttlToSeconds } from '../config/env.js';

/**
 * Tokens.
 *
 * The access token is a short-lived JWT. It carries the school, the user and
 * their roles, so an ordinary request needs no database round trip to know who
 * is asking — but it carries no permissions, because permissions are derived
 * from roles server-side on every request. A token that carried its own
 * permissions would keep them for its whole life after an admin revoked them.
 *
 * The refresh token is NOT a JWT. It is an opaque random string, stored only
 * as a SHA-256 hash, rotated on every use, with reuse detection. A JWT refresh
 * token cannot be revoked without a database lookup anyway, so making it a JWT
 * buys nothing and costs the ability to cut off a stolen session immediately.
 *
 * The refresh token is prefixed with the school id — `<schoolId>.<secret>` —
 * because the refresh endpoint has to know which tenant to open a scoped
 * transaction for before it can look the token up. Row-level security makes
 * that ordering mandatory, and the school id is not a secret.
 */

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  sid: string; // school id
  roles: Role[];
}

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const ISSUER = 'hamro.school';
const AUDIENCE = 'hamro.school/api';

export const ACCESS_TTL_SECONDS = ttlToSeconds(env.JWT_ACCESS_TTL);
export const REFRESH_TTL_SECONDS = ttlToSeconds(env.JWT_REFRESH_TTL);

export async function signAccessToken(input: {
  userId: string;
  schoolId: string;
  roles: Role[];
}): Promise<string> {
  return new SignJWT({ sid: input.schoolId, roles: input.roles })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(accessSecret);
}

export class InvalidTokenError extends Error {}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new InvalidTokenError('Token is missing its subject or school.');
    }
    return payload as AccessTokenClaims;
  } catch (cause) {
    throw new InvalidTokenError('Access token is not valid.', { cause });
  }
}

export interface IssuedRefreshToken {
  /** Given to the client once and never stored in this form. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function issueRefreshToken(schoolId: string): IssuedRefreshToken {
  const secret = randomBytes(32).toString('base64url');
  const token = `${schoolId}.${secret}`;
  return {
    token,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Splits `<schoolId>.<secret>` without trusting the input. Returns null rather
 * than throwing, so a malformed token is just an expired session to the caller.
 */
export function parseRefreshToken(token: string): { schoolId: string; token: string } | null {
  const separator = token.indexOf('.');
  if (separator < 1 || separator === token.length - 1) return null;
  const schoolId = token.slice(0, separator);
  if (!/^[a-z0-9]{10,64}$/i.test(schoolId)) return null;
  return { schoolId, token };
}

/** Constant-time comparison for hashes we look up by other means. */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
