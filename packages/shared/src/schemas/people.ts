import { z } from 'zod';
import { idSchema, localDateSchema } from './common.js';
import { roleSchema } from './auth.js';

/**
 * Students, guardians and staff as the app reads them.
 *
 * A student row is really an *enrolment* row — it carries the grade, section
 * and roll number, because those belong to the year and not to the child
 * (rule 2). `studentId` is here as well, since that is what a detail page and
 * a fee ledger are keyed on, but nothing in this product asks "what grade is
 * this student in" without naming a year.
 *
 * Names are school-authored data. They are shown verbatim.
 */

export const enrolmentStatusSchema = z.enum([
  'ACTIVE',
  'COMPLETED',
  'WITHDRAWN',
  'TRANSFERRED_OUT',
]);

export const guardianRelationSchema = z.enum(['FATHER', 'MOTHER', 'GUARDIAN', 'OTHER']);

export const staffStatusSchema = z.enum(['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED']);

export const studentRowSchema = z.object({
  enrolmentId: idSchema,
  studentId: idSchema,
  admissionNumber: z.string(),
  fullName: z.string(),
  rollNumber: z.number().int(),
  sectionId: idSchema,
  sectionName: z.string(),
  gradeLevelName: z.string(),
  gradeLevel: z.number().int(),
  status: enrolmentStatusSchema,
  /** The guardian the office rings first. Absent without `guardian:read`. */
  primaryGuardianName: z.string().nullish(),
  primaryGuardianPhone: z.string().nullish(),
});

export type StudentRow = z.infer<typeof studentRowSchema>;

export const guardianRowSchema = z.object({
  id: idSchema,
  fullName: z.string(),
  relation: guardianRelationSchema,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  isPrimary: z.boolean(),
  /** Some custody arrangements deny a guardian access, and the school records it. */
  canViewRecords: z.boolean(),
});

export const studentDetailSchema = z.object({
  studentId: idSchema,
  enrolmentId: idSchema,
  admissionNumber: z.string(),
  fullName: z.string(),
  rollNumber: z.number().int(),
  sectionName: z.string(),
  gradeLevelName: z.string(),
  status: enrolmentStatusSchema,
  dateOfBirth: localDateSchema.nullable(),
  gender: z.string().nullable(),
  enrolledOn: localDateSchema,
  guardians: z.array(guardianRowSchema).optional(),
});

export type StudentDetail = z.infer<typeof studentDetailSchema>;

export const staffRowSchema = z.object({
  id: idSchema,
  userId: idSchema,
  employeeCode: z.string(),
  fullName: z.string(),
  designation: z.string().nullable(),
  department: z.string().nullable(),
  status: staffStatusSchema,
  roles: z.array(roleSchema),
  /** Sections they are class teacher of, named for display. */
  classTeacherOf: z.array(z.string()),
  subjectsTaught: z.array(z.string()),
});

export type StaffRow = z.infer<typeof staffRowSchema>;

export const studentQuerySchema = z.object({
  sectionId: idSchema.optional(),
  /** Matches a name, an admission number or a roll number. */
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
