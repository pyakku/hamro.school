import {
  fromLocalDate,
  type LocalDate,
  type SaveStaffAttendanceRequest,
  type StaffAttendanceDayView,
} from '@hamro/shared';
import type { TenantClient, TenantContext } from '../db/tenant.js';
import type { Actor } from '../policy/guard.js';
import { assertPermission, hasPermission } from '../policy/guard.js';
import { auditedWrite } from '../db/audit.js';
import { amendReasonRequired, closedDay, forbidden, lockedDay, notFound } from '../lib/errors.js';
import { findNonSchoolDayReason, type CurrentYear } from '../school/service.js';
import { fullName, instantWire } from '../lib/wire.js';

/**
 * Staff attendance.
 *
 * The same shape as a class register, for the same reasons: a day that was
 * never taken must stay distinguishable from a day when everyone was in, and a
 * closed day must have no records at all (rule 6). Sharing the status enum is
 * deliberate too — a school that cannot separate approved leave from an
 * unexplained absence cannot answer a teacher disputing a pay deduction, which
 * is the staff-room version of the argument that rule exists to settle.
 *
 * What differs is scope. There is one return for the whole school rather than
 * one per section, and "whose row may I see" has two answers rather than four:
 * the office sees the staff room, a teacher sees themselves.
 *
 * Approved leave is read from `StaffLeaveRequest` rather than typed again. The
 * office has already decided; asking a clerk to remember that while taking the
 * return is exactly how the leave register and the attendance register stop
 * agreeing with each other.
 */

/** The staff rows this reader may see, or null for all of them. */
async function visibleStaffIds(db: TenantClient, actor: Actor): Promise<string[] | null> {
  const scope = assertPermission(actor, 'staff_attendance:read');
  if (scope === 'ALL') return null;

  // SELF: their own row, and only if they have a staff profile at all.
  const staff = await db.staffProfile.findFirst({
    where: { userId: actor.userId },
    select: { id: true },
  });
  return staff ? [staff.id] : [];
}

export async function loadStaffAttendance(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  date: LocalDate,
): Promise<StaffAttendanceDayView> {
  const allowed = await visibleStaffIds(db, actor);
  const on = fromLocalDate(date);

  const [reason, day] = await Promise.all([
    findNonSchoolDayReason(db, year.id, date),
    db.staffAttendanceDay.findFirst({
      where: { date: on },
      select: {
        id: true,
        submittedAt: true,
        lockedAt: true,
        takenBy: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const base = {
    date,
    isSchoolDay: reason === null,
    nonSchoolDayReason: reason,
    dayId: day?.id ?? null,
    submittedAt: instantWire(day?.submittedAt),
    takenByName: day?.takenBy ? fullName(day.takenBy) : null,
    lockedAt: instantWire(day?.lockedAt),
  };

  // A closed day has no return to take and none to show.
  if (reason !== null) return { ...base, rows: [] };

  const staff = await db.staffProfile.findMany({
    where: {
      status: { in: ['ACTIVE', 'ON_LEAVE'] },
      ...(allowed ? { id: { in: allowed } } : {}),
    },
    select: {
      id: true,
      employeeCode: true,
      designation: true,
      status: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  if (staff.length === 0) return { ...base, rows: [] };

  const staffIds = staff.map((member) => member.id);

  const [records, leave] = await Promise.all([
    day
      ? db.staffAttendanceRecord.findMany({
          where: { dayId: day.id, staffId: { in: staffIds } },
          select: { staffId: true, status: true, minutesLate: true, remark: true },
        })
      : Promise.resolve([]),
    db.staffLeaveRequest.findMany({
      where: {
        staffId: { in: staffIds },
        status: 'APPROVED',
        startDate: { lte: on },
        endDate: { gte: on },
      },
      select: { staffId: true, leaveType: true },
    }),
  ]);

  const recorded = new Map(records.map((record) => [record.staffId, record]));
  const approved = new Map(leave.map((request) => [request.staffId, request.leaveType]));

  return {
    ...base,
    rows: staff
      .map((member) => {
        const record = recorded.get(member.id);
        const leaveType = approved.get(member.id) ?? null;

        return {
          staffId: member.id,
          employeeCode: member.employeeCode,
          fullName: fullName(member.user),
          designation: member.designation,
          staffStatus: member.status,
          /**
           * Nothing recorded yet defaults to present — except for somebody the
           * office has already approved leave for, who defaults to that.
           */
          status:
            record?.status ??
            (leaveType !== null ? ('ABSENT_APPROVED' as const) : ('PRESENT' as const)),
          minutesLate: record?.minutesLate ?? null,
          remark: record?.remark ?? null,
          onApprovedLeave: leaveType !== null,
          leaveType,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
  };
}

export async function saveStaffAttendance(
  db: TenantClient,
  ctx: TenantContext,
  actor: Actor,
  year: CurrentYear,
  input: SaveStaffAttendanceRequest,
): Promise<{ dayId: string; submittedAt: string; saved: number; absentees: number }> {
  const scope = assertPermission(actor, 'staff_attendance:write');
  // Only the office holds this, at ALL scope. Nobody marks their own
  // attendance, which is the first thing anybody would ask about.
  if (scope !== 'ALL') throw forbidden();

  const reason = await findNonSchoolDayReason(db, year.id, input.date);
  if (reason !== null) throw closedDay();

  const on = fromLocalDate(input.date);

  const roster = await db.staffProfile.findMany({
    where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } },
    select: { id: true },
  });
  const rosterIds = new Set(roster.map((member) => member.id));

  const entries = input.entries.filter((entry) => rosterIds.has(entry.staffId));
  if (entries.length !== input.entries.length) throw notFound();

  const existing = await db.staffAttendanceDay.findFirst({
    where: { date: on },
    select: { id: true, lockedAt: true, submittedAt: true },
  });

  if (existing?.lockedAt) {
    if (!hasPermission(actor, 'attendance:amend')) throw lockedDay();
    if (!input.amendReason) throw amendReasonRequired();
  }

  const before = existing
    ? await db.staffAttendanceRecord.findMany({
        where: { dayId: existing.id },
        select: { staffId: true, status: true, minutesLate: true },
      })
    : [];

  // Approved leave wins over whatever the form sent: the school's own decision
  // is the record of truth, not a control somebody skimmed past.
  const approved = new Set(
    (
      await db.staffLeaveRequest.findMany({
        where: {
          staffId: { in: entries.map((entry) => entry.staffId) },
          status: 'APPROVED',
          startDate: { lte: on },
          endDate: { gte: on },
        },
        select: { staffId: true },
      })
    ).map((request) => request.staffId),
  );

  const submittedAt = new Date();

  const dayId = await auditedWrite(
    db,
    ctx,
    {
      entityType: 'StaffAttendanceDay',
      entityId: existing?.id ?? '',
      action: existing?.submittedAt ? 'UPDATE' : 'CREATE',
      before: existing ? { records: before } : null,
      after: { date: input.date, records: entries },
      reason: input.amendReason ?? null,
    },
    async () => {
      const day = existing
        ? await db.staffAttendanceDay.update({
            where: { id: existing.id },
            data: { takenByUserId: actor.userId, submittedAt },
          })
        : await db.staffAttendanceDay.create({
            data: {
              schoolId: actor.schoolId,
              academicYearId: year.id,
              date: on,
              takenByUserId: actor.userId,
              submittedAt,
            },
          });

      await db.staffAttendanceRecord.deleteMany({ where: { dayId: day.id } });

      await db.staffAttendanceRecord.createMany({
        data: entries.map((entry) => {
          const status = approved.has(entry.staffId) ? ('ABSENT_APPROVED' as const) : entry.status;
          return {
            schoolId: actor.schoolId,
            dayId: day.id,
            staffId: entry.staffId,
            date: on,
            status,
            minutesLate: status === 'LATE' ? (entry.minutesLate ?? null) : null,
            remark: entry.remark ?? null,
            recordedByUserId: actor.userId,
          };
        }),
      });

      return day.id;
    },
  );

  return {
    dayId,
    submittedAt: submittedAt.toISOString(),
    saved: entries.length,
    absentees: entries.filter((entry) => entry.status === 'ABSENT_UNEXPLAINED').length,
  };
}
