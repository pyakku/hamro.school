import { z } from 'zod';
import { idSchema, localDateSchema } from './common.js';
import { attendanceStatusSchema } from './attendance.js';
import { staffStatusSchema } from './people.js';

/**
 * Whether staff were in.
 *
 * The same four states as a child's attendance, deliberately: a school that
 * cannot separate approved leave from an unexplained absence cannot answer a
 * teacher disputing a pay deduction, which is the staff-room version of the
 * argument rule 6 exists to settle. Sharing the enum also means sharing the
 * vocabulary — one set of words, one set of colours, on both screens.
 *
 * A school takes this once for the whole staff rather than per section, so the
 * unit is the day: `submittedAt` on the day records that the return was made,
 * and its absence means nobody has done it. A closed day has no records at all.
 */

export const staffAttendanceRowSchema = z.object({
  staffId: idSchema,
  employeeCode: z.string(),
  fullName: z.string(),
  designation: z.string().nullable(),
  staffStatus: staffStatusSchema,
  status: attendanceStatusSchema,
  minutesLate: z.number().int().nullable(),
  remark: z.string().nullable(),
  /**
   * Set when an approved leave request covers this day, so the two records
   * cannot drift. The office should not have to remember what it already
   * approved.
   */
  onApprovedLeave: z.boolean(),
  leaveType: z.string().nullable(),
});

export type StaffAttendanceRow = z.infer<typeof staffAttendanceRowSchema>;

export const staffAttendanceDaySchema = z.object({
  date: localDateSchema,
  isSchoolDay: z.boolean(),
  nonSchoolDayReason: z.string().nullable(),
  /** Null when nobody has taken the return for this day. */
  dayId: idSchema.nullable(),
  submittedAt: z.string().nullable(),
  takenByName: z.string().nullable(),
  lockedAt: z.string().nullable(),
  rows: z.array(staffAttendanceRowSchema),
});

export type StaffAttendanceDayView = z.infer<typeof staffAttendanceDaySchema>;

export const staffAttendanceQuerySchema = z.object({
  date: localDateSchema.optional(),
});

export const staffAttendanceEntrySchema = z.object({
  staffId: idSchema,
  status: attendanceStatusSchema,
  minutesLate: z.number().int().min(0).max(600).nullish(),
  remark: z.string().trim().max(280).nullish(),
});

export const saveStaffAttendanceRequestSchema = z.object({
  date: localDateSchema,
  entries: z.array(staffAttendanceEntrySchema).min(1).max(500),
  amendReason: z.string().trim().min(3).max(280).optional(),
});

export type SaveStaffAttendanceRequest = z.infer<typeof saveStaffAttendanceRequestSchema>;

export const saveStaffAttendanceResponseSchema = z.object({
  dayId: idSchema,
  submittedAt: z.string(),
  saved: z.number().int(),
  absentees: z.number().int(),
});

/** A staff member's own run of attendance, for their overview. */
export const staffAttendanceRunSchema = z.object({
  present: z.number().int(),
  late: z.number().int(),
  absentUnexplained: z.number().int(),
  absentApproved: z.number().int(),
  daysRecorded: z.number().int(),
});
