import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, toLocalDate, todayInTimezone } from '@hamro/shared';
import { buildApp } from '../app.js';
import { rawPrisma } from '../db/client.js';
import { findSchoolBySlug, withTenant } from '../db/tenant.js';

/**
 * Taking the register.
 *
 * The rules under test are the ones a school will later argue about, and every
 * one of them is a place where the convenient implementation is the wrong one:
 * storing only the absentees, accepting half a class, writing on a holiday, or
 * letting a locked day be edited without saying why.
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
  `10.21.${Math.floor(clientCounter / 250)}.${(clientCounter++ % 250) + 1}`;

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

async function save(token: string, body: unknown) {
  return app.inject({
    method: 'PUT',
    url: '/attendance/register',
    headers: { authorization: `Bearer ${token}` },
    payload: body as never,
    remoteAddress: nextAddress(),
  });
}

/**
 * The nth school day after today — one per test.
 *
 * The seed fills attendance up to today, so everything after it is untouched,
 * and the seed's holidays are in May, June and July. Each test takes its own
 * day: they share a database, and a test that saves a register would otherwise
 * decide the outcome of one that expects a blank one.
 */
function aFreeDay(index = 0): string {
  let day = todayInTimezone('Asia/Kolkata');
  let found = 0;
  for (;;) {
    day = addDays(day, 1);
    if ([0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())) continue;
    if (found === index) return day;
    found += 1;
  }
}

async function aSection(): Promise<{ sectionId: string; enrolmentIds: string[] }> {
  const school = await findSchoolBySlug(SCHOOL);
  const section = await withTenant({ schoolId: school!.id }, async (db) => {
    const year = await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    const found = await db.section.findFirst({
      where: { academicYearId: year!.id },
      select: { id: true },
    });
    const enrolments = await db.enrolment.findMany({
      where: { sectionId: found!.id, status: 'ACTIVE' },
      select: { id: true },
    });
    return { sectionId: found!.id, enrolmentIds: enrolments.map((e) => e.id) };
  });
  return section;
}

describe('PUT /attendance/register', () => {
  it('writes a record for every child, not only the absentees', async () => {
    const token = await tokenFor('admin');
    const { sectionId, enrolmentIds } = await aSection();
    const date = aFreeDay(0);

    const entries = enrolmentIds.map((enrolmentId, index) => ({
      enrolmentId,
      status: index === 0 ? ('ABSENT_UNEXPLAINED' as const) : ('PRESENT' as const),
    }));

    const response = await save(token, { sectionId, date, entries });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().saved).toBe(enrolmentIds.length);
    expect(response.json().absentees).toBe(1);

    // The exception-first *interface* does not imply exception-only storage:
    // a row exists for every child, so "no record" keeps meaning "no register".
    const register = (await get(token, `/attendance/register?sectionId=${sectionId}&date=${date}`)).json();
    expect(register.rows.length).toBe(enrolmentIds.length);
    expect(register.rows.filter((r: { status: string }) => r.status === 'PRESENT').length).toBe(
      enrolmentIds.length - 1,
    );
  });

  it('is idempotent, and a re-save replaces rather than accumulates', async () => {
    const token = await tokenFor('admin');
    const { sectionId, enrolmentIds } = await aSection();
    const date = aFreeDay(1);

    const allPresent = enrolmentIds.map((enrolmentId) => ({
      enrolmentId,
      status: 'PRESENT' as const,
    }));
    await save(token, { sectionId, date, entries: allPresent });

    // The teacher notices one child is late and saves again.
    const corrected = allPresent.map((entry, index) =>
      index === 0 ? { ...entry, status: 'LATE' as const, minutesLate: 12 } : entry,
    );
    const second = await save(token, { sectionId, date, entries: corrected });
    expect(second.statusCode).toBe(200);

    const register = (await get(token, `/attendance/register?sectionId=${sectionId}&date=${date}`)).json();
    expect(register.rows.length).toBe(enrolmentIds.length);
    const late = register.rows.filter((r: { status: string }) => r.status === 'LATE');
    expect(late.length).toBe(1);
    expect(late[0].minutesLate).toBe(12);
  });

  it('drops minutes late when the status is not LATE', async () => {
    const token = await tokenFor('admin');
    const { sectionId, enrolmentIds } = await aSection();
    const date = aFreeDay(2);

    await save(token, {
      sectionId,
      date,
      entries: enrolmentIds.map((enrolmentId) => ({
        enrolmentId,
        status: 'PRESENT' as const,
        minutesLate: 20,
      })),
    });

    const register = (await get(token, `/attendance/register?sectionId=${sectionId}&date=${date}`)).json();
    // A number nobody can interpret later is worse than no number.
    for (const row of register.rows) expect(row.minutesLate).toBeNull();
  });

  it('refuses half a class', async () => {
    const token = await tokenFor('admin');
    const { sectionId, enrolmentIds } = await aSection();

    const response = await save(token, {
      sectionId,
      date: aFreeDay(3),
      entries: enrolmentIds.slice(0, 2).map((enrolmentId) => ({
        enrolmentId,
        status: 'PRESENT' as const,
      })),
    });

    // The children left out would look like a day nobody took, in a class
    // where somebody did.
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INCOMPLETE_REGISTER');
  });

  it('refuses a register on a holiday', async () => {
    const token = await tokenFor('admin');
    const { sectionId, enrolmentIds } = await aSection();

    const school = await findSchoolBySlug(SCHOOL);
    const holiday = await withTenant({ schoolId: school!.id }, (db) =>
      db.holiday.findFirst({ select: { startDate: true } }),
    );
    if (!holiday) return;

    const response = await save(token, {
      sectionId,
      date: toLocalDate(holiday.startDate),
      entries: enrolmentIds.map((enrolmentId) => ({
        enrolmentId,
        status: 'PRESENT' as const,
      })),
    });

    // Rule 6: a closed day has no records at all, so it leaves the denominator
    // instead of being a class full of absentees.
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CLOSED_DAY');
  });

  it('rejects a child who is not in this class', async () => {
    const token = await tokenFor('admin');
    const { sectionId, enrolmentIds } = await aSection();

    const school = await findSchoolBySlug(SCHOOL);
    const outsider = await withTenant({ schoolId: school!.id }, (db) =>
      db.enrolment.findFirst({
        where: { sectionId: { not: sectionId }, status: 'ACTIVE' },
        select: { id: true },
      }),
    );

    const response = await save(token, {
      sectionId,
      date: aFreeDay(4),
      entries: [
        ...enrolmentIds.map((enrolmentId) => ({ enrolmentId, status: 'PRESENT' as const })),
        { enrolmentId: outsider!.id, status: 'ABSENT_UNEXPLAINED' as const },
      ],
    });

    expect(response.statusCode).toBe(404);
  });

  it('writes an audit entry that names who took it', async () => {
    const token = await tokenFor('admin');
    const { sectionId, enrolmentIds } = await aSection();
    const date = aFreeDay(5);

    await save(token, {
      sectionId,
      date,
      entries: enrolmentIds.map((enrolmentId) => ({ enrolmentId, status: 'PRESENT' as const })),
    });

    const school = await findSchoolBySlug(SCHOOL);
    const entry = await withTenant({ schoolId: school!.id }, (db) =>
      db.auditLog.findFirst({
        where: { entityType: 'AttendanceSession' },
        orderBy: { at: 'desc' },
        select: { action: true, actorUserId: true, actorRole: true },
      }),
    );

    expect(entry).toBeTruthy();
    expect(entry!.actorUserId).toBeTruthy();
  });

  it('refuses a teacher a class they do not teach', async () => {
    const school = await findSchoolBySlug(SCHOOL);
    const teacher = await withTenant({ schoolId: school!.id }, (db) =>
      db.user.findFirst({
        where: { roleAssignments: { some: { role: 'TEACHER', isActive: true } } },
        select: { username: true },
        orderBy: { username: 'asc' },
      }),
    );
    const token = await tokenFor(teacher!.username);

    const mine = (await get(token, '/attendance/sections')).json();
    const all = (await get(await tokenFor('admin'), '/attendance/sections')).json();
    const notMine = all.find(
      (s: { sectionId: string }) => !mine.some((m: { sectionId: string }) => m.sectionId === s.sectionId),
    );

    const response = await save(token, {
      sectionId: notMine.sectionId,
      date: aFreeDay(6),
      entries: [{ enrolmentId: 'whatever', status: 'PRESENT' as const }],
    });

    expect(response.statusCode).toBe(404);
  });

  it('offers a writer the roster, defaulted present, for a day not yet taken', async () => {
    const token = await tokenFor('admin');
    const { sectionId, enrolmentIds } = await aSection();
    const date = aFreeDay(7);

    const register = (
      await get(token, `/attendance/register?sectionId=${sectionId}&date=${date}`)
    ).json();

    // A blank register is not an empty screen: it is the class, waiting. The
    // null sessionId is what still distinguishes it from a register that was
    // taken and happened to be all present.
    expect(register.sessionId).toBeNull();
    expect(register.rows.length).toBe(enrolmentIds.length);
    for (const row of register.rows) expect(row.status).toBe('PRESENT');
  });

  it('offers no roster on a closed day, however writeable', async () => {
    const token = await tokenFor('admin');
    const { sectionId } = await aSection();

    const school = await findSchoolBySlug(SCHOOL);
    const holiday = await withTenant({ schoolId: school!.id }, (db) =>
      db.holiday.findFirst({ select: { startDate: true } }),
    );
    if (!holiday) return;

    const register = (
      await get(
        token,
        `/attendance/register?sectionId=${sectionId}&date=${toLocalDate(holiday.startDate)}`,
      )
    ).json();

    // Handing a teacher a blank register on a holiday invites the one action
    // rule 6 exists to prevent.
    expect(register.isSchoolDay).toBe(false);
    expect(register.rows).toEqual([]);
  });

  it('gives a guardian no roster to fill in', async () => {
    const parentToken = await tokenFor('parent001');
    const sections = (await get(parentToken, '/attendance/sections')).json();

    const register = (
      await get(
        parentToken,
        `/attendance/register?sectionId=${sections[0].sectionId}&date=${aFreeDay(8)}`,
      )
    ).json();

    // "What was recorded?" — nothing was. A parent must never be shown a class
    // defaulted to present as though it were fact.
    expect(register.rows).toEqual([]);
  });

  it('is refused to the office entirely', async () => {
    const response = await save(await tokenFor('accounts'), {
      sectionId: 'x',
      date: aFreeDay(9),
      entries: [{ enrolmentId: 'y', status: 'PRESENT' as const }],
    });
    expect(response.statusCode).toBe(403);
  });

  it('is refused to a parent', async () => {
    const response = await save(await tokenFor('parent001'), {
      sectionId: 'x',
      date: aFreeDay(10),
      entries: [{ enrolmentId: 'y', status: 'PRESENT' as const }],
    });
    expect(response.statusCode).toBe(403);
  });
});
