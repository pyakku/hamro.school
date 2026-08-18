import {
  fromLocalDate,
  isWithin,
  todayInTimezone,
  type LocalDate,
  type SchoolContext,
} from '@hamro/shared';
import type { TenantClient } from '../db/tenant.js';
import { dateWire } from '../lib/wire.js';

/**
 * The year, the term, and whether the school is open.
 *
 * Everything else in the product is read in the light of this: attendance
 * belongs to a year, a section is per-year, a teacher's access expires when the
 * year turns. So this resolves once per request rather than being threaded
 * through every handler as a parameter someone will eventually pass wrong.
 */

export interface SchoolTiming {
  readonly timezone: string;
}

/** What day it is *at the school*, which is the only day that matters. */
export function schoolToday(school: SchoolTiming, now?: Date): LocalDate {
  return todayInTimezone(school.timezone, now);
}

/** The hour of the school's day, 0–23, for a greeting the client cannot get wrong. */
export function schoolHour(school: SchoolTiming, now: Date = new Date()): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: school.timezone,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  // 24 at midnight in some ICU builds; the modulo keeps it in range.
  return Number(formatted) % 24;
}

export interface CurrentYear {
  readonly id: string;
  readonly name: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly status: 'PLANNING' | 'ACTIVE' | 'CLOSED';
  readonly isCurrent: boolean;
}

/**
 * The school's current academic year.
 *
 * `isCurrent` is a single flag per school — a partial unique index in the
 * tenant migration enforces that. A school mid-setup may have none, and every
 * caller has to cope with that rather than assuming: the first admin to sign in
 * after signup has a year, but a school that has closed one and not opened the
 * next has nothing current, and that is a legitimate state.
 */
export async function findCurrentYear(db: TenantClient): Promise<CurrentYear | null> {
  const year = await db.academicYear.findFirst({
    where: { isCurrent: true },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      status: true,
      isCurrent: true,
    },
  });
  return year;
}

interface DayScope {
  readonly sectionId?: string | null;
  readonly gradeLevelId?: string | null;
}

/**
 * Why the school is shut on this date, or null if it is open.
 *
 * A holiday or a closure can be school-wide, one grade, or one section, so this
 * takes the scope of whatever is being asked about. A whole-school holiday
 * closes every register; a section-scoped closure closes exactly one.
 *
 * Rule 6 rests on this: a closed day has **no attendance records at all**, so
 * it leaves the denominator rather than counting as absence. Getting this wrong
 * marks a school's Dashain holiday as two weeks of truancy.
 */
export async function findNonSchoolDayReason(
  db: TenantClient,
  academicYearId: string,
  date: LocalDate,
  scope: DayScope = {},
): Promise<string | null> {
  const on = fromLocalDate(date);

  const applies = {
    academicYearId,
    startDate: { lte: on },
    endDate: { gte: on },
    OR: [
      { scope: 'SCHOOL' as const },
      ...(scope.gradeLevelId
        ? [{ scope: 'GRADE_LEVEL' as const, gradeLevelId: scope.gradeLevelId }]
        : []),
      ...(scope.sectionId ? [{ scope: 'SECTION' as const, sectionId: scope.sectionId }] : []),
    ],
  };

  const [holiday, closure] = await Promise.all([
    db.holiday.findFirst({ where: applies, select: { name: true } }),
    db.closure.findFirst({ where: applies, select: { reason: true } }),
  ]);

  return holiday?.name ?? closure?.reason ?? null;
}

/**
 * Every non-school day in a window, as a set of dates.
 *
 * One query for a term rather than one per day: a term is about 120 days, and
 * asking the database 120 times to draw one attendance summary is how a screen
 * that felt fine on seed data stops being usable on a real school.
 */
export async function findNonSchoolDays(
  db: TenantClient,
  academicYearId: string,
  from: LocalDate,
  to: LocalDate,
  scope: DayScope = {},
): Promise<Set<LocalDate>> {
  const overlaps = {
    academicYearId,
    startDate: { lte: fromLocalDate(to) },
    endDate: { gte: fromLocalDate(from) },
    OR: [
      { scope: 'SCHOOL' as const },
      ...(scope.gradeLevelId
        ? [{ scope: 'GRADE_LEVEL' as const, gradeLevelId: scope.gradeLevelId }]
        : []),
      ...(scope.sectionId ? [{ scope: 'SECTION' as const, sectionId: scope.sectionId }] : []),
    ],
  };

  const [holidays, closures] = await Promise.all([
    db.holiday.findMany({ where: overlaps, select: { startDate: true, endDate: true } }),
    db.closure.findMany({ where: overlaps, select: { startDate: true, endDate: true } }),
  ]);

  const days = new Set<LocalDate>();
  for (const span of [...holidays, ...closures]) {
    const start = dateWire(span.startDate);
    const end = dateWire(span.endDate);
    if (!start || !end) continue;
    for (let day = start; day <= end; day = nextDay(day)) {
      if (isWithin(day, from, to)) days.add(day);
    }
  }
  return days;
}

function nextDay(date: LocalDate): LocalDate {
  const value = fromLocalDate(date);
  value.setUTCDate(value.getUTCDate() + 1);
  return dateWire(value) ?? date;
}

/**
 * The context the shell asks for on every page load.
 *
 * `today` is the server's answer, not the browser's. A guardian abroad and the
 * class teacher must agree about what day the school is on, and a device clock
 * is wrong often enough to matter.
 */
export async function loadSchoolContext(
  db: TenantClient,
  school: SchoolTiming,
  now?: Date,
): Promise<SchoolContext> {
  const today = schoolToday(school, now);
  const year = await findCurrentYear(db);

  if (!year) {
    return {
      today,
      academicYear: null,
      currentTerm: null,
      terms: [],
      isSchoolDay: true,
      nonSchoolDayReason: null,
    };
  }

  const [terms, reason] = await Promise.all([
    db.term.findMany({
      where: { academicYearId: year.id },
      orderBy: { sequence: 'asc' },
      select: { id: true, name: true, sequence: true, startDate: true, endDate: true },
    }),
    findNonSchoolDayReason(db, year.id, today),
  ]);

  const termViews = terms.map((term) => ({
    id: term.id,
    name: term.name,
    sequence: term.sequence,
    startDate: dateWire(term.startDate) ?? today,
    endDate: dateWire(term.endDate) ?? today,
  }));

  return {
    today,
    academicYear: {
      id: year.id,
      name: year.name,
      startDate: dateWire(year.startDate) ?? today,
      endDate: dateWire(year.endDate) ?? today,
      status: year.status,
      isCurrent: year.isCurrent,
    },
    // Null between terms — a real state, and one the topbar says out loud
    // rather than guessing at the nearest term.
    currentTerm: termViews.find((term) => isWithin(today, term.startDate, term.endDate)) ?? null,
    terms: termViews,
    isSchoolDay: reason === null,
    nonSchoolDayReason: reason,
  };
}
