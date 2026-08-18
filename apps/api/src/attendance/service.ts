import {
  fromLocalDate,
  type LocalDate,
  type Register,
  type SaveRegisterRequest,
  type SectionAttendance,
} from '@hamro/shared';
import type { TenantClient, TenantContext } from '../db/tenant.js';
import type { Actor } from '../policy/guard.js';
import {
  assertPermission,
  hasPermission,
  resolveOwnChildEnrolmentIds,
  resolveOwnEnrolmentIds,
  resolveOwnSectionIds,
} from '../policy/guard.js';
import { auditedWrite } from '../db/audit.js';
import {
  amendReasonRequired,
  closedDay,
  forbidden,
  incompleteRegister,
  lockedDay,
  notFound,
} from '../lib/errors.js';
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
    /**
     * Nobody has taken it yet.
     *
     * For someone who may *write* the register, that is not an empty screen —
     * it is a blank one waiting to be filled, so the roster comes back with
     * everyone defaulted to present. That default is the whole interaction:
     * a teacher taps the three who are absent instead of confirming forty-two
     * who are not.
     *
     * `sessionId: null` still distinguishes this from a register that was
     * taken and happened to be all present, so nothing downstream can mistake
     * a draft for a fact. A reader who cannot write gets no rows at all, which
     * is the honest answer to "what was recorded": nothing was.
     */
    // Not on a closed day, whatever the reader's permissions. A holiday has no
    // register to take, and handing a teacher a blank one to fill in invites
    // precisely the wrong action — the day must leave the denominator rather
    // than acquire a set of records (rule 6).
    if (reason !== null || !hasPermission(actor, 'attendance:write')) {
      return { ...base, sessionId: null, submittedAt: null, takenByName: null, rows: [] };
    }

    const roster = await db.enrolment.findMany({
      where: { sectionId: section.id, academicYearId: year.id, status: 'ACTIVE' },
      select: {
        id: true,
        rollNumber: true,
        student: { select: { firstName: true, middleName: true, lastName: true } },
      },
    });

    return {
      ...base,
      sessionId: null,
      submittedAt: null,
      takenByName: null,
      rows: roster
        .map((enrolment) => ({
          enrolmentId: enrolment.id,
          rollNumber: enrolment.rollNumber,
          fullName: fullName(enrolment.student),
          status: 'PRESENT' as const,
          minutesLate: null,
          remark: null,
        }))
        .sort((a, b) => a.rollNumber - b.rollNumber),
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

/**
 * Saving a register.
 *
 * The guarantees this function is responsible for, each of which is a thing a
 * school will one day argue about:
 *
 *   · **A record for every child in the session, not just the absentees.** The
 *     screen is exception-first; the storage is not. "No record" must keep
 *     meaning "no register was taken" (rule 6), and the day that stops being
 *     true, every attendance percentage in the school becomes unprovable.
 *
 *   · **Nothing is written on a closed day.** A holiday leaves the denominator
 *     rather than filling it with absences, so a register for one is refused
 *     outright instead of quietly accepted.
 *
 *   · **A locked day needs `attendance:amend` and a reason.** Changing
 *     attendance after the fact is the change someone gets asked to justify,
 *     and the reason lands in the append-only trail with the diff.
 *
 *   · **Only children actually enrolled in this section.** An entry naming
 *     somebody else's child is rejected rather than filtered, because a client
 *     sending one is either broken or probing.
 */
export async function saveRegister(
  db: TenantClient,
  ctx: TenantContext,
  actor: Actor,
  year: CurrentYear,
  input: SaveRegisterRequest,
): Promise<{ sessionId: string; submittedAt: string; saved: number; absentees: number }> {
  const scope = assertPermission(actor, 'attendance:write');

  if (scope === 'OWN_SECTIONS') {
    const own = await resolveOwnSectionIds(db, actor.userId, year.id);
    if (!own.has(input.sectionId)) throw notFound();
  } else if (scope !== 'ALL') {
    // Nobody else holds attendance:write in the matrix. If that changes, this
    // refuses rather than guessing what the new scope ought to mean.
    throw forbidden();
  }

  const section = await db.section.findFirst({
    where: { id: input.sectionId, academicYearId: year.id },
    select: { id: true, gradeLevelId: true },
  });
  if (!section) throw notFound();

  const reason = await findNonSchoolDayReason(db, year.id, input.date, {
    sectionId: section.id,
    gradeLevelId: section.gradeLevelId,
  });
  if (reason !== null) throw closedDay();

  const on = fromLocalDate(input.date);

  // The roster, as the source of truth for who may appear in this register.
  const roster = await db.enrolment.findMany({
    where: { sectionId: section.id, academicYearId: year.id, status: 'ACTIVE' },
    select: { id: true },
  });
  const rosterIds = new Set(roster.map((row) => row.id));

  const entries = input.entries.filter((entry) => rosterIds.has(entry.enrolmentId));
  if (entries.length !== input.entries.length) throw notFound();
  if (entries.length !== rosterIds.size) {
    // A partial register is a register that will be misread later: the children
    // left out look like a day nobody took, in a class where somebody did.
    throw incompleteRegister();
  }

  const existing = await db.attendanceSession.findFirst({
    where: { sectionId: section.id, date: on, sessionKey: 'DAY' },
    select: { id: true, lockedAt: true, submittedAt: true },
  });

  if (existing?.lockedAt) {
    if (!hasPermission(actor, 'attendance:amend')) throw lockedDay();
    if (!input.amendReason) throw amendReasonRequired();
  }

  const isAmendment = Boolean(existing?.submittedAt);
  const submittedAt = new Date();

  const before = existing
    ? await db.attendanceRecord.findMany({
        where: { sessionId: existing.id },
        select: { enrolmentId: true, status: true, minutesLate: true },
      })
    : [];

  const sessionId = await auditedWrite(
    db,
    ctx,
    {
      entityType: 'AttendanceSession',
      entityId: existing?.id ?? '',
      action: isAmendment ? 'UPDATE' : 'CREATE',
      before: existing ? { records: before } : null,
      after: { date: input.date, sectionId: section.id, records: entries },
      reason: input.amendReason ?? null,
    },
    async () => {
      const session = existing
        ? await db.attendanceSession.update({
            where: { id: existing.id },
            data: { takenByUserId: actor.userId, submittedAt },
          })
        : await db.attendanceSession.create({
            data: {
              schoolId: actor.schoolId,
              academicYearId: year.id,
              sectionId: section.id,
              date: on,
              sessionKey: 'DAY',
              takenByUserId: actor.userId,
              submittedAt,
            },
          });

      // Replace rather than merge. A re-save is the whole register as the
      // teacher now sees it, and a leftover row from a previous save would be
      // a child whose status silently disagrees with the screen.
      await db.attendanceRecord.deleteMany({ where: { sessionId: session.id } });

      await db.attendanceRecord.createMany({
        data: entries.map((entry) => ({
          schoolId: actor.schoolId,
          sessionId: session.id,
          enrolmentId: entry.enrolmentId,
          date: on,
          status: entry.status,
          // Minutes only mean something alongside LATE; carrying them on a
          // PRESENT row would be a number nobody can interpret later.
          minutesLate: entry.status === 'LATE' ? (entry.minutesLate ?? null) : null,
          remark: entry.remark ?? null,
          recordedByUserId: actor.userId,
        })),
      });

      return session.id;
    },
  );

  return {
    sessionId,
    submittedAt: submittedAt.toISOString(),
    saved: entries.length,
    absentees: entries.filter(
      (entry) => entry.status === 'ABSENT_UNEXPLAINED' || entry.status === 'ABSENT_APPROVED',
    ).length,
  };
}
