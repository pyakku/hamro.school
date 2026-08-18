import {
  fromLocalDate,
  isWithin,
  resolveScope,
  toLocalDate,
  type AttendanceRun,
  type AttendanceTally,
  type LocalDate,
  type Overview,
} from '@hamro/shared';
import type { TenantClient } from '../db/tenant.js';
import type { Actor } from '../policy/guard.js';
import {
  hasPermission,
  resolveOwnChildEnrolmentIds,
  resolveOwnEnrolmentIds,
  resolveOwnSectionIds,
} from '../policy/guard.js';
import {
  findCurrentYear,
  findNonSchoolDayReason,
  schoolHour,
  schoolToday,
  type CurrentYear,
} from '../school/service.js';
import { listNotices } from '../communication/service.js';
import { fullName, moneyWire, timeWire } from '../lib/wire.js';

/**
 * The overview, assembled block by block from what the reader may see.
 *
 * The shape of this file is the point. There is no `switch (role)` in it. Each
 * block asks the permission matrix a question — "does this actor hold
 * `attendance:read`, and at what scope?" — and builds itself only if the answer
 * says so. Three consequences, all of them the ones rule 8 is after:
 *
 *   · An accounts login cannot receive attendance or marks from this endpoint,
 *     because `ACCOUNTS` holds neither permission anywhere in the matrix. Not
 *     filtered afterwards: never queried. That is the privacy boundary schools
 *     ask us about, and it is enforced by omission.
 *   · The teacher who is also a parent gets both `mySections` and `myChildren`
 *     with no special case, because both scopes resolve for them.
 *   · Adding a role later cannot silently widen this endpoint. It widens only by
 *     being granted a permission in the matrix — one line in a diff, with a test.
 *
 * Everything is scoped to the current academic year, which is what makes a
 * teacher's access to last year's class lapse without anyone revoking it.
 */

/** `Date.getUTCDay()` is 0-based from Sunday; the enum is not. */
const DAY_OF_WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

export interface SchoolForOverview {
  readonly timezone: string;
  readonly currency: string;
  readonly currencyMinorUnits: number;
}

/** The window a "this term" number is counted over. */
interface Window {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

const emptyTally = (): AttendanceTally => ({
  present: 0,
  absentUnexplained: 0,
  absentApproved: 0,
  late: 0,
  total: 0,
});

function addStatus(tally: AttendanceTally, status: string, count = 1): void {
  tally.total += count;
  if (status === 'PRESENT') tally.present += count;
  else if (status === 'ABSENT_UNEXPLAINED') tally.absentUnexplained += count;
  else if (status === 'ABSENT_APPROVED') tally.absentApproved += count;
  else if (status === 'LATE') tally.late += count;
}

function toRun(tally: AttendanceTally): AttendanceRun {
  return {
    present: tally.present,
    late: tally.late,
    absentUnexplained: tally.absentUnexplained,
    absentApproved: tally.absentApproved,
    // Records written, which is the honest denominator: a closed day has none,
    // so a holiday cannot drag a child's attendance down (rule 6).
    schoolDays: tally.total,
  };
}

type StatusGroup = { status: string; _count: { _all: number } };

/** Attendance counted by status in one grouped query. */
async function tallyWhere(db: TenantClient, where: object): Promise<AttendanceTally> {
  const rows = (await db.attendanceRecord.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  })) as unknown as StatusGroup[];

  const tally = emptyTally();
  for (const row of rows) addStatus(tally, row.status, row._count._all);
  return tally;
}

export async function buildOverview(
  db: TenantClient,
  actor: Actor,
  school: SchoolForOverview,
  now: Date = new Date(),
): Promise<Overview> {
  const today = schoolToday(school, now);
  const hour = schoolHour(school, now);
  const year = await findCurrentYear(db);

  const overview: Overview = { today, hour };

  // Notices need no academic year — a school still in setup can post one — so
  // they are the one block that survives having no current year. Same resolver
  // as the notices page: audience rules that exist twice drift, and the copy
  // that drifts is the one that shows 8A's trip letter to 7B's parents.
  if (hasPermission(actor, 'notice:read')) {
    overview.notices = await listNotices(db, actor, year, today, 6);
  }

  if (!year) return overview;

  const [closedReason, term] = await Promise.all([
    findNonSchoolDayReason(db, year.id, today),
    findCurrentTerm(db, year, today),
  ]);
  const isSchoolDay = closedReason === null;

  // "This term" where there is one, the year otherwise — during the summer
  // break there is no term, and a blank number is worse than a wider one.
  const window: Window = term ?? {
    from: yearStart(year, today),
    to: yearEnd(year, today),
  };

  const [totals, registers, fees, mySections, myChildren, periodsToday, myAttendance] =
    await Promise.all([
      loadSchoolTotals(db, actor, year),
      loadRegisterProgress(db, actor, year, today, isSchoolDay),
      loadFeeTotals(db, actor, school, year, today),
      loadMySections(db, actor, year, today),
      loadMyChildren(db, actor, school, year, today, window),
      loadPeriodsToday(db, actor, year, today, isSchoolDay),
      loadMyAttendance(db, actor, year, window),
    ]);

  if (totals) overview.school = totals;
  if (registers) overview.registers = registers;
  if (fees) overview.fees = fees;
  if (mySections) overview.mySections = mySections;
  if (myChildren) overview.myChildren = myChildren;
  if (periodsToday) overview.periodsToday = periodsToday;
  if (myAttendance) overview.myAttendance = myAttendance;

  return overview;
}

function yearStart(year: CurrentYear, fallback: LocalDate): LocalDate {
  return year.startDate ? toLocalDate(year.startDate) : fallback;
}

function yearEnd(year: CurrentYear, fallback: LocalDate): LocalDate {
  return year.endDate ? toLocalDate(year.endDate) : fallback;
}

async function findCurrentTerm(
  db: TenantClient,
  year: CurrentYear,
  today: LocalDate,
): Promise<Window | null> {
  const terms = await db.term.findMany({
    where: { academicYearId: year.id },
    orderBy: { sequence: 'asc' },
    select: { startDate: true, endDate: true },
  });

  for (const term of terms) {
    const from = toLocalDate(term.startDate);
    const to = toLocalDate(term.endDate);
    if (isWithin(today, from, to)) return { from, to };
  }
  return null;
}

/**
 * How big the school is. Needs `structure:read` and a school-wide
 * `student:read` — a teacher holds the first but sees only their own sections'
 * students, and a total they cannot verify is no use to them.
 */
async function loadSchoolTotals(db: TenantClient, actor: Actor, year: CurrentYear) {
  if (!hasPermission(actor, 'structure:read')) return null;
  if (resolveScope(actor.roles, 'student:read') !== 'ALL') return null;

  const [students, sections, staff, gradeLevels] = await Promise.all([
    db.enrolment.count({ where: { academicYearId: year.id, status: 'ACTIVE' } }),
    db.section.count({ where: { academicYearId: year.id } }),
    db.staffProfile.count({ where: { status: 'ACTIVE' } }),
    db.gradeLevel.count({}),
  ]);

  return { students, sections, staff, gradeLevels };
}

/**
 * Registers owed and registers in, school-wide.
 *
 * `expected` is zero on a closed day, and that is the point: a holiday does not
 * leave forty teachers looking delinquent, because no register was ever due. On
 * an open day, `expected - taken` is the office's chase list.
 */
async function loadRegisterProgress(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  today: LocalDate,
  isSchoolDay: boolean,
) {
  if (resolveScope(actor.roles, 'attendance:read') !== 'ALL') return null;

  const on = fromLocalDate(today);

  const [expected, taken, tally] = await Promise.all([
    isSchoolDay ? db.section.count({ where: { academicYearId: year.id } }) : Promise.resolve(0),
    db.attendanceSession.count({
      where: { academicYearId: year.id, date: on, submittedAt: { not: null } },
    }),
    tallyWhere(db, { date: on }),
  ]);

  return { expected, taken, tally };
}

/**
 * The ledger in four numbers.
 *
 * `collected` is the sum of `paidMinor` on invoices rather than the sum of
 * payments, so `invoiced - collected = outstanding` holds exactly. A payment not
 * yet allocated to an invoice is money in the drawer but not money against a
 * bill; mixing the two makes the three numbers stop adding up, which is the
 * first thing an accountant notices and the last thing they forgive.
 *
 * OVERDUE is derived here from the due date and the balance. It is not a status
 * in the database, because a stored one is wrong every morning until a nightly
 * job runs.
 */
async function loadFeeTotals(
  db: TenantClient,
  actor: Actor,
  school: SchoolForOverview,
  year: CurrentYear,
  today: LocalDate,
) {
  if (resolveScope(actor.roles, 'invoice:read') !== 'ALL') return null;

  const [totals, overdueRows] = await Promise.all([
    db.invoice.aggregate({
      where: { academicYearId: year.id, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] } },
      _sum: { totalMinor: true, paidMinor: true },
    }),
    db.invoice.findMany({
      where: {
        academicYearId: year.id,
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        dueDate: { lt: fromLocalDate(today) },
      },
      select: { totalMinor: true, paidMinor: true },
    }),
  ]);

  const invoiced = totals._sum.totalMinor ?? 0n;
  const collected = totals._sum.paidMinor ?? 0n;

  let overdue = 0n;
  let overdueCount = 0;
  for (const row of overdueRows) {
    const balance = row.totalMinor - row.paidMinor;
    if (balance <= 0n) continue;
    overdue += balance;
    overdueCount += 1;
  }

  return {
    invoiced: moneyWire(invoiced, school),
    collected: moneyWire(collected, school),
    outstanding: moneyWire(invoiced - collected, school),
    overdue: moneyWire(overdue, school),
    overdueCount,
  };
}

/**
 * The classes this teacher is responsible for, and whether each register is in.
 *
 * `OWN_SECTIONS` is resolved from teaching assignments and class-teacher rows
 * *in this year*, so the list empties itself when the year turns.
 */
async function loadMySections(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  today: LocalDate,
) {
  if (resolveScope(actor.roles, 'attendance:read') !== 'OWN_SECTIONS') return null;

  const sectionIds = [...(await resolveOwnSectionIds(db, actor.userId, year.id))];
  if (sectionIds.length === 0) return [];

  const on = fromLocalDate(today);

  const [staff, sections, sessions, records] = await Promise.all([
    db.staffProfile.findFirst({ where: { userId: actor.userId }, select: { id: true } }),
    db.section.findMany({
      where: { id: { in: sectionIds }, academicYearId: year.id },
      select: {
        id: true,
        name: true,
        classTeacherId: true,
        gradeLevel: { select: { name: true, level: true } },
        _count: { select: { enrolments: true } },
      },
    }),
    db.attendanceSession.findMany({
      where: { sectionId: { in: sectionIds }, date: on, submittedAt: { not: null } },
      select: { sectionId: true },
    }),
    // Per section, so each row's tally is its own. `groupBy` cannot group by a
    // field across a relation, and one query per section would be a query per
    // class on every page load.
    db.attendanceRecord.findMany({
      where: { date: on, enrolment: { sectionId: { in: sectionIds } } },
      select: { status: true, enrolment: { select: { sectionId: true } } },
    }),
  ]);

  const taken = new Set(sessions.map((session) => session.sectionId));

  const tallies = new Map<string, AttendanceTally>();
  for (const record of records) {
    const sectionId = record.enrolment.sectionId;
    const tally = tallies.get(sectionId) ?? emptyTally();
    addStatus(tally, record.status);
    tallies.set(sectionId, tally);
  }

  return sections
    .map((section) => ({
      section,
      level: section.gradeLevel.level,
      label: `${section.gradeLevel.name} ${section.name}`,
    }))
    .sort((a, b) => a.level - b.level || a.label.localeCompare(b.label))
    .map(({ section, label }) => ({
      sectionId: section.id,
      name: label,
      gradeLevelName: section.gradeLevel.name,
      students: section._count.enrolments,
      registerTaken: taken.has(section.id),
      tally: tallies.get(section.id) ?? null,
      isClassTeacher: staff !== null && section.classTeacherId === staff.id,
    }));
}

/**
 * A guardian's children.
 *
 * `resolveOwnChildEnrolmentIds` honours `canViewRecords` on the guardian link —
 * some custody arrangements deny a parent access and the school records that, so
 * it is not this function's decision to second-guess.
 */
async function loadMyChildren(
  db: TenantClient,
  actor: Actor,
  school: SchoolForOverview,
  year: CurrentYear,
  today: LocalDate,
  window: Window,
) {
  if (resolveScope(actor.roles, 'student:read') !== 'OWN_CHILDREN') return null;

  const enrolmentIds = [...(await resolveOwnChildEnrolmentIds(db, actor.userId, year.id))];
  if (enrolmentIds.length === 0) return [];

  const canSeeFees = hasPermission(actor, 'invoice:read');
  const on = fromLocalDate(today);

  const [enrolments, todayRecords, termRecords, invoices] = await Promise.all([
    db.enrolment.findMany({
      where: { id: { in: enrolmentIds } },
      select: {
        id: true,
        studentId: true,
        rollNumber: true,
        student: { select: { firstName: true, middleName: true, lastName: true } },
        section: { select: { name: true } },
        gradeLevel: { select: { name: true, level: true } },
      },
    }),
    db.attendanceRecord.findMany({
      where: { enrolmentId: { in: enrolmentIds }, date: on },
      select: { enrolmentId: true, status: true },
    }),
    db.attendanceRecord.groupBy({
      by: ['enrolmentId', 'status'],
      where: {
        enrolmentId: { in: enrolmentIds },
        date: { gte: fromLocalDate(window.from), lte: fromLocalDate(window.to) },
      },
      _count: { _all: true },
    }),
    canSeeFees
      ? db.invoice.findMany({
          where: {
            enrolmentId: { in: enrolmentIds },
            status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
          },
          select: { enrolmentId: true, totalMinor: true, paidMinor: true },
        })
      : Promise.resolve([]),
  ]);

  const statusToday = new Map(todayRecords.map((row) => [row.enrolmentId, row.status]));

  const runs = new Map<string, AttendanceTally>();
  for (const row of termRecords as unknown as Array<StatusGroup & { enrolmentId: string }>) {
    const tally = runs.get(row.enrolmentId) ?? emptyTally();
    addStatus(tally, row.status, row._count._all);
    runs.set(row.enrolmentId, tally);
  }

  const owed = new Map<string, bigint>();
  for (const invoice of invoices) {
    const balance = invoice.totalMinor - invoice.paidMinor;
    if (balance <= 0n) continue;
    owed.set(invoice.enrolmentId, (owed.get(invoice.enrolmentId) ?? 0n) + balance);
  }

  return enrolments
    .map((enrolment) => ({
      enrolment,
      level: enrolment.gradeLevel.level,
      name: fullName(enrolment.student),
    }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .map(({ enrolment, name }) => ({
      enrolmentId: enrolment.id,
      studentId: enrolment.studentId,
      fullName: name,
      rollNumber: enrolment.rollNumber,
      sectionName: `${enrolment.gradeLevel.name} ${enrolment.section.name}`,
      gradeLevelName: enrolment.gradeLevel.name,
      todayStatus: statusToday.get(enrolment.id) ?? null,
      term: toRun(runs.get(enrolment.id) ?? emptyTally()),
      ...(canSeeFees ? { outstanding: moneyWire(owed.get(enrolment.id) ?? 0n, school) } : {}),
    }));
}

/**
 * Today's periods for whoever is asking: the ones this teacher teaches, or the
 * ones this student sits in. A guardian sees a child's timetable on the child's
 * own page, where it is clear whose day is on screen.
 */
async function loadPeriodsToday(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  today: LocalDate,
  isSchoolDay: boolean,
) {
  const scope = resolveScope(actor.roles, 'timetable:read');
  if (scope !== 'OWN_SECTIONS' && scope !== 'SELF') return null;
  if (!isSchoolDay) return [];

  const on = fromLocalDate(today);
  const dayOfWeek = DAY_OF_WEEK[on.getUTCDay()];

  const effective = {
    academicYearId: year.id,
    dayOfWeek,
    effectiveFrom: { lte: on },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
  };

  let where: object;
  if (scope === 'OWN_SECTIONS') {
    const staff = await db.staffProfile.findFirst({
      where: { userId: actor.userId },
      select: { id: true },
    });
    if (!staff) return [];
    where = { ...effective, staffId: staff.id };
  } else {
    const enrolmentIds = [...(await resolveOwnEnrolmentIds(db, actor.userId, year.id))];
    if (enrolmentIds.length === 0) return [];
    const enrolments = await db.enrolment.findMany({
      where: { id: { in: enrolmentIds } },
      select: { sectionId: true },
    });
    where = { ...effective, sectionId: { in: enrolments.map((row) => row.sectionId) } };
  }

  const entries = await db.timetableEntry.findMany({
    where,
    orderBy: { periodSlot: { sequence: 'asc' } },
    select: {
      id: true,
      room: true,
      subject: { select: { name: true } },
      section: { select: { name: true, gradeLevel: { select: { name: true } } } },
      periodSlot: {
        select: { name: true, sequence: true, startTime: true, endTime: true, isTeaching: true },
      },
    },
  });

  return entries.map((entry) => ({
    id: entry.id,
    name: entry.periodSlot.name,
    sequence: entry.periodSlot.sequence,
    startTime: timeWire(entry.periodSlot.startTime),
    endTime: timeWire(entry.periodSlot.endTime),
    isTeaching: entry.periodSlot.isTeaching,
    subjectName: entry.subject.name,
    sectionName: `${entry.section.gradeLevel.name} ${entry.section.name}`,
    room: entry.room,
  }));
}

/** A student's own attendance over the current term. */
async function loadMyAttendance(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  window: Window,
) {
  if (resolveScope(actor.roles, 'attendance:read') !== 'SELF') return null;

  const enrolmentIds = [...(await resolveOwnEnrolmentIds(db, actor.userId, year.id))];
  if (enrolmentIds.length === 0) return toRun(emptyTally());

  return toRun(
    await tallyWhere(db, {
      enrolmentId: { in: enrolmentIds },
      date: { gte: fromLocalDate(window.from), lte: fromLocalDate(window.to) },
    }),
  );
}
