import { fromLocalDate, type LocalDate } from '@hamro/shared';
import type { TenantClient } from '../db/tenant.js';
import type { Actor } from '../policy/guard.js';
import {
  assertPermission,
  resolveOwnChildEnrolmentIds,
  resolveOwnEnrolmentIds,
  resolveOwnSectionIds,
} from '../policy/guard.js';
import type { CurrentYear } from '../school/service.js';
import { timeWire } from '../lib/wire.js';

/**
 * The week as it is scheduled.
 *
 * Entries carry `effectiveFrom`/`effectiveTo`, so a timetable that changed in
 * September does not rewrite what August looked like. Everything here asks for
 * the arrangement in force on a given date rather than "the timetable", which
 * is not a thing that exists across a year.
 */

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export type DayOfWeek = (typeof DAYS)[number];

export interface TimetableCell {
  id: string;
  dayOfWeek: DayOfWeek;
  periodName: string;
  periodSequence: number;
  startTime: string;
  endTime: string;
  subjectName: string;
  sectionName: string;
  teacherName: string | null;
  room: string | null;
}

export async function loadTimetable(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  on: LocalDate,
  options: { sectionId?: string } = {},
): Promise<TimetableCell[]> {
  const scope = assertPermission(actor, 'timetable:read');
  const date = fromLocalDate(on);

  /**
   * The arrangement in force on `date`. Kept in its own `AND` clause so that a
   * scope filter below can use `OR` freely — merging both into one object would
   * have the scope's `OR` silently replace this one, and a teacher would get
   * the whole school's timetable including entries that expired in September.
   */
  const inForce = {
    AND: [
      { effectiveFrom: { lte: date } },
      { OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
    ],
  };

  let where: object = {
    academicYearId: year.id,
    ...inForce,
    ...(options.sectionId ? { sectionId: options.sectionId } : {}),
  };

  if (scope === 'OWN_SECTIONS') {
    // A teacher's week is the periods they teach, plus any class they are
    // class teacher of — the same sections `OWN_SECTIONS` resolves everywhere.
    const sectionIds = [...(await resolveOwnSectionIds(db, actor.userId, year.id))];
    if (options.sectionId && !sectionIds.includes(options.sectionId)) return [];
    where = {
      ...where,
      sectionId: { in: options.sectionId ? [options.sectionId] : sectionIds },
    };
  } else if (scope === 'OWN_CHILDREN' || scope === 'SELF') {
    const enrolmentIds = [
      ...(scope === 'OWN_CHILDREN'
        ? await resolveOwnChildEnrolmentIds(db, actor.userId, year.id)
        : await resolveOwnEnrolmentIds(db, actor.userId, year.id)),
    ];
    if (enrolmentIds.length === 0) return [];
    const enrolments = await db.enrolment.findMany({
      where: { id: { in: enrolmentIds } },
      select: { sectionId: true },
    });
    const sectionIds = [...new Set(enrolments.map((row) => row.sectionId))];
    if (options.sectionId && !sectionIds.includes(options.sectionId)) return [];
    where = { ...where, sectionId: { in: options.sectionId ? [options.sectionId] : sectionIds } };
  }

  const entries = await db.timetableEntry.findMany({
    where,
    orderBy: [{ periodSlot: { sequence: 'asc' } }],
    select: {
      id: true,
      dayOfWeek: true,
      room: true,
      subject: { select: { name: true } },
      section: { select: { name: true, gradeLevel: { select: { name: true } } } },
      staff: { select: { user: { select: { firstName: true, lastName: true } } } },
      periodSlot: { select: { name: true, sequence: true, startTime: true, endTime: true } },
    },
  });

  return entries
    .map((entry) => ({
      id: entry.id,
      dayOfWeek: entry.dayOfWeek,
      periodName: entry.periodSlot.name,
      periodSequence: entry.periodSlot.sequence,
      startTime: timeWire(entry.periodSlot.startTime),
      endTime: timeWire(entry.periodSlot.endTime),
      subjectName: entry.subject.name,
      sectionName: `${entry.section.gradeLevel.name} ${entry.section.name}`,
      teacherName: entry.staff
        ? `${entry.staff.user.firstName} ${entry.staff.user.lastName}`
        : null,
      room: entry.room,
    }))
    .sort(
      (a, b) =>
        DAYS.indexOf(a.dayOfWeek) - DAYS.indexOf(b.dayOfWeek) ||
        a.periodSequence - b.periodSequence,
    );
}
