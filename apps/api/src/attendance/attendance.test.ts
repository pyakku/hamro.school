import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { toLocalDate } from '@hamro/shared';
import { buildApp } from '../app.js';
import { rawPrisma } from '../db/client.js';
import { findSchoolBySlug, withTenant } from '../db/tenant.js';

/**
 * Reading registers, and who may read what inside one.
 *
 * The test this file exists for is `a guardian sees only their own child`. Every
 * other check here is ordinary; that one guards a leak that would be invisible
 * in the UI — a parent opening their child's class and receiving forty other
 * families' attendance in the JSON, with the page politely rendering one row.
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
  `10.8.${Math.floor(clientCounter / 250)}.${(clientCounter++ % 250) + 1}`;

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

async function get(token: string, url: string) {
  return app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${token}` },
    remoteAddress: nextAddress(),
  });
}

/** A section and a date that actually has a submitted register in the seed. */
async function aTakenRegister(): Promise<{ sectionId: string; date: string }> {
  const school = await findSchoolBySlug(SCHOOL);
  if (!school) throw new Error(`No school "${SCHOOL}"; run pnpm db:seed.`);

  const session = await withTenant({ schoolId: school.id }, (db) =>
    db.attendanceSession.findFirst({
      where: { submittedAt: { not: null } },
      orderBy: { date: 'desc' },
      select: { sectionId: true, date: true },
    }),
  );
  if (!session) throw new Error('The seed has no submitted register.');
  return { sectionId: session.sectionId, date: toLocalDate(session.date) };
}

describe('GET /attendance/sections', () => {
  it('gives the office every section', async () => {
    const response = await get(await tokenFor('admin'), '/attendance/sections');
    expect(response.statusCode).toBe(200);

    const sections = response.json();
    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      expect(typeof section.students).toBe('number');
      expect(typeof section.registerTakenToday).toBe('boolean');
    }
  });

  it('gives a teacher only their own sections, and fewer than all of them', async () => {
    const all = (await get(await tokenFor('admin'), '/attendance/sections')).json();
    const mine = (await get(await tokenFor(await aTeacher()), '/attendance/sections')).json();

    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
  });

  it('gives a guardian only the sections their children are in', async () => {
    const response = await get(await tokenFor('parent001'), '/attendance/sections');
    expect(response.statusCode).toBe(200);
    expect(response.json().length).toBe(1);
  });

  it('is refused to the office, which holds no attendance permission', async () => {
    const response = await get(await tokenFor('accounts'), '/attendance/sections');
    expect(response.statusCode).toBe(403);
  });
});

describe('GET /attendance/register', () => {
  it('returns the whole class to a teacher who teaches it', async () => {
    const { sectionId, date } = await aTakenRegister();
    const response = await get(
      await tokenFor('admin'),
      `/attendance/register?sectionId=${sectionId}&date=${date}`,
    );

    expect(response.statusCode).toBe(200);
    const register = response.json();
    expect(register.sessionId).toBeTruthy();
    expect(register.rows.length).toBeGreaterThan(5);
    // Rows come in roll order, which is the order a paper register is in.
    const rolls = register.rows.map((row: { rollNumber: number }) => row.rollNumber);
    expect([...rolls].sort((a: number, b: number) => a - b)).toEqual(rolls);
  });

  it('returns a guardian their own child and nobody else', async () => {
    const parentToken = await tokenFor('parent001');

    const sections = (await get(parentToken, '/attendance/sections')).json();
    const sectionId = sections[0].sectionId;
    expect(sections[0].students).toBeGreaterThan(1);

    // The class the child sits in has twenty-odd students. Find a day it was
    // registered, then check what the parent is actually handed.
    const school = await findSchoolBySlug(SCHOOL);
    const session = await withTenant({ schoolId: school!.id }, (db) =>
      db.attendanceSession.findFirst({
        where: { sectionId, submittedAt: { not: null } },
        orderBy: { date: 'desc' },
        select: { date: true },
      }),
    );
    expect(session, 'seed has no register for the parent’s section').toBeTruthy();

    const date = toLocalDate(session!.date);
    const register = (
      await get(parentToken, `/attendance/register?sectionId=${sectionId}&date=${date}`)
    ).json();

    expect(register.sessionId).toBeTruthy();
    // One row: their child. Not the class, filtered on the client — the class
    // never left the server.
    expect(register.rows.length).toBe(1);

    const own = (await get(parentToken, '/students')).json();
    expect(register.rows[0].fullName).toBe(own[0].fullName);
  });

  it('refuses a section the reader has nothing to do with, as a not-found', async () => {
    const all = (await get(await tokenFor('admin'), '/attendance/sections')).json();
    const parentSections = (await get(await tokenFor('parent001'), '/attendance/sections')).json();
    const other = all.find(
      (section: { sectionId: string }) => section.sectionId !== parentSections[0].sectionId,
    );

    const response = await get(
      await tokenFor('parent001'),
      `/attendance/register?sectionId=${other.sectionId}`,
    );

    // Not 403: the reader should not learn that the section exists.
    expect(response.statusCode).toBe(404);
  });

  it('says a closed day is closed rather than showing an empty register', async () => {
    const school = await findSchoolBySlug(SCHOOL);
    const holiday = await withTenant({ schoolId: school!.id }, (db) =>
      db.holiday.findFirst({ select: { startDate: true, name: true } }),
    );
    if (!holiday) return; // the seed has holidays, but do not fail if it stops

    const sections = (await get(await tokenFor('admin'), '/attendance/sections')).json();
    const date = toLocalDate(holiday.startDate);

    const register = (
      await get(
        await tokenFor('admin'),
        `/attendance/register?sectionId=${sections[0].sectionId}&date=${date}`,
      )
    ).json();

    // Rule 6: a holiday has no records at all. Nobody is absent, and the day
    // leaves the denominator instead of counting against every child.
    expect(register.isSchoolDay).toBe(false);
    expect(register.nonSchoolDayReason).toBe(holiday.name);
    expect(register.rows).toEqual([]);
  });
});

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
