import { SignJWT, jwtVerify } from 'jose';
import { env, ttlToSeconds } from '../config/env.js';
import { rawPrisma } from '../db/client.js';
import { AppError, invalidCredentials, unauthenticated } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../auth/password.js';

/**
 * The platform console — us, at admin.hamro.school.
 *
 * A deliberately separate identity system from school logins, with its own
 * table, its own token audience and its own middleware. A platform session can
 * see every school at once, so a bug in school authentication must not be able
 * to produce one, and a school session must never widen into one.
 *
 * Nothing here uses `withTenant`: these queries are deliberately about every
 * tenant at once, which is the one place that is legitimate. Reads that touch
 * tenant tables go through `withPlatform`, which sets the one flag the RLS
 * policies accept besides a matching school id — see the
 * platform_read_across_tenants migration.
 */

/**
 * Runs a read across every tenant.
 *
 * Only ever called after a platform admin token has been verified. The flag is
 * transaction-scoped, so it cannot leak into another request, and writes are
 * still refused by the policy's WITH CHECK — this widens reading, not writing.
 */
async function withPlatform<T>(fn: (db: typeof rawPrisma) => Promise<T>): Promise<T> {
  return rawPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.platform', 'on', true)`;
    return fn(tx as unknown as typeof rawPrisma);
  });
}

const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const ISSUER = 'hamro.school';
/** Different from the school API's audience, so tokens cannot cross over. */
const AUDIENCE = 'hamro.school/platform';

export const PLATFORM_TTL_SECONDS = ttlToSeconds('2h');

export interface PlatformAdminSession {
  id: string;
  email: string;
  name: string;
}

export async function platformLogin(input: { email: string; password: string }) {
  const admin = await rawPrisma.platformAdmin.findUnique({
    where: { email: input.email.trim().toLowerCase() },
  });

  const matches = await verifyPassword(admin?.passwordHash ?? null, input.password);
  if (!admin || !matches || !admin.isActive) throw invalidCredentials();

  await rawPrisma.platformAdmin.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  const accessToken = await new SignJWT({ scope: 'platform' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(admin.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${PLATFORM_TTL_SECONDS}s`)
    .sign(secret);

  return {
    accessToken,
    expiresIn: PLATFORM_TTL_SECONDS,
    admin: { id: admin.id, email: admin.email, name: admin.name },
  };
}

export async function verifyPlatformToken(token: string): Promise<PlatformAdminSession> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });

    const admin = await rawPrisma.platformAdmin.findFirst({
      where: { id: String(payload.sub), isActive: true },
      select: { id: true, email: true, name: true },
    });
    if (!admin) throw unauthenticated();
    return admin;
  } catch {
    throw unauthenticated('error.auth.session_expired');
  }
}

export async function changePlatformPassword(adminId: string, newPassword: string): Promise<void> {
  await rawPrisma.platformAdmin.update({
    where: { id: adminId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}

// ── Schools ────────────────────────────────────────────────────────────────

export async function listSchools() {
  return withPlatform(async (db) => {
  const schools = await db.school.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      slug: true,
      name: true,
      plan: true,
      isActive: true,
      timezone: true,
      currency: true,
      createdAt: true,
      onboardedAt: true,
      _count: { select: { users: true, students: true } },
    },
  });

  return schools.map((school) => ({
    id: school.id,
    slug: school.slug,
    name: school.name,
    plan: school.plan,
    isActive: school.isActive,
    timezone: school.timezone,
    currency: school.currency,
    createdAt: school.createdAt.toISOString(),
    onboardedAt: school.onboardedAt?.toISOString() ?? null,
    url: `https://${school.slug}.${env.APP_BASE_DOMAIN}`,
    counts: { users: school._count.users, students: school._count.students },
  }));
  });
}

export async function updateSchool(
  id: string,
  changes: { plan?: 'BETA' | 'STARTER' | 'PRO'; isActive?: boolean },
) {
  const school = await rawPrisma.school.findFirst({ where: { id, deletedAt: null } });
  if (!school) throw new AppError(404, 'NOT_FOUND', 'error.not_found');

  await rawPrisma.school.update({
    where: { id },
    data: {
      ...(changes.plan ? { plan: changes.plan } : {}),
      ...(changes.isActive === undefined ? {} : { isActive: changes.isActive }),
    },
  });
}

// ── Users ──────────────────────────────────────────────────────────────────

export async function listUsers(options: { schoolId?: string; limit?: number }) {
  const where = {
    deletedAt: null,
    ...(options.schoolId ? { schoolId: options.schoolId } : {}),
  };

  return withPlatform(async (db) => {
  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 200,
      select: {
        id: true,
        identifier: true,
        firstName: true,
        lastName: true,
        contactEmail: true,
        isActive: true,
        lastLoginAt: true,
        schoolId: true,
        school: { select: { slug: true, name: true } },
        roleAssignments: {
          where: { isActive: true, revokedAt: null },
          select: { role: true },
        },
      },
    }),
    db.user.count({ where }),
  ]);

  return {
    total,
    users: users.map((user) => ({
      id: user.id,
      identifier: user.identifier,
      firstName: user.firstName,
      lastName: user.lastName,
      contactEmail: user.contactEmail,
      roles: user.roleAssignments.map((r) => r.role),
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      schoolId: user.schoolId,
      schoolSlug: user.school.slug,
      schoolName: user.school.name,
    })),
  };
  });
}

// ── Settings ───────────────────────────────────────────────────────────────

const SIGNUP_ENABLED = 'signupEnabled';

export async function getSettings(): Promise<{ signupEnabled: boolean }> {
  const row = await rawPrisma.platformSetting.findUnique({ where: { key: SIGNUP_ENABLED } });
  // Absent means open. A missing row should not quietly close the beta.
  return { signupEnabled: row === null ? true : row.value === true };
}

export async function updateSettings(changes: { signupEnabled?: boolean }): Promise<void> {
  if (changes.signupEnabled === undefined) return;

  await rawPrisma.platformSetting.upsert({
    where: { key: SIGNUP_ENABLED },
    create: { key: SIGNUP_ENABLED, value: changes.signupEnabled },
    update: { value: changes.signupEnabled },
  });
}

/** Called by the signup route. Closed beta means no new schools. */
export async function assertSignupOpen(): Promise<void> {
  const { signupEnabled } = await getSettings();
  if (!signupEnabled) {
    throw new AppError(403, 'SIGNUP_CLOSED', 'error.signup.closed');
  }
}
