import {
  addDays,
  fromLocalDate,
  weekdayOf,
  type HomeworkSummary,
  type LocalDate,
  type NoticeSummary,
  type Role,
} from '@hamro/shared';
import type { TenantClient } from '../db/tenant.js';
import type { Actor } from '../policy/guard.js';
import {
  assertPermission,
  resolveOwnChildEnrolmentIds,
  resolveOwnEnrolmentIds,
  resolveOwnSectionIds,
} from '../policy/guard.js';
import type { CurrentYear } from '../school/service.js';
import { dateWire, fullName, instantWire } from '../lib/wire.js';

/**
 * Homework and notices — the two things a parent opens this product for.
 *
 * Both are scoped the same way: a reader sees what is addressed to the sections
 * they are connected to. For a teacher that is the classes they teach; for a
 * guardian, the classes their children sit in; for the office, all of them.
 */

/** Sections the reader is connected to, or null for "every section". */
async function readerSectionIds(
  db: TenantClient,
  actor: Actor,
  academicYearId: string,
  permission: 'homework:read' | 'notice:read',
): Promise<string[] | null> {
  const scope = assertPermission(actor, permission);
  if (scope === 'ALL') return null;

  if (scope === 'OWN_SECTIONS') {
    return [...(await resolveOwnSectionIds(db, actor.userId, academicYearId))];
  }

  const enrolmentIds = [
    ...(scope === 'OWN_CHILDREN'
      ? await resolveOwnChildEnrolmentIds(db, actor.userId, academicYearId)
      : await resolveOwnEnrolmentIds(db, actor.userId, academicYearId)),
  ];
  if (enrolmentIds.length === 0) return [];

  const enrolments = await db.enrolment.findMany({
    where: { id: { in: enrolmentIds } },
    select: { sectionId: true },
  });
  return [...new Set(enrolments.map((row) => row.sectionId))];
}

/** Monday of the week `date` falls in, so "this week" means the same to everyone. */
export function weekStart(date: LocalDate): LocalDate {
  return addDays(date, -(weekdayOf(date) - 1));
}

/**
 * The default homework window: last week, this week and next.
 *
 * Not "the current week", which is the obvious choice and the wrong one. A
 * parent opening this on Monday morning wants Friday's outstanding work as much
 * as Wednesday's new set, and a teacher wants to see what they have already
 * given before adding to it. A strict week boundary hides both, and it does it
 * most severely first thing on a Monday — exactly when people look.
 */
function defaultWindow(today: LocalDate): { from: LocalDate; to: LocalDate } {
  const monday = weekStart(today);
  return { from: addDays(monday, -7), to: addDays(monday, 13) };
}

/**
 * Homework due in a window, defaulting to the current week.
 *
 * Unpublished posts are drafts and are not homework yet, so nobody but their
 * author should see them — and since the author's own draft list is a writing
 * screen rather than a reading one, this endpoint simply excludes them.
 */
export async function listHomework(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear,
  today: LocalDate,
  options: { sectionId?: string; from?: LocalDate; to?: LocalDate } = {},
): Promise<HomeworkSummary[]> {
  const allowed = await readerSectionIds(db, actor, year.id, 'homework:read');
  if (allowed !== null && allowed.length === 0) return [];

  if (options.sectionId && allowed !== null && !allowed.includes(options.sectionId)) {
    return [];
  }

  const window = defaultWindow(today);
  const from = options.from ?? window.from;
  const to = options.to ?? window.to;

  const posts = await db.homeworkPost.findMany({
    where: {
      academicYearId: year.id,
      publishedAt: { not: null, lte: new Date() },
      dueDate: { gte: fromLocalDate(from), lte: fromLocalDate(to) },
      ...(options.sectionId
        ? { sectionId: options.sectionId }
        : allowed
          ? { sectionId: { in: allowed } }
          : {}),
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    take: 200,
    select: {
      id: true,
      title: true,
      body: true,
      dueDate: true,
      publishedAt: true,
      subject: { select: { name: true } },
      section: { select: { name: true, gradeLevel: { select: { name: true } } } },
      postedBy: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
  });

  return posts.map((post) => ({
    id: post.id,
    title: post.title,
    body: post.body,
    dueDate: dateWire(post.dueDate) ?? today,
    subjectName: post.subject.name,
    sectionName: `${post.section.gradeLevel.name} ${post.section.name}`,
    gradeLevelName: post.section.gradeLevel.name,
    postedByName: fullName(post.postedBy.user),
    publishedAt: instantWire(post.publishedAt),
  }));
}

/**
 * Notices the reader is an audience for.
 *
 * Permission and audience are different questions. Every role in the matrix
 * holds `notice:read`; `audienceRoles` and `scope` are the school's editorial
 * choice about who a particular notice is *for*. A parent in 7B is not an
 * audience for 8A's trip letter.
 */
export async function listNotices(
  db: TenantClient,
  actor: Actor,
  year: CurrentYear | null,
  today: LocalDate,
  limit = 30,
): Promise<NoticeSummary[]> {
  assertPermission(actor, 'notice:read');

  let audience: object = {};

  // Anyone without a school-wide roster sees whole-school notices plus anything
  // aimed at a section they are connected to.
  const connected =
    year && !hasSchoolWideRoster(actor) ? await readerAudience(db, actor, year.id) : null;

  if (connected) {
    audience = {
      OR: [
        { scope: 'SCHOOL' },
        ...(connected.gradeLevelIds.length > 0
          ? [{ scope: 'GRADE_LEVEL', gradeLevelId: { in: connected.gradeLevelIds } }]
          : []),
        ...(connected.sectionIds.length > 0
          ? [{ scope: 'SECTION', sectionId: { in: connected.sectionIds } }]
          : []),
      ],
    };
  }

  const notices = await db.notice.findMany({
    where: {
      publishedAt: { not: null, lte: new Date() },
      OR: [{ expiresAt: null }, { expiresAt: { gte: fromLocalDate(today) } }],
      ...audience,
    },
    orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }],
    take: Math.min(limit * 2, 200),
    select: {
      id: true,
      title: true,
      body: true,
      scope: true,
      isPinned: true,
      publishedAt: true,
      audienceRoles: true,
      gradeLevel: { select: { name: true } },
      section: { select: { name: true, gradeLevel: { select: { name: true } } } },
      author: { select: { firstName: true, lastName: true } },
    },
  });

  return notices
    .filter((notice) => isAudienceRole(notice.audienceRoles, actor.roles))
    .slice(0, limit)
    .map((notice) => ({
      id: notice.id,
      title: notice.title,
      body: notice.body,
      scope: notice.scope,
      audienceName:
        notice.scope === 'SECTION' && notice.section
          ? `${notice.section.gradeLevel.name} ${notice.section.name}`
          : notice.scope === 'GRADE_LEVEL' && notice.gradeLevel
            ? notice.gradeLevel.name
            : null,
      isPinned: notice.isPinned,
      publishedAt: instantWire(notice.publishedAt),
      authorName: fullName(notice.author),
    }));
}

/** An empty `audienceRoles` means everyone — the common case. */
function isAudienceRole(audienceRoles: readonly Role[], roles: readonly Role[]): boolean {
  if (audienceRoles.length === 0) return true;
  return roles.some((role) => audienceRoles.includes(role));
}

/** True for the office and the head: they are an audience for everything. */
function hasSchoolWideRoster(actor: Actor): boolean {
  return actor.roles.some((role) => role === 'SCHOOL_ADMIN' || role === 'ACCOUNTS');
}

async function readerAudience(
  db: TenantClient,
  actor: Actor,
  academicYearId: string,
): Promise<{ sectionIds: string[]; gradeLevelIds: string[] }> {
  const [childEnrolments, ownEnrolments, ownSections] = await Promise.all([
    resolveOwnChildEnrolmentIds(db, actor.userId, academicYearId),
    resolveOwnEnrolmentIds(db, actor.userId, academicYearId),
    resolveOwnSectionIds(db, actor.userId, academicYearId),
  ]);

  const enrolmentIds = [...new Set([...childEnrolments, ...ownEnrolments])];

  const enrolments =
    enrolmentIds.length > 0
      ? await db.enrolment.findMany({
          where: { id: { in: enrolmentIds } },
          select: { sectionId: true, gradeLevelId: true },
        })
      : [];

  const sectionIds = new Set<string>([...ownSections, ...enrolments.map((row) => row.sectionId)]);
  const gradeLevelIds = new Set<string>(enrolments.map((row) => row.gradeLevelId));

  if (ownSections.size > 0) {
    const sections = await db.section.findMany({
      where: { id: { in: [...ownSections] } },
      select: { gradeLevelId: true },
    });
    for (const section of sections) gradeLevelIds.add(section.gradeLevelId);
  }

  return { sectionIds: [...sectionIds], gradeLevelIds: [...gradeLevelIds] };
}
