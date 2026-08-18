/**
 * Which models carry which cross-cutting behaviour.
 *
 * These lists are written out by hand on purpose, and `models.test.ts` reparses
 * schema.prisma and fails if they drift. A new model that carries `schoolId`
 * but is missing from TENANT_MODELS would be a model the tenant extension
 * silently does not scope — which is the exact failure we cannot afford. Better
 * to break the build.
 */

/** Every model with a `schoolId`. The tenant extension scopes all of these. */
export const TENANT_MODELS = [
  'AcademicYear',
  'Term',
  'User',
  'RoleAssignment',
  'RefreshToken',
  'PasswordResetToken',
  'Student',
  'Guardian',
  'StudentGuardian',
  'StaffProfile',
  'GradeLevel',
  'Section',
  'Subject',
  'SubjectOffering',
  'TeachingAssignment',
  'Enrolment',
  'PeriodSlot',
  'TimetableEntry',
  'AttendanceSession',
  'AttendanceRecord',
  'StaffAttendanceDay',
  'StaffAttendanceRecord',
  'Holiday',
  'Closure',
  'StudentLeaveRequest',
  'StaffLeaveRequest',
  'HomeworkPost',
  'Notice',
  'DeviceToken',
  'Exam',
  'ExamSubject',
  'Mark',
  'GradingScale',
  'GradingScaleVersion',
  'GradingBand',
  'GradingScaleAssignment',
  'ReportCardRun',
  'FeeStructure',
  'FeeItem',
  'FeeConcession',
  'Invoice',
  'InvoiceLine',
  'Payment',
  'PaymentAllocation',
  'AuditLog',
] as const;

/**
 * The two models that legitimately have no `schoolId`.
 *
 * `School` is the tenant itself. `PlatformAdmin` is us, deliberately outside
 * the tenant boundary so our support access cannot be reached through a
 * school-scoped code path.
 */
export const UNSCOPED_MODELS = ['School', 'PlatformAdmin', 'PlatformSetting'] as const;

/** Models with `deletedAt`. Reads exclude soft-deleted rows unless asked. */
export const SOFT_DELETE_MODELS = [
  'School',
  'User',
  'Student',
  'Guardian',
  'StaffProfile',
  'GradeLevel',
  'Section',
  'Subject',
  'TeachingAssignment',
  'Enrolment',
  'TimetableEntry',
  'Holiday',
  'Closure',
  'HomeworkPost',
  'Notice',
  'Exam',
  'Mark',
  'GradingScale',
  'FeeStructure',
  'FeeItem',
  'FeeConcession',
] as const;

/**
 * Marks, fees and attendance. Every write to these lands in `audit_logs`,
 * because these are the records schools have disputes about and someone will
 * eventually need to know who changed a mark, and when.
 *
 * Payments are here and are never soft-deleted — a wrong payment is corrected
 * by a reversing row, so the ledger still reconciles against a bank statement.
 */
export const AUDITED_MODELS = [
  'Mark',
  'ExamSubject',
  'AttendanceRecord',
  'AttendanceSession',
  'StaffAttendanceDay',
  'StaffAttendanceRecord',
  'Invoice',
  'InvoiceLine',
  'Payment',
  'PaymentAllocation',
  'FeeStructure',
  'FeeItem',
  'FeeConcession',
] as const;

export type TenantModel = (typeof TENANT_MODELS)[number];
export type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];
export type AuditedModel = (typeof AUDITED_MODELS)[number];

const tenantSet: ReadonlySet<string> = new Set(TENANT_MODELS);
const softDeleteSet: ReadonlySet<string> = new Set(SOFT_DELETE_MODELS);
const auditedSet: ReadonlySet<string> = new Set(AUDITED_MODELS);

export const isTenantModel = (model: string | undefined): boolean =>
  model !== undefined && tenantSet.has(model);

export const isSoftDeleteModel = (model: string | undefined): boolean =>
  model !== undefined && softDeleteSet.has(model);

export const isAuditedModel = (model: string | undefined): boolean =>
  model !== undefined && auditedSet.has(model);
