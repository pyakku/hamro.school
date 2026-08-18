import {
  fromLocalDate,
  type LocalDate,
  type Register,
  type SectionAttendance,
} from '@hamro/shared';
import type { TenantClient } from '../db/tenant.js';
import type { Actor } from '../policy/guard.js';
import {
  assertPermission,
  resolveOwnChildEnrolmentIds,
  resolveOwnEnrolmentIds,
  resolveOwnSectionIds,
} from '../policy/guard.js';
import { notFound } from '../lib/errors.js';
import { findNonSchoolDayReason, type CurrentYear } from '../school/service.js';
import { fullName, instantWire } from '../lib/wire.js';

/**
 * Reading attendance.
 *
 * Two scope questions, and they are not the same one:
 *
 *   1. *Which sections* may this person open at all. A teacher's own; a
 *      guardian's children's; for the office, every one.
 *   2. *Which rows inside a register* may they see. This is the half that is
 *      easy to get wrong, and getting it wrong hands a parent the attendance of
 *      every other child in the class. A guardian opening 6A sees their own
 *      child's line and nothing else.
 *
 * Both are answered here, from the matrix, before any row is returned.
 */

/** The sections this actor may look at, or null for "all of them". */
async function visibleSectionIds(
  db: TenantClient,
  actor: Actor,
  academicYearId: string,
): Promise<string[] | null> {
  const scope = assertPermission(actor, 'attendance:read');

  switch (scope) {
    case 'ALL':
      return null;
    case 'OWN_SECTIONS':
      return [...(await resolveOwnSectionIds(db, actor.userId, academicYearId))];
    case 'OWN_CHILDREN':
    case 'SELF': {
      const enrolmentIds = [
        ...(scope === 'OWN_CHILDREN'
          ? await resolveOwnChildEnrolmentIds(db, actor.userId, academicYearId)
          : await resolveOwnEnrolmentIds(db, actor.userId, academicYearId)),
      ];
      if (enrolmentIds.length === 0) return [];
      const enrolments = await db.enrolment.findMany({
        where: { id: { in: enrolmentIds } },
        select: { sectionId: true },
      });
      return [...new Set(enrolments.map((row) => row.sectionId))];
    }
  }
}

/**
 * The enrolments this actor may see *inside* a register, or null for all of
 * them. A parent gets their own children's lines; a teacher gets the class.
 */
async function visibleEnrolmentIds(
  db: TenantClient,
  actor: Actor,
  academicYearId: string,
): Promise<string[] | null> {
  const scope = assertPermission(actor, 'attendance:read');
  if (scope === 'ALL' || scope === 'OWN_SECTIONS') return null;
  return [
    ...(scope === 'OWN_CHILDREN'
      ? await resolveOwnChildEnrolmentIds(db, actor.userId, academicYearId)
      : await resolveOwnEnrolmentIds(db, actor.userId, academicYearId)),
  ];
}

/**
 * The section picker, with how each class is doing.
 *
 * Two queries whatever the size of the school: the sessions for the year, and
 * the records grouped by session and status. One query per section would be a
 * query per class on a page a head of school refreshes all morning.
 */
export async function listSections(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  today: LocalDate,
): Promise<SectionAttendance[]> {
  const allowed = await visibleSectionIds(db, actor, year.id);
  if (allowed !== null && allowed.length === 0) return [];

  const sectionWhere = {
    academicYearId: year.id,
    ...(allowed ? { id: { in: allowed } } : {}),
  };

  const sections = await db.section.findMany({
    where: sectionWhere,
    select: {
      id: true,
      name: true,
      gradeLevel: { select: { name: true, level: true } },
      classTeacher: { select: { user: { select: { firstName: true, lastName: true } } } },
      _count: { select: { enrolments: true } },
    },
  });
  if (sections.length === 0) return [];

  const sectionIds = sections.map((section) => section.id);
  const on = fromLocalDate(today);

  const [sessions, grouped, takenToday] = await Promise.all([
    db.attendanceSession.findMany({
      where: { academicYearId: year.id, sectionId: { in: sectionIds } },
      select: { id: true, sectionId: true },
    }),
    db.attendanceRecord.groupBy({
      by: ['sessionId', 'status'],
      where: { session: { academicYearId: year.id, sectionId: { in: sectionIds } } },
      _count: { _all: true },
    }),
    db.attendanceSession.findMany({
      where: { sectionId: { in: sectionIds }, date: on, submittedAt: { not: null } },
      select: { sectionId: true },
    }),
  ]);

  const sectionOfSession = new Map(sessions.map((session) => [session.id, session.sectionId]));
  const stats = new Map<string, { present: number; late: number; total: number }>();

  for (const row of grouped as unknown as Array<{
    sessionId: string;
    status: string;
    _count: { _all: number };
  }>) {
    const sectionId = sectionOfSession.get(row.sessionId);
    if (!sectionId) continue;
    const stat = stats.get(sectionId) ?? { present: 0, late: 0, total: 0 };
    stat.total += row._count._all;
    if (row.status === 'PRESENT') stat.present += row._count._all;
    if (row.status === 'LATE') stat.late += row._count._all;
    stats.set(sectionId, stat);
  }

  const taken = new Set(takenToday.map((session) => session.sectionId));

  return sections
    .map((section) => {
      const stat = stats.get(section.id) ?? { present: 0, late: 0, total: 0 };
      return {
        sectionId: section.id,
        name: `${section.gradeLevel.name} ${section.name}`,
        gradeLevelName: section.gradeLevel.name,
        gradeLevel: section.gradeLevel.level,
        students: section._count.enrolments,
        classTeacherName: section.classTeacher
          ? fullName(section.classTeacher.user)
          : null,
        present: stat.present,
        late: stat.late,
        totalRecords: stat.total,
        registerTakenToday: taken.has(section.id),
      };
    })
    .sort((a, b) => a.gradeLevel - b.gradeLevel || a.name.localeCompare(b.name));
}

/**
 * One register, for one section, on one day.
 *
 * The three outcomes a school needs told apart:
 *
 *   · closed — a holiday or a closure. No records exist and none should; the
 *     day is out of every denominator, and nobody is absent (rule 6).
 *   · open, no session — nobody has taken it. A teacher owes the office a
 *     register, and that is visible rather than silently looking like a day
 *     when everybody was present.
 *   · a session — the rows, as recorded.
 */
export async function loadRegister(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  sectionId: string,
  date: LocalDate,
): Promise<Register> {
  const allowed = await visibleSectionIds(db, actor, year.id);
  if (allowed !== null && !allowed.includes(sectionId)) {
    // Not "forbidden": the reader should not learn whether the section exists.
    throw notFound();
  }

  const section = await db.section.findFirst({
    where: { id: sectionId, academicYearId: year.id },
    select: {
      id: true,
      name: true,
      gradeLevelId: true,
      gradeLevel: { select: { name: true } },
    },
  });
  if (!section) throw notFound();

  const on = fromLocalDate(date);

  const [reason, session, visible] = await Promise.all([
    findNonSchoolDayReason(db, year.id, date, {
      sectionId: section.id,
      gradeLevelId: section.gradeLevelId,
    }),
    db.attendanceSession.findFirst({
      where: { sectionId, date: on },
      select: {
        id: true,
        submittedAt: true,
        takenBy: { select: { firstName: true, lastName: true } },
      },
    }),
    visibleEnrolmentIds(db, actor, year.id),
  ]);

  const base = {
    date,
    sectionId: section.id,
    sectionName: `${section.gradeLevel.name} ${section.name}`,
    gradeLevelName: section.gradeLevel.name,
    isSchoolDay: reason === null,
    nonSchoolDayReason: reason,
  };

  if (!session) {
    return {
      ...base,
      sessionId: null,
      submittedAt: null,
      takenByName: null,
      rows: [],
    };
  }

  const records = await db.attendanceRecord.findMany({
    where: {
      sessionId: session.id,
      ...(visible ? { enrolmentId: { in: visible } } : {}),
    },
    select: {
      enrolmentId: true,
      status: true,
      minutesLate: true,
      remark: true,
      enrolment: {
        select: {
          rollNumber: true,
          student: { select: { firstName: true, middleName: true, lastName: true } },
        },
      },
    },
  });

  return {
    ...base,
    sessionId: session.id,
    submittedAt: instantWire(session.submittedAt),
    takenByName: session.takenBy ? fullName(session.takenBy) : null,
    rows: records
      .map((record) => ({
        enrolmentId: record.enrolmentId,
        rollNumber: record.enrolment.rollNumber,
        fullName: fullName(record.enrolment.student),
        status: record.status,
        minutesLate: record.minutesLate,
        remark: record.remark,
      }))
      .sort((a, b) => a.rollNumber - b.rollNumber),
  };
}

/** The section a reader lands on when they have not picked one. */
export function defaultSectionId(sections: readonly SectionAttendance[]): string | null {
  const due = sections.find((section) => !section.registerTakenToday);
  return due?.sectionId ?? sections[0]?.sectionId ?? null;
}
