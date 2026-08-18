import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ROLE_GRANTS, type Role } from '@hamro/shared';
import { buildApp } from '../app.js';
import { rawPrisma } from '../db/client.js';
import { findSchoolBySlug, withTenant } from '../db/tenant.js';

/**
 * The permission matrix, as the network actually enforces it.
 *
 * `packages/shared/src/permissions` is tested on its own, but that tests the
 * *table*. This tests that every route is wired to it — that the grant a role
 * does not hold produces a 403 at the door rather than a page of somebody
 * else's data. The two failures this is here to catch:
 *
 *   · a new route registered without `requirePermission`, which is invisible in
 *     review because the handler looks exactly like its neighbours;
 *   · a permission quietly added to a role, widening half the product at once.
 *
 * The accounts row is the one to read twice. Schools ask, before they buy,
 * whether the office can see marks. The answer has to stay no.
 */

let app: FastifyInstance;

const SCHOOL = 'modelschool';
const PASSWORD = 'hamro-demo-2026';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rawPrisma.$disconnect();
});

let clientCounter = 0;
const nextAddress = (): string =>
  `10.12.${Math.floor(clientCounter / 250)}.${(clientCounter++ % 250) + 1}`;

async function tokenFor(username: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { identifier: `${username}@${SCHOOL}`, password: PASSWORD },
    remoteAddress: nextAddress(),
  });
  expect(response.statusCode, `login failed for ${username}`).toBe(200);
  return response.json().accessToken as string;
}

async function status(username: string, url: string): Promise<number> {
  const response = await app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${await tokenFor(username)}` },
    remoteAddress: nextAddress(),
  });
  return response.statusCode;
}

async function aTeacher(): Promise<string> {
  const school = await findSchoolBySlug(SCHOOL);
  const user = await withTenant({ schoolId: school!.id }, (db) =>
    db.user.findFirst({
      where: { roleAssignments: { some: { role: 'TEACHER', isActive: true, revokedAt: null } } },
      select: { username: true },
      orderBy: { username: 'asc' },
    }),
  );
  if (!user) throw new Error('The seed has no teacher; run pnpm db:seed.');
  return user.username;
}

/** Every read route added for the shell, with the permission behind it. */
const ROUTES: readonly { url: string; allowed: readonly Role[] }[] = [
  { url: '/overview', allowed: ['SCHOOL_ADMIN', 'ACCOUNTS', 'TEACHER', 'PARENT', 'DRIVER', 'STUDENT'] },
  { url: '/school/context', allowed: ['SCHOOL_ADMIN', 'ACCOUNTS', 'TEACHER', 'PARENT', 'STUDENT'] },
  { url: '/attendance/sections', allowed: ['SCHOOL_ADMIN', 'TEACHER', 'PARENT', 'STUDENT'] },
  { url: '/homework', allowed: ['SCHOOL_ADMIN', 'TEACHER', 'PARENT', 'STUDENT'] },
  { url: '/notices', allowed: ['SCHOOL_ADMIN', 'ACCOUNTS', 'TEACHER', 'PARENT', 'DRIVER', 'STUDENT'] },
  { url: '/students', allowed: ['SCHOOL_ADMIN', 'ACCOUNTS', 'TEACHER', 'PARENT', 'STUDENT'] },
  { url: '/staff', allowed: ['SCHOOL_ADMIN'] },
  { url: '/exams', allowed: ['SCHOOL_ADMIN', 'TEACHER', 'PARENT', 'STUDENT'] },
  { url: '/timetable', allowed: ['SCHOOL_ADMIN', 'TEACHER', 'PARENT', 'STUDENT'] },
  { url: '/fees/summary', allowed: ['SCHOOL_ADMIN', 'ACCOUNTS', 'PARENT'] },
  { url: '/invoices', allowed: ['SCHOOL_ADMIN', 'ACCOUNTS', 'PARENT'] },
  { url: '/payments', allowed: ['SCHOOL_ADMIN', 'ACCOUNTS', 'PARENT'] },
];

describe('every read route is gated by the matrix', () => {
  const users: { username: string; role: Role }[] = [
    { username: 'admin', role: 'SCHOOL_ADMIN' },
    { username: 'accounts', role: 'ACCOUNTS' },
    { username: 'parent001', role: 'PARENT' },
    { username: 'student', role: 'STUDENT' },
    { username: 'driver', role: 'DRIVER' },
  ];

  for (const route of ROUTES) {
    for (const user of users) {
      const shouldAllow = route.allowed.includes(user.role);
      it(`${user.role} ${shouldAllow ? 'may' : 'may not'} GET ${route.url}`, async () => {
        const code = await status(user.username, route.url);
        if (shouldAllow) {
          expect(code, `expected ${user.role} to be allowed`).toBe(200);
        } else {
          expect(code, `expected ${user.role} to be refused`).toBe(403);
        }
      });
    }
  }

  it('lets a teacher read their own classes and nothing financial', async () => {
    const teacher = await aTeacher();
    expect(await status(teacher, '/attendance/sections')).toBe(200);
    expect(await status(teacher, '/exams')).toBe(200);
    expect(await status(teacher, '/invoices')).toBe(403);
    expect(await status(teacher, '/payments')).toBe(403);
    expect(await status(teacher, '/staff')).toBe(403);
  });
});

describe('the accounts boundary', () => {
  /**
   * Enforced by omission from the matrix rather than by a filter, so this is
   * really a test that nothing has quietly been added to ACCOUNTS.
   */
  it('grants the office nothing academic in the matrix itself', async () => {
    const accountsGrants = ROLE_GRANTS.ACCOUNTS.map((grant) => grant.permission);

    for (const forbidden of [
      'mark:read',
      'mark:write',
      'report_card:read',
      'homework:read',
      'attendance:read',
      'exam:read',
    ] as const) {
      expect(accountsGrants, `ACCOUNTS must not hold ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('refuses the office marks, homework, attendance and exams over HTTP', async () => {
    expect(await status('accounts', '/marks?examSubjectId=whatever')).toBe(403);
    expect(await status('accounts', '/homework')).toBe(403);
    expect(await status('accounts', '/attendance/sections')).toBe(403);
    expect(await status('accounts', '/exams')).toBe(403);
  });

  it('still lets the office do its own job', async () => {
    expect(await status('accounts', '/invoices')).toBe(200);
    expect(await status('accounts', '/payments')).toBe(200);
    expect(await status('accounts', '/students')).toBe(200);
  });
});

describe('money on the wire', () => {
  it('is a string of minor units everywhere it appears', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/invoices?limit=5',
      headers: { authorization: `Bearer ${await tokenFor('accounts')}` },
      remoteAddress: nextAddress(),
    });

    const invoices = response.json();
    expect(invoices.length).toBeGreaterThan(0);

    for (const invoice of invoices) {
      for (const field of ['total', 'paid', 'balance'] as const) {
        expect(typeof invoice[field].amountMinor).toBe('string');
        expect(invoice[field].amountMinor).toMatch(/^-?\d+$/);
        expect(invoice[field].currency).toMatch(/^[A-Z]{3}$/);
        expect(typeof invoice[field].minorUnits).toBe('number');
      }
      // The balance is the difference, computed in bigint on the server.
      expect(BigInt(invoice.balance.amountMinor)).toBe(
        BigInt(invoice.total.amountMinor) - BigInt(invoice.paid.amountMinor),
      );
    }
  });

  it('derives overdue from the due date rather than storing it', async () => {
    const token = await tokenFor('accounts');
    const [all, overdue] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/invoices?limit=200',
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: nextAddress(),
      }),
      app.inject({
        method: 'GET',
        url: '/invoices?overdueOnly=true&limit=200',
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: nextAddress(),
      }),
    ]);

    const overdueRows = overdue.json();
    expect(overdueRows.length).toBeGreaterThan(0);

    for (const invoice of overdueRows) {
      expect(invoice.isOverdue).toBe(true);
      expect(invoice.daysOverdue).toBeGreaterThan(0);
      expect(BigInt(invoice.balance.amountMinor) > 0n).toBe(true);
      // OVERDUE is not one of the stored statuses, and must not become one.
      expect(['ISSUED', 'PARTIALLY_PAID']).toContain(invoice.status);
    }

    expect(overdueRows.length).toBeLessThanOrEqual(all.json().length);
  });
});

describe('a student sees their own year, not the exam board', () => {
  async function json(username: string, url: string) {
    const response = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${await tokenFor(username)}` },
      remoteAddress: nextAddress(),
    });
    expect(response.statusCode, `${username} ${url}: ${response.body}`).toBe(200);
    return response.json();
  }

  it('is offered only the papers set for their own grade', async () => {
    const exams = await json('student', '/exams');
    expect(exams.length).toBeGreaterThan(0);

    const mine = await json('student', `/exams/${exams[0].id}/subjects`);
    const all = await json('admin', `/exams/${exams[0].id}/subjects`);

    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);

    // Every paper offered belongs to the one grade they are enrolled in.
    const grades = new Set(mine.map((subject: { gradeLevelName: string }) => subject.gradeLevelName));
    expect(grades.size).toBe(1);
  });

  it('gets their own marking progress, not the exam officer\'s', async () => {
    const [mine] = await json('student', '/exams');
    const [all] = await json('admin', '/exams');

    // "How many of my results are in", not "719 of 738 for the school".
    expect(mine.marksExpected).toBeLessThan(all.marksExpected);
    expect(mine.marksExpected).toBeLessThanOrEqual(mine.subjectCount);
  });

  it('is shown an exam only once its results are published', async () => {
    for (const exam of await json('student', '/exams')) {
      expect(exam.resultsPublishedAt).not.toBeNull();
    }
  });
});

describe('marks', () => {
  it('never sends a grade, a percentage or a rank — only what was stored', async () => {
    const token = await tokenFor('admin');

    const exams = (
      await app.inject({
        method: 'GET',
        url: '/exams',
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: nextAddress(),
      })
    ).json();
    if (exams.length === 0) return;

    const subjects = (
      await app.inject({
        method: 'GET',
        url: `/exams/${exams[0].id}/subjects`,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: nextAddress(),
      })
    ).json();
    if (subjects.length === 0) return;

    const marks = (
      await app.inject({
        method: 'GET',
        url: `/marks?examSubjectId=${subjects[0].id}`,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress: nextAddress(),
      })
    ).json();

    for (const mark of marks) {
      // Rule 3: raw marks only. A convenient `percentage` here is how a school
      // ends up with two different answers for the same child.
      for (const derived of ['grade', 'percentage', 'gpa', 'band', 'rank', 'average']) {
        expect(mark, `a mark must not carry ${derived}`).not.toHaveProperty(derived);
      }
      // A Decimal(7,2) as a string, so 87.35 stays 87.35.
      if (mark.rawMarks !== null) expect(typeof mark.rawMarks).toBe('string');
      expect(typeof mark.maxMarks).toBe('string');
    }
  });
});
