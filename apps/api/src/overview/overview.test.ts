import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { rawPrisma } from '../db/client.js';
import { findSchoolBySlug, withTenant } from '../db/tenant.js';

/**
 * The overview, per role, against the seeded school.
 *
 * The tests worth having here are the *absences*. It is easy to check that an
 * administrator sees the fee total; the check that matters is that an accounts
 * login receives no attendance block at all — not an empty one, not a zeroed
 * one. That is the privacy boundary schools ask about before they buy, and the
 * only way it stays true as this endpoint grows is a test that fails the moment
 * a block stops asking the permission matrix for permission.
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
  `10.7.${Math.floor(clientCounter / 250)}.${(clientCounter++ % 250) + 1}`;

async function tokenFor(username: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { identifier: `${username}@${SCHOOL}`, password: PASSWORD },
    remoteAddress: nextAddress(),
  });
  expect(response.statusCode, `login failed for ${username}: ${response.body}`).toBe(200);
  return response.json().accessToken as string;
}

async function overviewFor(username: string) {
  const token = await tokenFor(username);
  const response = await app.inject({
    method: 'GET',
    url: '/overview',
    headers: { authorization: `Bearer ${token}` },
    remoteAddress: nextAddress(),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

/**
 * A teacher from the seed, whichever one it created first.
 *
 * Through `withTenant`, not `rawPrisma`. The app role is subject to every RLS
 * policy, so an unscoped read of `users` returns zero rows rather than an
 * error — the database fails closed, and a test that forgets the scope looks
 * like a seed problem instead of a missing `SET LOCAL`.
 */
async function seededTeacher(): Promise<string> {
  const school = await findSchoolBySlug(SCHOOL);
  if (!school) throw new Error(`No school "${SCHOOL}"; run pnpm db:seed.`);

  const user = await withTenant({ schoolId: school.id }, (db) =>
    db.user.findFirst({
      where: { roleAssignments: { some: { role: 'TEACHER', isActive: true, revokedAt: null } } },
      select: { username: true },
      orderBy: { username: 'asc' },
    }),
  );
  if (!user) throw new Error('The seed has no teacher; run pnpm db:seed.');
  return user.username;
}

describe('GET /overview — the school admin', () => {
  it('sees the school, the registers, the ledger and the notices', async () => {
    const body = await overviewFor('admin');

    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.school.students).toBeGreaterThan(0);
    expect(body.school.sections).toBeGreaterThan(0);
    expect(body.registers).toBeDefined();
    expect(body.registers.tally.total).toBeGreaterThanOrEqual(0);
    expect(body.fees.invoiced.amountMinor).toMatch(/^-?\d+$/);
    expect(Array.isArray(body.notices)).toBe(true);
  });

  it('gets no teacher or guardian blocks, holding neither scope', async () => {
    const body = await overviewFor('admin');
    expect(body.mySections).toBeUndefined();
    expect(body.myChildren).toBeUndefined();
  });

  it('sends every amount as a string, never a number', async () => {
    const body = await overviewFor('admin');
    // A bigint cannot be JSON.stringify'd, and the reflex fix — Number(...) —
    // is the bug rule 4 exists to prevent. If this ever arrives as a number,
    // somebody has "fixed" a serialisation error the wrong way.
    for (const key of ['invoiced', 'collected', 'outstanding', 'overdue']) {
      expect(typeof body.fees[key].amountMinor).toBe('string');
    }
  });
});

describe('GET /overview — accounts', () => {
  it('sees the ledger', async () => {
    const body = await overviewFor('accounts');
    expect(body.fees).toBeDefined();
    expect(body.fees.outstanding.amountMinor).toMatch(/^-?\d+$/);
  });

  it('receives no attendance block at all — omitted, not emptied', async () => {
    const body = await overviewFor('accounts');
    // ACCOUNTS holds no `attendance:read` anywhere in the matrix. The block is
    // absent because it was never queried, which is what makes this a boundary
    // rather than a filter someone can forget.
    expect(body.registers).toBeUndefined();
    expect(body.mySections).toBeUndefined();
    expect(body.myAttendance).toBeUndefined();
    expect('registers' in body).toBe(false);
  });
});

describe('GET /overview — a teacher', () => {
  it('sees their own classes and no school-wide totals', async () => {
    const body = await overviewFor(await seededTeacher());

    expect(Array.isArray(body.mySections)).toBe(true);
    expect(body.mySections.length).toBeGreaterThan(0);
    for (const section of body.mySections) {
      expect(typeof section.registerTaken).toBe('boolean');
      expect(section.students).toBeGreaterThan(0);
    }

    // A teacher's `student:read` is OWN_SECTIONS, so a school-wide count is
    // not theirs to see, and neither is the ledger.
    expect(body.school).toBeUndefined();
    expect(body.registers).toBeUndefined();
    expect(body.fees).toBeUndefined();
  });

  it('gets today\'s periods for themselves', async () => {
    const body = await overviewFor(await seededTeacher());
    expect(Array.isArray(body.periodsToday)).toBe(true);
    for (const period of body.periodsToday) {
      expect(period.startTime).toMatch(/^\d{2}:\d{2}$/);
      expect(period.endTime).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});

describe('GET /overview — a parent', () => {
  it('sees their own children, with attendance and what is owed', async () => {
    const body = await overviewFor('parent001');

    expect(Array.isArray(body.myChildren)).toBe(true);
    expect(body.myChildren.length).toBeGreaterThan(0);

    for (const child of body.myChildren) {
      expect(child.fullName).toBeTruthy();
      expect(child.sectionName).toBeTruthy();
      expect(typeof child.term.schoolDays).toBe('number');
      // Approved leave stays separable from unexplained absence, always.
      expect(child.term).toHaveProperty('absentApproved');
      expect(child.term).toHaveProperty('absentUnexplained');
      expect(typeof child.outstanding.amountMinor).toBe('string');
    }
  });

  it('sees nothing school-wide', async () => {
    const body = await overviewFor('parent001');
    expect(body.school).toBeUndefined();
    expect(body.registers).toBeUndefined();
    expect(body.fees).toBeUndefined();
    expect(body.mySections).toBeUndefined();
  });
});

describe('GET /overview — a driver', () => {
  it('sees notices and nothing else about anybody', async () => {
    const body = await overviewFor('driver');

    // DRIVER is deliberately almost empty until bus tracking exists. A driver
    // has no business reading a student record, and the way to keep it that way
    // is to grant nothing.
    expect(body.school).toBeUndefined();
    expect(body.registers).toBeUndefined();
    expect(body.fees).toBeUndefined();
    expect(body.mySections).toBeUndefined();
    expect(body.myChildren).toBeUndefined();
    expect(body.myAttendance).toBeUndefined();
    expect(body.periodsToday).toBeUndefined();
    expect(Array.isArray(body.notices)).toBe(true);
  });
});

describe('GET /overview — unauthenticated', () => {
  it('is refused without a token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/overview',
      remoteAddress: nextAddress(),
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /school/context', () => {
  it('returns the current year, its terms, and the day at the school', async () => {
    const token = await tokenFor('admin');
    const response = await app.inject({
      method: 'GET',
      url: '/school/context',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: nextAddress(),
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();

    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.academicYear.isCurrent).toBe(true);
    expect(body.terms.length).toBeGreaterThan(0);
    expect(body.terms[0].startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof body.isSchoolDay).toBe('boolean');
  });

  it('agrees with the term the date actually falls in', async () => {
    const token = await tokenFor('admin');
    const response = await app.inject({
      method: 'GET',
      url: '/school/context',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: nextAddress(),
    });
    const body = response.json();

    if (body.currentTerm) {
      expect(body.today >= body.currentTerm.startDate).toBe(true);
      expect(body.today <= body.currentTerm.endDate).toBe(true);
    } else {
      // Between terms is a real state, and the shell says so rather than
      // guessing at the nearest one.
      const inSome = body.terms.some(
        (term: { startDate: string; endDate: string }) =>
          body.today >= term.startDate && body.today <= term.endDate,
      );
      expect(inSome).toBe(false);
    }
  });

  it('is refused to a driver only if the matrix says so — it does not', async () => {
    // `academic_year:read` is not granted to DRIVER in the matrix, so this is a
    // 403. Asserting it here means a later widening of the matrix is a
    // deliberate change with a failing test attached.
    const token = await tokenFor('driver');
    const response = await app.inject({
      method: 'GET',
      url: '/school/context',
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: nextAddress(),
    });
    expect(response.statusCode).toBe(403);
  });
});
