import type { FastifyRequest } from 'fastify';
import type { LocalDate } from '@hamro/shared';
import { withTenant, type TenantClient } from '../db/tenant.js';
import type { Actor } from '../policy/guard.js';
import { unauthenticated } from './errors.js';
import { findSchoolById } from '../auth/service.js';
import { findCurrentYear, schoolToday, type CurrentYear } from '../school/service.js';

/**
 * The preamble every read route needs, written once.
 *
 * Resolving the school, opening the tenant scope and finding the current
 * academic year is the first eight lines of any handler in this application.
 * Written out each time, it is eight lines somebody eventually gets subtly
 * wrong — most likely by reading the school row *inside* the transaction, or by
 * assuming a current year exists.
 *
 * The school is deliberately fetched before `withTenant` opens: it carries the
 * timezone, and the timezone decides what "today" means for everything inside.
 */

export interface SchoolSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly timezone: string;
  readonly currency: string;
  readonly currencyMinorUnits: number;
  readonly defaultLocale: string;
}

export interface RequestScope {
  readonly db: TenantClient;
  readonly actor: Actor;
  readonly school: SchoolSummary;
  readonly today: LocalDate;
  /**
   * Null for a school between years, or one still in setup. Handlers decide
   * what that means for them — a list is empty, not an error, because a school
   * with no year genuinely has no attendance rather than a missing page.
   */
  readonly year: CurrentYear | null;
}

export async function inSchool<T>(
  request: FastifyRequest,
  fn: (scope: RequestScope) => Promise<T>,
): Promise<T> {
  const actor = request.actor;
  if (!actor) throw unauthenticated();

  const school = await findSchoolById(actor.schoolId);
  if (!school) throw unauthenticated();

  const today = schoolToday(school);

  return withTenant(request.tenant ?? { schoolId: actor.schoolId }, async (db) => {
    const year = await findCurrentYear(db);
    return fn({ db, actor, school, today, year });
  });
}
