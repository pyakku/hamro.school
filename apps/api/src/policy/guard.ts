import type { Permission, Role, Scope } from '@hamro/shared';
import { resolveScope } from '@hamro/shared';
import { forbidden } from '../lib/errors.js';
import type { TenantClient } from '../db/tenant.js';

/**
 * The policy layer.
 *
 * Permission checks happen here and in `packages/shared/src/permissions`, on
 * the server, per resource. Hiding a button is a courtesy to the user; it is
 * not access control, and anyone who opens the network tab can see through it.
 *
 * A check has two halves. `assertPermission` answers "may this role do this
 * kind of thing at all". The scope resolvers answer "to whose records" — and
 * that half needs the database, because "their own classes" is a fact about
 * TeachingAssignment rows, not about a token.
 */

export interface Actor {
  readonly userId: string;
  readonly schoolId: string;
  readonly roles: readonly Role[];
}

/** Throws unless the actor holds the permission at some scope. */
export function assertPermission(actor: Actor, permission: Permission): Scope {
  const scope = resolveScope(actor.roles, permission);
  if (scope === null) throw forbidden();
  return scope;
}

export function hasPermission(actor: Actor, permission: Permission): boolean {
  return resolveScope(actor.roles, permission) !== null;
}

/**
 * Sections a staff member may act on: the ones they are class teacher of, plus
 * the ones they hold a teaching assignment for.
 *
 * Scoped to an academic year, which is what makes access expire on its own. A
 * teacher loses last year's class when the year turns, because their teaching
 * assignments are rows in that year and this query asks for the current one —
 * not because anybody remembered to revoke anything.
 */
export async function resolveOwnSectionIds(
  db: TenantClient,
  userId: string,
  academicYearId: string,
): Promise<Set<string>> {
  const staff = await db.staffProfile.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (!staff) return new Set();

  const [assignments, classTeacherOf] = await Promise.all([
    db.teachingAssignment.findMany({
      where: { staffId: staff.id, academicYearId },
      select: { sectionId: true },
    }),
    db.section.findMany({
      where: { classTeacherId: staff.id, academicYearId },
      select: { id: true },
    }),
  ]);

  return new Set([
    ...assignments.map((assignment) => assignment.sectionId),
    ...classTeacherOf.map((section) => section.id),
  ]);
}

/**
 * Sections a staff member may enter marks for, narrowed to one subject. A
 * class teacher can take the register for the whole section but may only mark
 * the subject they actually teach it.
 */
export async function resolveMarkableSubjectSections(
  db: TenantClient,
  userId: string,
  academicYearId: string,
): Promise<Set<string>> {
  const staff = await db.staffProfile.findFirst({ where: { userId }, select: { id: true } });
  if (!staff) return new Set();

  const assignments = await db.teachingAssignment.findMany({
    where: { staffId: staff.id, academicYearId, canEnterMarks: true },
    select: { sectionId: true, subjectId: true },
  });

  return new Set(assignments.map((a) => `${a.sectionId}:${a.subjectId}`));
}

/**
 * Enrolments belonging to this user's children.
 *
 * `canViewRecords` is honoured here: some custody arrangements deny a parent
 * access, and the school records that on the guardian link.
 */
export async function resolveOwnChildEnrolmentIds(
  db: TenantClient,
  userId: string,
  academicYearId?: string,
): Promise<Set<string>> {
  const guardian = await db.guardian.findFirst({ where: { userId }, select: { id: true } });
  if (!guardian) return new Set();

  const links = await db.studentGuardian.findMany({
    where: { guardianId: guardian.id, canViewRecords: true },
    select: { studentId: true },
  });
  if (links.length === 0) return new Set();

  const enrolments = await db.enrolment.findMany({
    where: {
      studentId: { in: links.map((link) => link.studentId) },
      ...(academicYearId ? { academicYearId } : {}),
    },
    select: { id: true },
  });

  return new Set(enrolments.map((enrolment) => enrolment.id));
}

/** The student's own enrolments, for a student login. */
export async function resolveOwnEnrolmentIds(
  db: TenantClient,
  userId: string,
  academicYearId?: string,
): Promise<Set<string>> {
  const student = await db.student.findFirst({ where: { userId }, select: { id: true } });
  if (!student) return new Set();

  const enrolments = await db.enrolment.findMany({
    where: { studentId: student.id, ...(academicYearId ? { academicYearId } : {}) },
    select: { id: true },
  });
  return new Set(enrolments.map((enrolment) => enrolment.id));
}

/**
 * The `where` fragment that narrows a query to what the actor may see.
 *
 * Returning a filter rather than a boolean is deliberate: a check that runs
 * after the rows are fetched is a check someone will forget to run, and it
 * leaks row counts even when it works. This composes into the query itself.
 */
export async function enrolmentScopeFilter(
  db: TenantClient,
  actor: Actor,
  permission: Permission,
  academicYearId: string,
): Promise<{ id?: { in: string[] }; sectionId?: { in: string[] } }> {
  const scope = assertPermission(actor, permission);

  switch (scope) {
    case 'ALL':
      return {};
    case 'OWN_SECTIONS': {
      const sectionIds = await resolveOwnSectionIds(db, actor.userId, academicYearId);
      return { sectionId: { in: [...sectionIds] } };
    }
    case 'OWN_CHILDREN': {
      const ids = await resolveOwnChildEnrolmentIds(db, actor.userId, academicYearId);
      return { id: { in: [...ids] } };
    }
    case 'SELF': {
      const ids = await resolveOwnEnrolmentIds(db, actor.userId, academicYearId);
      return { id: { in: [...ids] } };
    }
  }
}
