import { z } from 'zod';
import { idSchema, localDateSchema, moneyWireSchema } from './common.js';
import { attendanceStatusSchema } from './attendance.js';
import { noticeSummarySchema } from './communication.js';

/**
 * The overview — what a person sees the moment they sign in.
 *
 * One endpoint, and every block on it optional. That is the whole design:
 *
 *   · A block is present only if the permission matrix grants the reader the
 *     permission behind it. An accounts login has no `attendance:read`
 *     anywhere in the matrix, so `registers` is simply absent from their
 *     response — not empty, not zeroed, not filtered out on the client.
 *     Omission is the mechanism, per rule 8.
 *
 *   · A user holding two roles gets the union without any special case. The
 *     teacher who is also a parent of a child at the school sees `mySections`
 *     *and* `myChildren`, because both permissions resolve, and that is a
 *     normal case rather than an edge one (rule 7).
 *
 * The alternative — one response shape per role, or a `role` discriminator —
 * needs a new branch every time someone holds an unusual pair of roles, and
 * the branch that gets forgotten is the one that leaks.
 */

/**
 * Attendance counted, never a percentage.
 *
 * Approved leave is its own number and is never folded into "absent". A school
 * that cannot separate the two cannot answer a parent asking why their child
 * is marked down for a day the school approved (rule 6).
 */
export const attendanceTallySchema = z.object({
  present: z.number().int(),
  absentUnexplained: z.number().int(),
  absentApproved: z.number().int(),
  late: z.number().int(),
  /** Records written, which is the denominator. A closed day has none. */
  total: z.number().int(),
});

export type AttendanceTally = z.infer<typeof attendanceTallySchema>;

/** Days present out of school days *with a register*. Closed days are not in it. */
export const attendanceRunSchema = z.object({
  present: z.number().int(),
  late: z.number().int(),
  absentUnexplained: z.number().int(),
  absentApproved: z.number().int(),
  schoolDays: z.number().int(),
});

export type AttendanceRun = z.infer<typeof attendanceRunSchema>;

/** Structure counts. `structure:read` + `student:read` at ALL scope. */
export const schoolTotalsSchema = z.object({
  students: z.number().int(),
  sections: z.number().int(),
  staff: z.number().int(),
  gradeLevels: z.number().int(),
});

/**
 * Registers for the day, school-wide. `attendance:read` at ALL scope.
 *
 * `expected` counts sections that owe a register today, so `expected - taken`
 * is the number of teachers the office needs to chase — the one number an
 * administrator actually opens this product for in the morning.
 */
export const registerProgressSchema = z.object({
  expected: z.number().int(),
  taken: z.number().int(),
  tally: attendanceTallySchema,
});

/** The ledger, in a line. `invoice:read` + `payment:read` at ALL scope. */
export const feeTotalsSchema = z.object({
  invoiced: moneyWireSchema,
  collected: moneyWireSchema,
  outstanding: moneyWireSchema,
  /** Issued, unpaid, past its due date. Derived at read time, never stored. */
  overdueCount: z.number().int(),
  overdue: moneyWireSchema,
});

/** A class the signed-in teacher is responsible for today. */
export type SchoolTotals = z.infer<typeof schoolTotalsSchema>;
export type RegisterProgress = z.infer<typeof registerProgressSchema>;
export type FeeTotals = z.infer<typeof feeTotalsSchema>;

export const mySectionSchema = z.object({
  sectionId: idSchema,
  name: z.string(),
  gradeLevelName: z.string(),
  students: z.number().int(),
  /** Whether the register is in. Null when today is not a school day. */
  registerTaken: z.boolean(),
  tally: attendanceTallySchema.nullable(),
  isClassTeacher: z.boolean(),
});

export type MySection = z.infer<typeof mySectionSchema>;

/** A child of the signed-in guardian. Scoped by `canViewRecords` on the link. */
export const myChildSchema = z.object({
  enrolmentId: idSchema,
  studentId: idSchema,
  fullName: z.string(),
  rollNumber: z.number().int(),
  sectionName: z.string(),
  gradeLevelName: z.string(),
  /** Today's mark. Null when no register has been taken for the class yet. */
  todayStatus: attendanceStatusSchema.nullable(),
  term: attendanceRunSchema,
  /** What is still owed on this child's invoices. Absent without `invoice:read`. */
  outstanding: moneyWireSchema.nullish(),
});

export type MyChild = z.infer<typeof myChildSchema>;

/** A period on today's timetable, for whoever is reading. */
export const periodSchema = z.object({
  id: idSchema,
  name: z.string(),
  sequence: z.number().int(),
  /** Wall-clock at the school, `HH:MM`. A time of day, not an instant. */
  startTime: z.string(),
  endTime: z.string(),
  isTeaching: z.boolean(),
  subjectName: z.string().nullable(),
  sectionName: z.string().nullable(),
  room: z.string().nullable(),
});

export type Period = z.infer<typeof periodSchema>;

export const overviewSchema = z.object({
  today: localDateSchema,
  /** Greeting hour at the school, 0–23, so the client does not use its own clock. */
  hour: z.number().int().min(0).max(23),

  school: schoolTotalsSchema.optional(),
  registers: registerProgressSchema.optional(),
  fees: feeTotalsSchema.optional(),
  mySections: z.array(mySectionSchema).optional(),
  myChildren: z.array(myChildSchema).optional(),
  periodsToday: z.array(periodSchema).optional(),
  myAttendance: attendanceRunSchema.optional(),
  myOutstanding: moneyWireSchema.nullish(),
  notices: z.array(noticeSummarySchema).optional(),
});

export type Overview = z.infer<typeof overviewSchema>;
