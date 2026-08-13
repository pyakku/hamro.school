/**
 * The permission matrix.
 *
 * This file is the whole answer to "who may do what". It is data, it is shared
 * between the API and the web app, and it is tested. Permission checks do not
 * appear as `if (user.role === 'TEACHER')` scattered through route handlers —
 * a check like that is invisible to review and impossible to audit.
 *
 * Two halves:
 *
 *   1. A permission — may this role touch this kind of thing at all?
 *      Accounts has no `mark:read` anywhere in this file, so no accounts login
 *      can read a mark through any endpoint, present or future.
 *
 *   2. A scope — *whose* records? A teacher holds `attendance:write` scoped to
 *      OWN_SECTIONS, not ALL. The API resolves the scope into a set of ids
 *      with a query; the client uses it to decide what to even ask for.
 *
 * The web app may consult this to hide a nav item. That is a courtesy, not a
 * control: every request is checked again on the server.
 */

export const ROLES = [
  'SCHOOL_ADMIN',
  'ACCOUNTS',
  'TEACHER',
  'PARENT',
  'STUDENT',
  'DRIVER',
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // School setup
  'school:read',
  'school:write',
  'academic_year:read',
  'academic_year:write',
  'structure:read', // grade levels, sections, subjects
  'structure:write',
  'calendar:read', // holidays, closures
  'calendar:write',

  // People
  'student:read',
  'student:write',
  'guardian:read',
  'guardian:write',
  'staff:read',
  'staff:write',
  'enrolment:read',
  'enrolment:write',
  'promotion:run',

  // Running the term
  'timetable:read',
  'timetable:write',
  'attendance:read',
  'attendance:write',
  'attendance:amend', // change a locked day; always audited
  'homework:read',
  'homework:write',
  'notice:read',
  'notice:write',
  'leave:read',
  'leave:request',
  'leave:approve',

  // Assessment
  'exam:read',
  'exam:write',
  'mark:read',
  'mark:write',
  'mark:publish',
  'grading_scale:read',
  'grading_scale:write',
  'report_card:read',
  'report_card:publish',

  // Money
  'fee_structure:read',
  'fee_structure:write',
  'invoice:read',
  'invoice:write',
  'payment:read',
  'payment:record',
  'payment:reverse',

  // Platform
  'audit:read',
  'device:register',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Whose records a grant covers. The API turns these into id sets:
 *
 *   ALL           every record in the school
 *   OWN_SECTIONS  sections the staff member is class teacher of, plus every
 *                 section they hold a teaching assignment for
 *   OWN_CHILDREN  enrolments of students this user is a linked guardian of
 *   SELF          the user's own record only
 */
export const SCOPES = ['ALL', 'OWN_SECTIONS', 'OWN_CHILDREN', 'SELF'] as const;
export type Scope = (typeof SCOPES)[number];

export interface Grant {
  readonly permission: Permission;
  readonly scope: Scope;
}

const all = (...permissions: Permission[]): Grant[] =>
  permissions.map((permission) => ({ permission, scope: 'ALL' as const }));

const scoped = (scope: Scope, ...permissions: Permission[]): Grant[] =>
  permissions.map((permission) => ({ permission, scope }));

/**
 * The matrix. Adding a permission to a role is a deliberate edit to this
 * object and shows up as one line in a diff.
 */
export const ROLE_GRANTS: Readonly<Record<Role, readonly Grant[]>> = {
  /** Runs the school. The only role that can change the shape of a year. */
  SCHOOL_ADMIN: [
    ...all(
      'school:read',
      'school:write',
      'academic_year:read',
      'academic_year:write',
      'structure:read',
      'structure:write',
      'calendar:read',
      'calendar:write',
      'student:read',
      'student:write',
      'guardian:read',
      'guardian:write',
      'staff:read',
      'staff:write',
      'enrolment:read',
      'enrolment:write',
      'promotion:run',
      'timetable:read',
      'timetable:write',
      'attendance:read',
      'attendance:write',
      'attendance:amend',
      'homework:read',
      'homework:write',
      'notice:read',
      'notice:write',
      'leave:read',
      'leave:request',
      'leave:approve',
      'exam:read',
      'exam:write',
      'mark:read',
      'mark:write',
      'mark:publish',
      'grading_scale:read',
      'grading_scale:write',
      'report_card:read',
      'report_card:publish',
      'fee_structure:read',
      'fee_structure:write',
      'invoice:read',
      'invoice:write',
      'payment:read',
      'payment:record',
      'payment:reverse',
      'audit:read',
    ),
    ...scoped('SELF', 'device:register'),
  ],

  /**
   * The office. Sees the ledger and the people it bills, and nothing academic:
   * no mark, no report card, no homework. This is a privacy boundary the
   * schools ask about, so it is enforced by omission here rather than by a
   * filter somewhere downstream.
   */
  ACCOUNTS: [
    ...all(
      'school:read',
      'academic_year:read',
      'structure:read',
      'calendar:read',
      'student:read',
      'guardian:read',
      'enrolment:read',
      'notice:read',
      'fee_structure:read',
      'fee_structure:write',
      'invoice:read',
      'invoice:write',
      'payment:read',
      'payment:record',
      'payment:reverse',
      'audit:read',
    ),
    ...scoped('SELF', 'device:register'),
  ],

  /**
   * Reads and writes only their own classes. `OWN_SECTIONS` is resolved from
   * TeachingAssignment and Section.classTeacherId, per academic year — which
   * is why a teacher loses access to last year's class when the year closes
   * without anyone revoking anything.
   */
  TEACHER: [
    ...all('school:read', 'academic_year:read', 'structure:read', 'calendar:read', 'notice:read'),
    ...scoped(
      'OWN_SECTIONS',
      'student:read',
      'guardian:read',
      'enrolment:read',
      'timetable:read',
      'attendance:read',
      'attendance:write',
      'homework:read',
      'homework:write',
      'notice:write',
      'leave:read',
      'leave:approve',
      'exam:read',
      'mark:read',
      'mark:write',
      'grading_scale:read',
      'report_card:read',
    ),
    ...scoped('SELF', 'leave:request', 'device:register'),
  ],

  /** Sees their own children and nothing else in the school. */
  PARENT: [
    ...all('school:read', 'academic_year:read', 'calendar:read', 'notice:read'),
    ...scoped(
      'OWN_CHILDREN',
      'student:read',
      'enrolment:read',
      'timetable:read',
      'attendance:read',
      'homework:read',
      'mark:read',
      'report_card:read',
      'invoice:read',
      'payment:read',
      'leave:read',
      'leave:request',
    ),
    ...scoped('SELF', 'guardian:read', 'device:register'),
  ],

  /** Their own record. No fees — a school bills the guardian, not the child. */
  STUDENT: [
    ...all('school:read', 'academic_year:read', 'calendar:read', 'notice:read'),
    ...scoped(
      'SELF',
      'student:read',
      'enrolment:read',
      'timetable:read',
      'attendance:read',
      'homework:read',
      'mark:read',
      'report_card:read',
      'leave:read',
      'device:register',
    ),
  ],

  /**
   * Deliberately almost empty until bus tracking exists. A driver has no
   * business reading a student record today, and the way to keep it that way
   * is to not grant it.
   */
  DRIVER: [...all('school:read', 'notice:read'), ...scoped('SELF', 'leave:request', 'device:register')],
};

const SCOPE_BREADTH: Readonly<Record<Scope, number>> = {
  SELF: 0,
  OWN_CHILDREN: 1,
  OWN_SECTIONS: 2,
  ALL: 3,
};

/**
 * The widest scope these roles grant for a permission, or null if none of them
 * grant it at all. A user holding several roles — the teacher who is also a
 * parent — gets the union, which is why this takes a list.
 */
export function resolveScope(roles: readonly Role[], permission: Permission): Scope | null {
  let widest: Scope | null = null;
  for (const role of roles) {
    for (const grant of ROLE_GRANTS[role]) {
      if (grant.permission !== permission) continue;
      if (widest === null || SCOPE_BREADTH[grant.scope] > SCOPE_BREADTH[widest]) {
        widest = grant.scope;
      }
    }
  }
  return widest;
}

/** True if any of these roles grants the permission at any scope. */
export function can(roles: readonly Role[], permission: Permission): boolean {
  return resolveScope(roles, permission) !== null;
}

/** Every permission these roles hold. For the /auth/me payload. */
export function permissionsFor(roles: readonly Role[]): Grant[] {
  const widest = new Map<Permission, Scope>();
  for (const role of roles) {
    for (const grant of ROLE_GRANTS[role]) {
      const current = widest.get(grant.permission);
      if (current === undefined || SCOPE_BREADTH[grant.scope] > SCOPE_BREADTH[current]) {
        widest.set(grant.permission, grant.scope);
      }
    }
  }
  return [...widest].map(([permission, scope]) => ({ permission, scope }));
}
