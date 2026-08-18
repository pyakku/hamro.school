import {
  type StaffRow,
  type StudentDetail,
  type StudentRow,
} from '@hamro/shared';
import type { TenantClient } from '../db/tenant.js';
import type { Actor } from '../policy/guard.js';
import {
  assertPermission,
  hasPermission,
  resolveOwnChildEnrolmentIds,
  resolveOwnEnrolmentIds,
  resolveOwnSectionIds,
} from '../policy/guard.js';
import { notFound } from '../lib/errors.js';
import type { CurrentYear } from '../school/service.js';
import { dateWire, fullName } from '../lib/wire.js';

/**
 * Students, guardians and staff.
 *
 * A student row is an *enrolment* row: the grade, section and roll number
 * belong to the year, not to the child (rule 2). Ask for "the students" and
 * what you get is "the enrolments in the current year", which is the only
 * question that has an answer.
 *
 * The guardian columns are behind their own permission. A teacher reading their
 * class list gets names and roll numbers; whether they also get a parent's
 * phone number is `guardian:read`, decided by the matrix rather than by whoever
 * wrote the select.
 */

/**
 * What a search box means in a school office.
 *
 * The obvious implementation — substring-match everything — is wrong here, and
 * wrong in a way that looks like the feature is broken rather than misjudged.
 * Admission numbers carry the year: `GH-2026-0001`. Typing "2" then matches
 * every child in the school through the "2" in 2026, so the list does not
 * visibly change and the user concludes nothing happened. Typing "1" filters to
 * a third of them, so it appears to work. The bug is invisible until somebody
 * types a single digit and says "search is broken".
 *
 * So a short run of digits means the one thing it almost always means in a
 * classroom: a roll number. Longer digit strings could plausibly be an
 * admission number or a phone, so those are matched too.
 *
 * Phone matching is a plain substring against the stored text, which holds
 * numbers like `+977-9884078833`. Searching `9884` finds it; searching
 * `9884 078` does not. Normalising properly needs a digits-only column to index
 * against, which is worth doing when somebody actually searches that way.
 */
function searchFilter(search: string, canSeeGuardians: boolean): object[] {
  const digitsOnly = /^\d+$/.test(search);

  if (digitsOnly && search.length <= 2) {
    // "7" is roll number seven, not "every child admitted in a year with a 7".
    return [{ rollNumber: Number(search) }];
  }

  const contains = { contains: search, mode: 'insensitive' as const };

  return [
    { student: { firstName: contains } },
    { student: { lastName: contains } },
    { student: { admissionNumber: contains } },
    ...(digitsOnly ? [{ rollNumber: Number(search) }] : []),
    // A parent rings the office and the only thing on screen is their number.
    ...(canSeeGuardians
      ? [
          {
            student: {
              guardians: {
                some: {
                  OR: [{ guardian: { phone: contains } }, { guardian: { altPhone: contains } }],
                },
              },
            },
          },
        ]
      : []),
  ];
}

/** The enrolment filter for this reader, or null for "everyone in the year". */
async function enrolmentFilter(
  db: TenantClient,
  actor: Actor,
  academicYearId: string,
): Promise<{ id?: { in: string[] }; sectionId?: { in: string[] } } | null> {
  const scope = assertPermission(actor, 'student:read');

  switch (scope) {
    case 'ALL':
      return null;
    case 'OWN_SECTIONS': {
      const sectionIds = [...(await resolveOwnSectionIds(db, actor.userId, academicYearId))];
      return { sectionId: { in: sectionIds } };
    }
    case 'OWN_CHILDREN': {
      const ids = [...(await resolveOwnChildEnrolmentIds(db, actor.userId, academicYearId))];
      return { id: { in: ids } };
    }
    case 'SELF': {
      const ids = [...(await resolveOwnEnrolmentIds(db, actor.userId, academicYearId))];
      return { id: { in: ids } };
    }
  }
}

export async function listStudents(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  options: { sectionId?: string; search?: string; limit?: number } = {},
): Promise<StudentRow[]> {
  const filter = await enrolmentFilter(db, actor, year.id);
  const canSeeGuardians = hasPermission(actor, 'guardian:read');
  const search = options.search?.trim();

  const enrolments = await db.enrolment.findMany({
    where: {
      academicYearId: year.id,
      status: 'ACTIVE',
      ...(filter ?? {}),
      ...(options.sectionId ? { sectionId: options.sectionId } : {}),
      ...(search ? { OR: searchFilter(search, canSeeGuardians) } : {}),
    },
    take: options.limit ?? 100,
    select: {
      id: true,
      studentId: true,
      rollNumber: true,
      status: true,
      sectionId: true,
      student: {
        select: {
          admissionNumber: true,
          firstName: true,
          middleName: true,
          lastName: true,
        },
      },
      section: { select: { name: true } },
      gradeLevel: { select: { name: true, level: true } },
    },
  });

  /**
   * The guardian columns are a separate query rather than a conditional
   * `select`. Prisma infers the row type from the select object, so a spread
   * that appears only sometimes gives a type that is wrong half the time — and
   * the cast needed to paper over that would also hide a real mistake later.
   */
  const primaryGuardians = canSeeGuardians
    ? await db.studentGuardian.findMany({
        where: { studentId: { in: enrolments.map((row) => row.studentId) }, isPrimary: true },
        select: {
          studentId: true,
          guardian: { select: { firstName: true, lastName: true, phone: true } },
        },
      })
    : [];

  const guardianOf = new Map(primaryGuardians.map((link) => [link.studentId, link.guardian]));

  return enrolments
    .map((enrolment) => {
      const guardian = guardianOf.get(enrolment.studentId);

      return {
        enrolmentId: enrolment.id,
        studentId: enrolment.studentId,
        admissionNumber: enrolment.student.admissionNumber,
        fullName: fullName(enrolment.student),
        rollNumber: enrolment.rollNumber,
        sectionId: enrolment.sectionId,
        sectionName: `${enrolment.gradeLevel.name} ${enrolment.section.name}`,
        gradeLevelName: enrolment.gradeLevel.name,
        gradeLevel: enrolment.gradeLevel.level,
        status: enrolment.status,
        ...(canSeeGuardians
          ? {
              primaryGuardianName: guardian ? fullName(guardian) : null,
              primaryGuardianPhone: guardian?.phone ?? null,
            }
          : {}),
      };
    })
    .sort(
      (a, b) =>
        a.gradeLevel - b.gradeLevel ||
        a.sectionName.localeCompare(b.sectionName) ||
        a.rollNumber - b.rollNumber,
    );
}

export async function loadStudent(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  studentId: string,
): Promise<StudentDetail> {
  const filter = await enrolmentFilter(db, actor, year.id);

  const enrolment = await db.enrolment.findFirst({
    where: { academicYearId: year.id, studentId, ...(filter ?? {}) },
    select: {
      id: true,
      rollNumber: true,
      status: true,
      enrolledOn: true,
      student: {
        select: {
          id: true,
          admissionNumber: true,
          firstName: true,
          middleName: true,
          lastName: true,
          dateOfBirth: true,
          gender: true,
        },
      },
      section: { select: { name: true } },
      gradeLevel: { select: { name: true } },
    },
  });
  // A student outside this reader's scope is indistinguishable from one that
  // does not exist. Anything else leaks the roll of a class they cannot see.
  if (!enrolment) throw notFound();

  const guardians = hasPermission(actor, 'guardian:read')
    ? await db.studentGuardian.findMany({
        where: { studentId },
        select: {
          id: true,
          relation: true,
          isPrimary: true,
          canViewRecords: true,
          guardian: { select: { firstName: true, lastName: true, phone: true, email: true } },
        },
        orderBy: { isPrimary: 'desc' },
      })
    : null;

  return {
    studentId: enrolment.student.id,
    enrolmentId: enrolment.id,
    admissionNumber: enrolment.student.admissionNumber,
    fullName: fullName(enrolment.student),
    rollNumber: enrolment.rollNumber,
    sectionName: `${enrolment.gradeLevel.name} ${enrolment.section.name}`,
    gradeLevelName: enrolment.gradeLevel.name,
    status: enrolment.status,
    dateOfBirth: dateWire(enrolment.student.dateOfBirth),
    gender: enrolment.student.gender,
    enrolledOn: dateWire(enrolment.enrolledOn) ?? '1970-01-01',
    ...(guardians
      ? {
          guardians: guardians.map((link) => ({
            id: link.id,
            fullName: fullName(link.guardian),
            relation: link.relation,
            phone: link.guardian.phone,
            email: link.guardian.email,
            isPrimary: link.isPrimary,
            canViewRecords: link.canViewRecords,
          })),
        }
      : {}),
  };
}

/**
 * The staff list.
 *
 * `staff:read` is school-wide or nothing in the matrix — there is no partial
 * view of a staff room — so there is no scope filter here, only the permission
 * the route already checked.
 */
export async function listStaff(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
): Promise<StaffRow[]> {
  assertPermission(actor, 'staff:read');

  const staff = await db.staffProfile.findMany({
    select: {
      id: true,
      userId: true,
      employeeCode: true,
      designation: true,
      department: true,
      status: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          roleAssignments: {
            where: { isActive: true, revokedAt: null },
            select: { role: true },
          },
        },
      },
      classTeacherOf: {
        where: { academicYearId: year.id },
        select: { name: true, gradeLevel: { select: { name: true } } },
      },
      teachingAssignments: {
        where: { academicYearId: year.id },
        select: { subject: { select: { name: true } } },
      },
    },
  });

  return staff
    .map((member) => ({
      id: member.id,
      userId: member.userId,
      employeeCode: member.employeeCode,
      fullName: fullName(member.user),
      designation: member.designation,
      department: member.department,
      status: member.status,
      roles: [...new Set(member.user.roleAssignments.map((assignment) => assignment.role))],
      classTeacherOf: member.classTeacherOf.map(
        (section) => `${section.gradeLevel.name} ${section.name}`,
      ),
      subjectsTaught: [
        ...new Set(member.teachingAssignments.map((assignment) => assignment.subject.name)),
      ],
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}
