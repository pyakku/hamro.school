import { z } from 'zod';
import { idSchema, localDateSchema } from './common.js';

/**
 * Attendance on the wire.
 *
 * Four states, never a boolean (rule 6). "Absent" and "absent, and the school
 * approved it" are different facts about a child, and a product that stores one
 * bit can never separate them again.
 */
export const attendanceStatusSchema = z.enum([
  'PRESENT',
  'ABSENT_UNEXPLAINED',
  'ABSENT_APPROVED',
  'LATE',
]);

export type AttendanceStatusWire = z.infer<typeof attendanceStatusSchema>;

/** One student's line in a register. */
export const registerRowSchema = z.object({
  enrolmentId: idSchema,
  rollNumber: z.number().int(),
  fullName: z.string(),
  status: attendanceStatusSchema,
  minutesLate: z.number().int().nullable(),
  remark: z.string().nullable(),
});

export type RegisterRow = z.infer<typeof registerRowSchema>;

/**
 * A register for one section on one day.
 *
 * The three states this has to tell apart, because they mean different things
 * to a school and are the whole reason `AttendanceSession` exists:
 *
 *   · `isSchoolDay: false` — a holiday or a closure. No records, and the day is
 *     out of every denominator. Nobody is absent.
 *   · `session: null` on a school day — nobody has taken it. A teacher owes the
 *     office a register.
 *   · a session with `submittedAt: null` — started, not finished.
 */
export const registerSchema = z.object({
  date: localDateSchema,
  sectionId: idSchema,
  sectionName: z.string(),
  gradeLevelName: z.string(),
  isSchoolDay: z.boolean(),
  nonSchoolDayReason: z.string().nullable(),
  sessionId: idSchema.nullable(),
  submittedAt: z.string().nullable(),
  takenByName: z.string().nullable(),
  rows: z.array(registerRowSchema),
});

export type Register = z.infer<typeof registerSchema>;

/** A section in the attendance picker, with how it is doing this term. */
export const sectionAttendanceSchema = z.object({
  sectionId: idSchema,
  name: z.string(),
  gradeLevelName: z.string(),
  gradeLevel: z.number().int(),
  students: z.number().int(),
  classTeacherName: z.string().nullable(),
  /** Records this term, so the client can show a rate without a stored number. */
  present: z.number().int(),
  late: z.number().int(),
  totalRecords: z.number().int(),
  registerTakenToday: z.boolean(),
});

export type SectionAttendance = z.infer<typeof sectionAttendanceSchema>;

export const registerQuerySchema = z.object({
  sectionId: idSchema,
  /** Defaults to today at the school, not today in the browser. */
  date: localDateSchema.optional(),
});

/**
 * Saving a register.
 *
 * The client sends a status for **every** enrolment in the class, not just the
 * absentees. The interface is exception-first — everyone starts present and a
 * teacher taps the three who are not — but the storage is not: rule 6 wants a
 * row per child per session, because "no record" has to keep meaning "no
 * register was taken" rather than "present". Collapsing the two is what makes
 * an attendance percentage unarguable a year later.
 */
export const registerEntrySchema = z.object({
  enrolmentId: idSchema,
  status: attendanceStatusSchema,
  /** Only meaningful with LATE; the server clears it otherwise. */
  minutesLate: z.number().int().min(0).max(600).nullish(),
  remark: z.string().trim().max(280).nullish(),
});

export const saveRegisterRequestSchema = z.object({
  sectionId: idSchema,
  date: localDateSchema,
  entries: z.array(registerEntrySchema).min(1).max(200),
  /**
   * Required to change a day the school has already locked. The reason goes
   * into the audit trail, because amending attendance after the fact is
   * exactly the change someone will be asked to justify.
   */
  amendReason: z.string().trim().min(3).max(280).optional(),
});

export type SaveRegisterRequest = z.infer<typeof saveRegisterRequestSchema>;

export const saveRegisterResponseSchema = z.object({
  sessionId: idSchema,
  submittedAt: z.string(),
  saved: z.number().int(),
  /** Guardians the school would notify of an absence. Counted, not sent — yet. */
  absentees: z.number().int(),
});
