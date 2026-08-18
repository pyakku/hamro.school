import { z } from 'zod';
import { idSchema, localDateSchema } from './common.js';

/**
 * Exams and marks.
 *
 * Rule 3, and it governs every field here: **raw marks only**. No letter, no
 * band, no GPA, no percentage, no average, no rank crosses this wire, because
 * none of them is stored — a grade is computed from raw marks through the
 * school's configured scale, at read time, by the report card engine.
 *
 * `rawMarks` is a **string** for the same reason money is. It is a
 * `Decimal(7,2)` in Postgres; turning it into a JavaScript number to get it
 * across is how 87.35 becomes 87.34999999999999, and a mark is a thing a
 * parent may query.
 *
 * `isAbsent` and `isExempt` are not zeros. A child who missed an exam has not
 * scored nothing, and averaging a zero in is the bug this distinction prevents.
 */

const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/);

export const examRowSchema = z.object({
  id: idSchema,
  name: z.string(),
  category: z.string().nullable(),
  termName: z.string().nullable(),
  startDate: localDateSchema.nullable(),
  endDate: localDateSchema.nullable(),
  /** An instant. Once locked, marks are amended only through an audited path. */
  marksLockedAt: z.string().nullable(),
  resultsPublishedAt: z.string().nullable(),
  subjectCount: z.number().int(),
  /** Marks entered against marks expected — the progress an exam officer chases. */
  marksEntered: z.number().int(),
  marksExpected: z.number().int(),
});

export type ExamRow = z.infer<typeof examRowSchema>;

export const examSubjectRowSchema = z.object({
  id: idSchema,
  subjectName: z.string(),
  subjectCode: z.string(),
  gradeLevelName: z.string(),
  maxMarks: decimalStringSchema,
  passMarks: decimalStringSchema.nullable(),
  examDate: localDateSchema.nullable(),
  marksEntered: z.number().int(),
  marksExpected: z.number().int(),
});

export const markRowSchema = z.object({
  enrolmentId: idSchema,
  rollNumber: z.number().int(),
  fullName: z.string(),
  /** Null when nothing has been entered yet — which is not the same as zero. */
  rawMarks: decimalStringSchema.nullable(),
  maxMarks: decimalStringSchema,
  isAbsent: z.boolean(),
  isExempt: z.boolean(),
  remark: z.string().nullable(),
});

export type MarkRow = z.infer<typeof markRowSchema>;

/** A child's marks for one exam, as a guardian sees them. */
export const childExamResultSchema = z.object({
  examId: idSchema,
  examName: z.string(),
  termName: z.string().nullable(),
  /** Results a school has not published are not sent to a parent at all. */
  publishedAt: z.string().nullable(),
  subjects: z.array(
    z.object({
      subjectName: z.string(),
      rawMarks: decimalStringSchema.nullable(),
      maxMarks: decimalStringSchema,
      isAbsent: z.boolean(),
      isExempt: z.boolean(),
    }),
  ),
});

export const examQuerySchema = z.object({
  termId: idSchema.optional(),
});

export const markQuerySchema = z.object({
  examSubjectId: idSchema,
  sectionId: idSchema.optional(),
});
