import type { ExamRow, MarkRow } from '@hamro/shared';
import type { TenantClient } from '../db/tenant.js';
import type { Actor } from '../policy/guard.js';
import {
  assertPermission,
  resolveOwnChildEnrolmentIds,
  resolveOwnEnrolmentIds,
  resolveOwnSectionIds,
} from '../policy/guard.js';
import { notFound } from '../lib/errors.js';
import type { CurrentYear } from '../school/service.js';
import { dateWire, decimalWire, fullName, instantWire } from '../lib/wire.js';

/**
 * Exams and marks, read side.
 *
 * Rule 3 is the whole of the design here. `rawMarks` is what was stored and
 * `rawMarks` is what is sent — as a string, out of a `Decimal(7,2)`. Nothing in
 * this file computes a percentage, an average, a rank or a letter, because none
 * of those is a fact about a mark: they are facts about a mark *and* a grading
 * scale version, and the scale is data that the report card engine resolves at
 * publication time.
 *
 * If a screen wants "87 out of 100", it gets `rawMarks: "87"` and
 * `maxMarks: "100"` and writes the word "out of" itself, from the catalogue.
 *
 * Unpublished results are not sent to a guardian. A school decides when marks
 * are ready to be seen, and until `resultsPublishedAt` is set, they are not.
 */

/**
 * The enrolments and grade levels a narrow reader is entitled to.
 *
 * A guardian or a student is not an audience for the whole exam board. Without
 * this they receive every paper in the school — Grade 6's mathematics next to
 * their own Grade 8 science — and a school-wide marking progress count that
 * belongs to the exam officer, not to them. Neither is personal data, but both
 * are somebody else's business, and a Grade 6 paper in the list is a button
 * that returns nothing when a Grade 8 student taps it.
 */
async function readerCohort(
  db: TenantClient,
  actor: Actor,
  scope: string,
  academicYearId: string,
): Promise<{ enrolmentIds: string[]; gradeLevelIds: string[] } | null> {
  if (scope !== 'OWN_CHILDREN' && scope !== 'SELF') return null;

  const enrolmentIds = [
    ...(scope === 'OWN_CHILDREN'
      ? await resolveOwnChildEnrolmentIds(db, actor.userId, academicYearId)
      : await resolveOwnEnrolmentIds(db, actor.userId, academicYearId)),
  ];
  if (enrolmentIds.length === 0) return { enrolmentIds: [], gradeLevelIds: [] };

  const enrolments = await db.enrolment.findMany({
    where: { id: { in: enrolmentIds } },
    select: { gradeLevelId: true },
  });

  return {
    enrolmentIds,
    gradeLevelIds: [...new Set(enrolments.map((row) => row.gradeLevelId))],
  };
}

export async function listExams(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  options: { termId?: string } = {},
): Promise<ExamRow[]> {
  const scope = assertPermission(actor, 'exam:read');

  const exams = await db.exam.findMany({
    where: {
      academicYearId: year.id,
      ...(options.termId ? { termId: options.termId } : {}),
      // A parent or a student sees an exam once its results are out; staff see
      // it as soon as it is scheduled, because entering the marks is their job.
      ...(scope === 'OWN_CHILDREN' || scope === 'SELF'
        ? { resultsPublishedAt: { not: null } }
        : {}),
    },
    orderBy: [{ startDate: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      category: true,
      startDate: true,
      endDate: true,
      marksLockedAt: true,
      resultsPublishedAt: true,
      term: { select: { name: true } },
      examSubjects: { select: { id: true, gradeLevelId: true } },
    },
  });
  if (exams.length === 0) return [];

  // A guardian or student sees only the papers set for their own grade.
  const cohort = await readerCohort(db, actor, scope, year.id);
  const visibleSubjects = (subjects: { id: string; gradeLevelId: string }[]) =>
    cohort ? subjects.filter((s) => cohort.gradeLevelIds.includes(s.gradeLevelId)) : subjects;

  const examSubjectIds = exams.flatMap((exam) =>
    visibleSubjects(exam.examSubjects).map((subject) => subject.id),
  );

  // Marks entered, per exam subject, in one grouped query. For a narrow reader
  // this counts *their* marks: "how many of my results are in" rather than the
  // exam officer's school-wide progress bar.
  const entered = await db.mark.groupBy({
    by: ['examSubjectId'],
    where: {
      examSubjectId: { in: examSubjectIds },
      rawMarks: { not: null },
      ...(cohort ? { enrolmentId: { in: cohort.enrolmentIds } } : {}),
    },
    _count: { _all: true },
  });
  const enteredBySubject = new Map(
    (entered as unknown as Array<{ examSubjectId: string; _count: { _all: number } }>).map(
      (row) => [row.examSubjectId, row._count._all],
    ),
  );

  // Expected = enrolments in the grade the paper is set for.
  const gradeLevelIds = [
    ...new Set(exams.flatMap((exam) => visibleSubjects(exam.examSubjects).map((s) => s.gradeLevelId))),
  ];
  const cohorts = await db.enrolment.groupBy({
    by: ['gradeLevelId'],
    where: {
      academicYearId: year.id,
      status: 'ACTIVE',
      gradeLevelId: { in: gradeLevelIds },
      ...(cohort ? { id: { in: cohort.enrolmentIds } } : {}),
    },
    _count: { _all: true },
  });
  const cohortSize = new Map(
    (cohorts as unknown as Array<{ gradeLevelId: string; _count: { _all: number } }>).map((row) => [
      row.gradeLevelId,
      row._count._all,
    ]),
  );

  return exams.map((exam) => ({
    id: exam.id,
    name: exam.name,
    category: exam.category,
    termName: exam.term?.name ?? null,
    startDate: dateWire(exam.startDate),
    endDate: dateWire(exam.endDate),
    marksLockedAt: instantWire(exam.marksLockedAt),
    resultsPublishedAt: instantWire(exam.resultsPublishedAt),
    subjectCount: visibleSubjects(exam.examSubjects).length,
    marksEntered: visibleSubjects(exam.examSubjects).reduce(
      (total, subject) => total + (enteredBySubject.get(subject.id) ?? 0),
      0,
    ),
    marksExpected: visibleSubjects(exam.examSubjects).reduce(
      (total, subject) => total + (cohortSize.get(subject.gradeLevelId) ?? 0),
      0,
    ),
  }));
}

/** The papers in an exam, with how much marking is done. */
export async function listExamSubjects(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  examId: string,
) {
  const scope = assertPermission(actor, 'exam:read');
  const cohort = await readerCohort(db, actor, scope, year.id);

  const exam = await db.exam.findFirst({
    where: { id: examId, academicYearId: year.id },
    select: { id: true },
  });
  if (!exam) throw notFound();

  const subjects = await db.examSubject.findMany({
    where: {
      examId,
      // Their own grade only. A Grade 8 student has no business being offered
      // Grade 6's paper, and tapping it would return an empty list anyway.
      ...(cohort ? { gradeLevelId: { in: cohort.gradeLevelIds } } : {}),
    },
    orderBy: [{ examDate: 'asc' }],
    select: {
      id: true,
      maxMarks: true,
      passMarks: true,
      examDate: true,
      subject: { select: { name: true, code: true } },
      gradeLevel: { select: { id: true, name: true } },
      _count: {
        select: {
          marks: cohort ? { where: { enrolmentId: { in: cohort.enrolmentIds } } } : true,
        },
      },
    },
  });

  const cohorts = await db.enrolment.groupBy({
    by: ['gradeLevelId'],
    where: {
      academicYearId: year.id,
      status: 'ACTIVE',
      gradeLevelId: { in: subjects.map((subject) => subject.gradeLevel.id) },
      ...(cohort ? { id: { in: cohort.enrolmentIds } } : {}),
    },
    _count: { _all: true },
  });
  const cohortSize = new Map(
    (cohorts as unknown as Array<{ gradeLevelId: string; _count: { _all: number } }>).map((row) => [
      row.gradeLevelId,
      row._count._all,
    ]),
  );

  return subjects.map((subject) => ({
    id: subject.id,
    subjectName: subject.subject.name,
    subjectCode: subject.subject.code,
    gradeLevelName: subject.gradeLevel.name,
    maxMarks: decimalWire(subject.maxMarks) ?? '0',
    passMarks: decimalWire(subject.passMarks),
    examDate: dateWire(subject.examDate),
    marksEntered: subject._count.marks,
    marksExpected: cohortSize.get(subject.gradeLevel.id) ?? 0,
  }));
}

/**
 * The marks for one paper, narrowed to what the reader may see.
 *
 * A teacher sees their own sections. A guardian sees their own child, and only
 * once the school has published the results.
 */
export async function listMarks(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  examSubjectId: string,
  sectionId?: string,
): Promise<MarkRow[]> {
  const scope = assertPermission(actor, 'mark:read');

  const examSubject = await db.examSubject.findFirst({
    where: { id: examSubjectId },
    select: {
      id: true,
      maxMarks: true,
      exam: { select: { academicYearId: true, resultsPublishedAt: true } },
    },
  });
  if (!examSubject || examSubject.exam.academicYearId !== year.id) throw notFound();

  if (
    (scope === 'OWN_CHILDREN' || scope === 'SELF') &&
    examSubject.exam.resultsPublishedAt === null
  ) {
    // Not an error the reader can act on, and not a hint that marks exist.
    return [];
  }

  let enrolmentFilter: object = {};
  if (scope === 'OWN_SECTIONS') {
    const sectionIds = [...(await resolveOwnSectionIds(db, actor.userId, year.id))];
    enrolmentFilter = { sectionId: { in: sectionIds } };
  } else if (scope === 'OWN_CHILDREN') {
    const ids = [...(await resolveOwnChildEnrolmentIds(db, actor.userId, year.id))];
    enrolmentFilter = { id: { in: ids } };
  } else if (scope === 'SELF') {
    const ids = [...(await resolveOwnEnrolmentIds(db, actor.userId, year.id))];
    enrolmentFilter = { id: { in: ids } };
  }

  const marks = await db.mark.findMany({
    where: {
      examSubjectId,
      enrolment: {
        ...enrolmentFilter,
        ...(sectionId ? { sectionId } : {}),
      },
    },
    select: {
      enrolmentId: true,
      rawMarks: true,
      isAbsent: true,
      isExempt: true,
      remark: true,
      enrolment: {
        select: {
          rollNumber: true,
          student: { select: { firstName: true, middleName: true, lastName: true } },
        },
      },
    },
  });

  const maxMarks = decimalWire(examSubject.maxMarks) ?? '0';

  return marks
    .map((mark) => ({
      enrolmentId: mark.enrolmentId,
      rollNumber: mark.enrolment.rollNumber,
      fullName: fullName(mark.enrolment.student),
      // Null means "not entered", which is not zero. Averaging a zero in for a
      // child who has not been marked yet is the bug this nullability prevents.
      rawMarks: decimalWire(mark.rawMarks),
      maxMarks,
      isAbsent: mark.isAbsent,
      isExempt: mark.isExempt,
      remark: mark.remark,
    }))
    .sort((a, b) => a.rollNumber - b.rollNumber);
}
