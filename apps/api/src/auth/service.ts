import type { Role, SessionUser } from '@hamro/shared';
import { permissionsFor } from '@hamro/shared';
import { findSchoolBySlug, withTenant, type TenantClient, type TenantContext } from '../db/tenant.js';
import { AppError, invalidCredentials, unauthenticated } from '../lib/errors.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';
import {
  ACCESS_TTL_SECONDS,
  hashRefreshToken,
  issueRefreshToken,
  parseRefreshToken,
  signAccessToken,
} from './tokens.js';

export interface RequestMeta {
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
}

interface SchoolSummary {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  currencyMinorUnits: number;
  defaultLocale: string;
}

function activeRoles(assignments: { role: string; isActive: boolean; revokedAt: Date | null }[]): Role[] {
  return assignments
    .filter((assignment) => assignment.isActive && assignment.revokedAt === null)
    .map((assignment) => assignment.role as Role);
}

function toSessionUser(
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    locale: string | null;
  },
  roles: Role[],
  school: SchoolSummary,
): SessionUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    locale: user.locale ?? school.defaultLocale,
    roles,
    permissions: permissionsFor(roles),
    school,
  };
}

/**
 * Email plus password, scoped to a school.
 *
 * Every failure below returns the same error. Distinguishing "no such school"
 * from "no such user" from "wrong password" would let anyone enumerate which
 * families attend which school, which is precisely the kind of thing a parent
 * would be upset to learn we leaked.
 */
export async function login(
  input: { schoolSlug: string; email: string; password: string },
  meta: RequestMeta = {},
): Promise<AuthResult> {
  const school = await findSchoolBySlug(input.schoolSlug);
  if (!school) {
    // Still spend the time an argon2 verification would take.
    await verifyPassword(null, input.password);
    throw invalidCredentials();
  }

  const ctx: TenantContext = { schoolId: school.id, ...meta };

  return withTenant(ctx, async (db) => {
    const user = await db.user.findFirst({
      where: { email: input.email },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        locale: true,
        passwordHash: true,
        isActive: true,
        roleAssignments: {
          select: { role: true, isActive: true, revokedAt: true },
        },
      },
    });

    const passwordMatches = await verifyPassword(user?.passwordHash ?? null, input.password);
    if (!user || !passwordMatches) {
      throw invalidCredentials();
    }
    if (!user.isActive) {
      throw new AppError(403, 'ACCOUNT_INACTIVE', 'error.auth.account_inactive');
    }

    const roles = activeRoles(user.roleAssignments);
    if (roles.length === 0) {
      // An account with no role can do nothing; say so rather than dropping
      // them into an empty app.
      throw new AppError(403, 'NO_ROLES', 'error.auth.no_roles');
    }

    // Argon2 parameters get stronger over time. Catch the old hashes on the
    // one occasion we hold the plaintext.
    if (user.passwordHash && needsRehash(user.passwordHash)) {
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(input.password) },
      });
    }

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const refresh = issueRefreshToken(school.id);
    await db.refreshToken.create({
      data: {
        schoolId: school.id,
        userId: user.id,
        tokenHash: refresh.tokenHash,
        expiresAt: refresh.expiresAt,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    });

    return {
      accessToken: await signAccessToken({ userId: user.id, schoolId: school.id, roles }),
      refreshToken: refresh.token,
      expiresIn: ACCESS_TTL_SECONDS,
      user: toSessionUser(user, roles, school),
    };
  });
}

/**
 * Rotates a refresh token.
 *
 * Every refresh mints a new token and retires the old one. If a retired token
 * comes back, it was either replayed by the legitimate client after a dropped
 * response or stolen — and we cannot tell which, so we assume the worse case
 * and revoke the whole chain. The user signs in again; an attacker holding a
 * copied token gets nothing.
 */
export async function refreshSession(rawToken: string, meta: RequestMeta = {}): Promise<AuthResult> {
  const parsed = parseRefreshToken(rawToken);
  if (!parsed) throw unauthenticated('error.auth.session_expired');

  const school = await findSchoolById(parsed.schoolId);
  if (!school) throw unauthenticated('error.auth.session_expired');

  const ctx: TenantContext = { schoolId: school.id, ...meta };
  const tokenHash = hashRefreshToken(parsed.token);

  const outcome = await withTenant(ctx, async (db) => {
    // Claim the token by revoking it, and only then look at what we claimed.
    // An UPDATE ... WHERE revoked_at IS NULL is atomic, so two requests racing
    // with the same token cannot both succeed — exactly one gets count 1.
    const claim = await db.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (claim.count === 0) {
      const seen = await db.refreshToken.findFirst({
        where: { tokenHash },
        select: { userId: true },
      });
      // A token we have seen before and already retired is a replay. One we
      // have never seen is just rubbish.
      return seen ? ({ kind: 'REPLAY', userId: seen.userId } as const) : ({ kind: 'UNKNOWN' } as const);
    }

    const existing = await db.refreshToken.findFirstOrThrow({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true },
    });

    if (existing.expiresAt.getTime() <= Date.now()) {
      return { kind: 'EXPIRED' } as const;
    }

    const user = await db.user.findFirst({
      where: { id: existing.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        locale: true,
        isActive: true,
        roleAssignments: { select: { role: true, isActive: true, revokedAt: true } },
      },
    });

    if (!user || !user.isActive) return { kind: 'EXPIRED' } as const;

    const roles = activeRoles(user.roleAssignments);
    if (roles.length === 0) return { kind: 'NO_ROLES' } as const;

    const next = issueRefreshToken(school.id);
    const created = await db.refreshToken.create({
      data: {
        schoolId: school.id,
        userId: user.id,
        tokenHash: next.tokenHash,
        expiresAt: next.expiresAt,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
      select: { id: true },
    });

    await db.refreshToken.update({
      where: { id: existing.id },
      data: { replacedByTokenId: created.id },
    });

    return {
      kind: 'ROTATED',
      result: {
        accessToken: await signAccessToken({ userId: user.id, schoolId: school.id, roles }),
        refreshToken: next.token,
        expiresIn: ACCESS_TTL_SECONDS,
        user: toSessionUser(user, roles, school),
      },
    } as const;
  });

  if (outcome.kind === 'ROTATED') return outcome.result;

  if (outcome.kind === 'REPLAY') {
    // A retired token came back. Either the legitimate client retried after a
    // dropped response, or someone copied it — and we cannot tell which, so we
    // assume the worse case and end every session this user has. They sign in
    // again; whoever stole the token gets nothing.
    //
    // This runs in its own transaction on purpose: the revocation has to
    // commit, and the transaction above is the one that just decided to fail.
    await withTenant(ctx, (db) =>
      db.refreshToken.updateMany({
        where: { userId: outcome.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
    throw unauthenticated('error.auth.session_expired');
  }

  if (outcome.kind === 'NO_ROLES') throw new AppError(403, 'NO_ROLES', 'error.auth.no_roles');

  throw unauthenticated('error.auth.session_expired');
}

/** Signs out one device. Other sessions keep working. */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const parsed = parseRefreshToken(rawToken);
  if (!parsed) return;

  const school = await findSchoolById(parsed.schoolId);
  if (!school) return;

  await withTenant({ schoolId: school.id }, async (db) => {
    await db.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(parsed.token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}

/** The current session, re-derived from the database rather than the token. */
export async function loadSessionUser(db: TenantClient, userId: string, school: SchoolSummary) {
  const user = await db.user.findFirst({
    where: { id: userId, isActive: true },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      locale: true,
      roleAssignments: { select: { role: true, isActive: true, revokedAt: true } },
    },
  });
  if (!user) return null;

  const roles = activeRoles(user.roleAssignments);
  if (roles.length === 0) return null;

  return toSessionUser(user, roles, school);
}

/**
 * School lookup by id, for the refresh path. Like `findSchoolBySlug`, this is
 * one of the few reads that legitimately happens outside a tenant scope —
 * `schools` is the tenant table itself.
 */
export async function findSchoolById(id: string): Promise<SchoolSummary | null> {
  const { rawPrisma } = await import('../db/client.js');
  return rawPrisma.school.findFirst({
    where: { id, isActive: true, deletedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      timezone: true,
      currency: true,
      currencyMinorUnits: true,
      defaultLocale: true,
    },
  });
}
