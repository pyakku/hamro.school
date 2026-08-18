import {
  daysBetween,
  fromLocalDate,
  type GradeLevelRow,
  type HolidayRow,
  type SectionRow,
  type SetupOverview,
  type SubjectRow,
} from '@hamro/shared';
import type { TenantClient } from '../db/tenant.js';
import type { Actor } from '../policy/guard.js';
import { assertPermission } from '../policy/guard.js';
import { nameTaken, notFound, stillInUse } from '../lib/errors.js';
import type { CurrentYear } from '../school/service.js';
import { dateWire, fullName } from '../lib/wire.js';

/**
 * School setup — the shape of a year.
 *
 * Two things govern every write here.
 *
 * **Sections belong to the year, grade levels do not.** "Grade 8" is a fact
 * about the school and outlives any year; "8A" is a roster with a class teacher
 * and exists once per year (rule 2). So creating a section always names the
 * current year, and last year's 8A is left exactly as it was.
 *
 * **Nothing structural is truly deleted while it is referenced.** Soft delete
 * hides a row from reads but the foreign keys survive, so removing a grade with
 * children enrolled in it would leave last year's report card pointing at a
 * blank. The answer is to refuse and say what is in the way, rather than to
 * cascade — a school that wanted to lose a year of records would have said so.
 */

export async function loadSetup(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
): Promise<SetupOverview> {
  assertPermission(actor, 'structure:read');

  const [gradeLevels, sections, subjects, holidays, staff] = await Promise.all([
    db.gradeLevel.findMany({
      select: {
        id: true,
        name: true,
        level: true,
        stage: true,
        _count: { select: { sections: true } },
      },
    }),
    db.section.findMany({
      where: { academicYearId: year.id },
      select: {
        id: true,
        name: true,
        capacity: true,
        room: true,
        classTeacherId: true,
        gradeLevel: { select: { id: true, name: true, level: true } },
        classTeacher: { select: { user: { select: { firstName: true, lastName: true } } } },
        _count: { select: { enrolments: true } },
      },
    }),
    db.subject.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        isExaminable: true,
        offerings: {
          where: { academicYearId: year.id },
          select: { gradeLevel: { select: { name: true } } },
        },
      },
    }),
    db.holiday.findMany({
      where: { academicYearId: year.id },
      orderBy: { startDate: 'asc' },
      select: { id: true, name: true, startDate: true, endDate: true },
    }),
    db.staffProfile.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  // Students per grade, counted once rather than per row.
  const enrolmentCounts = (await db.enrolment.groupBy({
    by: ['gradeLevelId'],
    where: { academicYearId: year.id, status: 'ACTIVE' },
    _count: { _all: true },
  })) as unknown as Array<{ gradeLevelId: string; _count: { _all: number } }>;
  const studentsByGrade = new Map(enrolmentCounts.map((row) => [row.gradeLevelId, row._count._all]));

  const sectionsThisYear = new Map<string, number>();
  for (const section of sections) {
    sectionsThisYear.set(
      section.gradeLevel.id,
      (sectionsThisYear.get(section.gradeLevel.id) ?? 0) + 1,
    );
  }

  return {
    gradeLevels: gradeLevels
      .map(
        (grade): GradeLevelRow => ({
          id: grade.id,
          name: grade.name,
          level: grade.level,
          stage: grade.stage,
          // Sections *this year*, not every section the grade has ever had.
          sections: sectionsThisYear.get(grade.id) ?? 0,
          students: studentsByGrade.get(grade.id) ?? 0,
        }),
      )
      .sort((a, b) => a.level - b.level),

    sections: sections
      .map(
        (section): SectionRow => ({
          id: section.id,
          name: section.name,
          gradeLevelId: section.gradeLevel.id,
          gradeLevelName: section.gradeLevel.name,
          level: section.gradeLevel.level,
          capacity: section.capacity,
          room: section.room,
          classTeacherId: section.classTeacherId,
          classTeacherName: section.classTeacher ? fullName(section.classTeacher.user) : null,
          students: section._count.enrolments,
        }),
      )
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),

    subjects: subjects
      .map(
        (subject): SubjectRow => ({
          id: subject.id,
          code: subject.code,
          name: subject.name,
          isExaminable: subject.isExaminable,
          offeredTo: [...new Set(subject.offerings.map((o) => o.gradeLevel.name))],
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name)),

    holidays: holidays.map((holiday): HolidayRow => {
      const startDate = dateWire(holiday.startDate)!;
      const endDate = dateWire(holiday.endDate)!;
      return {
        id: holiday.id,
        name: holiday.name,
        startDate,
        endDate,
        // Inclusive, so a single day is one day and not zero.
        days: daysBetween(startDate, endDate) + 1,
      };
    }),

    teachers: staff
      .map((member) => ({ id: member.id, fullName: fullName(member.user) }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
  };
}

// ── Grade levels ────────────────────────────────────────────────────────────

export async function createGradeLevel(
  db: TenantClient,
  actor: Actor,
  input: { name: string; level: number; stage?: string },
): Promise<{ id: string }> {
  assertPermission(actor, 'structure:write');

  const clash = await db.gradeLevel.findFirst({
    where: { OR: [{ name: input.name }, { level: input.level }] },
    select: { id: true },
  });
  // The level is the promotion order, so two grades sharing one is not a
  // cosmetic clash — it makes "what comes next" ambiguous at the end of a year.
  if (clash) throw nameTaken();

  const grade = await db.gradeLevel.create({
    data: {
      schoolId: actor.schoolId,
      name: input.name,
      level: input.level,
      stage: input.stage ?? null,
    },
    select: { id: true },
  });
  return grade;
}

export async function updateGradeLevel(
  db: TenantClient,
  actor: Actor,
  id: string,
  input: { name?: string; level?: number; stage?: string },
): Promise<void> {
  assertPermission(actor, 'structure:write');

  const existing = await db.gradeLevel.findFirst({ where: { id }, select: { id: true } });
  if (!existing) throw notFound();

  if (input.name !== undefined || input.level !== undefined) {
    const clash = await db.gradeLevel.findFirst({
      where: {
        id: { not: id },
        OR: [
          ...(input.name !== undefined ? [{ name: input.name }] : []),
          ...(input.level !== undefined ? [{ level: input.level }] : []),
        ],
      },
      select: { id: true },
    });
    if (clash) throw nameTaken();
  }

  await db.gradeLevel.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.level !== undefined ? { level: input.level } : {}),
      ...(input.stage !== undefined ? { stage: input.stage } : {}),
    },
  });
}

export async function deleteGradeLevel(
  db: TenantClient,
  actor: Actor,
  id: string,
): Promise<void> {
  assertPermission(actor, 'structure:write');

  const grade = await db.gradeLevel.findFirst({
    where: { id },
    select: { id: true, _count: { select: { sections: true, enrolments: true } } },
  });
  if (!grade) throw notFound();

  // A grade with a roster behind it is load-bearing: enrolments, marks and
  // invoices all point through it, including last year's.
  if (grade._count.sections > 0 || grade._count.enrolments > 0) throw stillInUse();

  await db.gradeLevel.update({
    where: { id },
    // These three carry `deletedAt` but no `deletedByUserId`; only the people
    // tables record who removed a row.
    data: { deletedAt: new Date() },
  });
}

// ── Sections ────────────────────────────────────────────────────────────────

export async function createSection(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  input: {
    gradeLevelId: string;
    name: string;
    capacity?: number | null;
    room?: string | null;
    classTeacherId?: string | null;
  },
): Promise<{ id: string }> {
  assertPermission(actor, 'structure:write');

  const grade = await db.gradeLevel.findFirst({
    where: { id: input.gradeLevelId },
    select: { id: true },
  });
  if (!grade) throw notFound();

  // Unique per grade *per year*: 8A exists again next year, as a different
  // roster with a different class teacher (rule 2).
  const clash = await db.section.findFirst({
    where: { academicYearId: year.id, gradeLevelId: input.gradeLevelId, name: input.name },
    select: { id: true },
  });
  if (clash) throw nameTaken();

  if (input.classTeacherId) {
    const staff = await db.staffProfile.findFirst({
      where: { id: input.classTeacherId },
      select: { id: true },
    });
    if (!staff) throw notFound();
  }

  return db.section.create({
    data: {
      schoolId: actor.schoolId,
      academicYearId: year.id,
      gradeLevelId: input.gradeLevelId,
      name: input.name,
      capacity: input.capacity ?? null,
      room: input.room ?? null,
      classTeacherId: input.classTeacherId ?? null,
    },
    select: { id: true },
  });
}

export async function updateSection(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  id: string,
  input: {
    name?: string;
    capacity?: number | null;
    room?: string | null;
    classTeacherId?: string | null;
  },
): Promise<void> {
  assertPermission(actor, 'structure:write');

  const section = await db.section.findFirst({
    where: { id, academicYearId: year.id },
    select: { id: true, gradeLevelId: true },
  });
  if (!section) throw notFound();

  if (input.name !== undefined) {
    const clash = await db.section.findFirst({
      where: {
        id: { not: id },
        academicYearId: year.id,
        gradeLevelId: section.gradeLevelId,
        name: input.name,
      },
      select: { id: true },
    });
    if (clash) throw nameTaken();
  }

  await db.section.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.room !== undefined ? { room: input.room } : {}),
      ...(input.classTeacherId !== undefined ? { classTeacherId: input.classTeacherId } : {}),
    },
  });
}

export async function deleteSection(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  id: string,
): Promise<void> {
  assertPermission(actor, 'structure:write');

  const section = await db.section.findFirst({
    where: { id, academicYearId: year.id },
    select: { id: true, _count: { select: { enrolments: true } } },
  });
  if (!section) throw notFound();
  if (section._count.enrolments > 0) throw stillInUse();

  await db.section.update({
    where: { id },
    // These three carry `deletedAt` but no `deletedByUserId`; only the people
    // tables record who removed a row.
    data: { deletedAt: new Date() },
  });
}

// ── Subjects ────────────────────────────────────────────────────────────────

export async function createSubject(
  db: TenantClient,
  actor: Actor,
  input: { code: string; name: string; isExaminable: boolean },
): Promise<{ id: string }> {
  assertPermission(actor, 'structure:write');

  const clash = await db.subject.findFirst({
    where: { OR: [{ code: input.code }, { name: input.name }] },
    select: { id: true },
  });
  if (clash) throw nameTaken();

  return db.subject.create({
    data: {
      schoolId: actor.schoolId,
      code: input.code,
      name: input.name,
      isExaminable: input.isExaminable,
    },
    select: { id: true },
  });
}

export async function updateSubject(
  db: TenantClient,
  actor: Actor,
  id: string,
  input: { code?: string; name?: string; isExaminable?: boolean },
): Promise<void> {
  assertPermission(actor, 'structure:write');

  const existing = await db.subject.findFirst({ where: { id }, select: { id: true } });
  if (!existing) throw notFound();

  if (input.code !== undefined || input.name !== undefined) {
    const clash = await db.subject.findFirst({
      where: {
        id: { not: id },
        OR: [
          ...(input.code !== undefined ? [{ code: input.code }] : []),
          ...(input.name !== undefined ? [{ name: input.name }] : []),
        ],
      },
      select: { id: true },
    });
    if (clash) throw nameTaken();
  }

  await db.subject.update({
    where: { id },
    data: {
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.isExaminable !== undefined ? { isExaminable: input.isExaminable } : {}),
    },
  });
}

export async function deleteSubject(db: TenantClient, actor: Actor, id: string): Promise<void> {
  assertPermission(actor, 'structure:write');

  const subject = await db.subject.findFirst({
    where: { id },
    select: {
      id: true,
      _count: { select: { examSubjects: true, teachingAssignments: true, homeworkPosts: true } },
    },
  });
  if (!subject) throw notFound();

  // Marks hang off ExamSubject, which hangs off this. Removing it would orphan
  // a published result.
  if (
    subject._count.examSubjects > 0 ||
    subject._count.teachingAssignments > 0 ||
    subject._count.homeworkPosts > 0
  ) {
    throw stillInUse();
  }

  await db.subject.update({
    where: { id },
    // These three carry `deletedAt` but no `deletedByUserId`; only the people
    // tables record who removed a row.
    data: { deletedAt: new Date() },
  });
}

// ── The calendar ────────────────────────────────────────────────────────────

export async function createHoliday(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  input: { name: string; startDate: string; endDate: string },
): Promise<{ id: string }> {
  assertPermission(actor, 'calendar:write');

  /**
   * A holiday declared over days that already have registers is not refused —
   * schools do close retrospectively, for a bereavement or a strike — but it is
   * worth knowing that those records stay put. Attendance already taken is not
   * silently deleted here; the office would have to amend the day, which is
   * audited. Quietly erasing a register because somebody added a holiday over
   * it is exactly the sort of invisible data loss rule 6 is written against.
   */
  return db.holiday.create({
    data: {
      schoolId: actor.schoolId,
      academicYearId: year.id,
      name: input.name,
      startDate: fromLocalDate(input.startDate),
      endDate: fromLocalDate(input.endDate),
      scope: 'SCHOOL',
    },
    select: { id: true },
  });
}

export async function deleteHoliday(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  id: string,
): Promise<void> {
  assertPermission(actor, 'calendar:write');

  const holiday = await db.holiday.findFirst({
    where: { id, academicYearId: year.id },
    select: { id: true },
  });
  if (!holiday) throw notFound();

  await db.holiday.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}
