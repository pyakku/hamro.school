import type { SignupRequest } from '@hamro/shared';
import { buildIdentifier, isSchoolSlugAvailable, schoolUrl } from '@hamro/shared';
import { env } from '../config/env.js';
import { rawPrisma } from '../db/client.js';
import { withTenant } from '../db/tenant.js';
import { AppError } from '../lib/errors.js';
import { hashPassword } from '../auth/password.js';

/**
 * School self-signup.
 *
 * A school picks its own subdomain and gets a working tenant immediately: the
 * school row, an admin account, and a current academic year — because almost
 * nothing in this product means anything without a year to hang it off, and
 * making the first admin create one before they can do anything is a cliff.
 *
 * Everything a school signs up with is theirs alone from this moment: the row
 * carries a schoolId that every later query is filtered by, twice.
 */

export interface SignupResult {
  school: { id: string; slug: string; name: string; plan: string };
  url: string;
}

export async function checkSlug(
  slug: string,
): Promise<{ slug: string; available: boolean; reason?: string }> {
  const normalised = slug.trim().toLowerCase();

  if (!isSchoolSlugAvailable(normalised)) {
    // Covers malformed labels and the names our own infrastructure uses.
    return { slug: normalised, available: false, reason: 'validation.slug_unavailable' };
  }

  const taken = await rawPrisma.school.findUnique({
    where: { slug: normalised },
    select: { id: true },
  });

  return taken
    ? { slug: normalised, available: false, reason: 'error.signup.slug_taken' }
    : { slug: normalised, available: true };
}

export async function signUpSchool(input: SignupRequest): Promise<SignupResult> {
  const availability = await checkSlug(input.slug);
  if (!availability.available) {
    throw new AppError(409, 'SLUG_TAKEN', 'error.signup.slug_taken', { slug: 'error.signup.slug_taken' });
  }

  // Hash before opening any transaction: argon2 deliberately takes ~100ms of
  // CPU, and that is a long time to hold a database connection on a box with
  // one of them to spare.
  const passwordHash = await hashPassword(input.adminPassword);

  // The school row itself is the one write that cannot be tenant-scoped —
  // there is no tenant until it exists.
  const school = await rawPrisma.school
    .create({
      data: {
        slug: availability.slug,
        name: input.schoolName,
        timezone: input.timezone,
        currency: input.currency,
        currencyMinorUnits: minorUnitsFor(input.currency),
        plan: 'BETA',
        onboardedAt: new Date(),
      },
      select: { id: true, slug: true, name: true, plan: true, timezone: true },
    })
    .catch((error: unknown) => {
      // Two schools racing for the same slug: the unique index decides, and
      // the loser gets the same answer as if it had been taken all along.
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new AppError(409, 'SLUG_TAKEN', 'error.signup.slug_taken');
      }
      throw error;
    });

  await withTenant({ schoolId: school.id }, async (db) => {
    const now = new Date();
    const startYear = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

    // A year they can rename. Guessing April–March is wrong for about half the
    // world, but an editable guess beats an empty school that does nothing.
    await db.academicYear.create({
      data: {
        schoolId: school.id,
        name: `${startYear}–${String(startYear + 1).slice(2)}`,
        startDate: new Date(Date.UTC(startYear, 3, 1)),
        endDate: new Date(Date.UTC(startYear + 1, 2, 31)),
        status: 'ACTIVE',
        isCurrent: true,
      },
    });

    // The first account. Its identifier is <username>@<slug>; the address they
    // signed up with becomes contact detail, which is where a password reset
    // would actually go.
    await db.user.create({
      data: {
        schoolId: school.id,
        identifier: buildIdentifier(input.adminUsername, school.slug),
        username: input.adminUsername.toLowerCase(),
        contactEmail: input.adminContactEmail ?? null,
        passwordHash,
        firstName: input.adminFirstName,
        lastName: input.adminLastName,
        roleAssignments: { create: [{ schoolId: school.id, role: 'SCHOOL_ADMIN' }] },
      },
    });
  });

  return {
    school: { id: school.id, slug: school.slug, name: school.name, plan: school.plan },
    url: schoolUrl(school.slug, env.APP_BASE_DOMAIN),
  };
}

/**
 * ISO 4217 exponents that are not 2. Everything else is 2, which is the
 * overwhelming majority — this is a correction list, not a currency database.
 */
const MINOR_UNITS: Readonly<Record<string, number>> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

function minorUnitsFor(currency: string): number {
  return MINOR_UNITS[currency.toUpperCase()] ?? 2;
}

/**
 * Whether a hostname belongs to a real, active school.
 *
 * Caddy calls this before requesting a certificate for a hostname it has not
 * seen. Without it, anyone hitting `whatever.hamro.school` would make us ask
 * Let's Encrypt for a certificate, and fifty of those a week is the rate limit
 * for the whole domain — one bored person could stop new schools onboarding.
 */
export async function isCertificateAllowed(domain: string): Promise<boolean> {
  const hostname = domain.trim().toLowerCase().split(':')[0] ?? '';
  const base = env.APP_BASE_DOMAIN.toLowerCase();

  // Ours: the shared sign-in, the platform console, the base domain.
  if (hostname === `app.${base}` || hostname === `admin.${base}` || hostname === base) return true;

  const { schoolSlugFromHost } = await import('@hamro/shared');
  const slug = schoolSlugFromHost(hostname, { baseDomain: base });
  if (!slug) return false;

  const school = await rawPrisma.school.findFirst({
    where: { slug, isActive: true, deletedAt: null },
    select: { id: true },
  });

  return school !== null;
}
