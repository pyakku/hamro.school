import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, toLocalDate, todayInTimezone } from '@hamro/shared';
import { buildApp } from '../app.js';
import { rawPrisma } from '../db/client.js';
import { findSchoolBySlug, withTenant } from '../db/tenant.js';

/**
 * The staff return.
 *
 * The question everyone asks first is whether a teacher can mark themselves in,
 * so that is the test that matters most here. After that: the same rule 6
 * guarantees as a class register, and the rule that the office's own approved
 * leave beats whatever the form happened to send.
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

let counter = 0;
const nextAddress = (): string => `10.41.${Math.floor(counter / 250)}.${(counter++ % 250) + 1}`;

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

const get = (token: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` }, remoteAddress: nextAddress() });

const put = (token: string, body: unknown) =>
  app.inject({
    method: 'PUT',
    url: '/staff-attendance',
    headers: { authorization: `Bearer ${token}` },
    payload: body as never,
    remoteAddress: nextAddress(),
  });

/** The nth school day after today: the seed leaves those untaken. */
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

async function aTeacher(): Promise<string> {
  const school = await findSchoolBySlug(SCHOOL);
  const user = await withTenant({ schoolId: school!.id }, (db) =>
    db.user.findFirst({
      where: { roleAssignments: { some: { role: 'TEACHER', isActive: true } } },
      select: { username: true },
      orderBy: { username: 'asc' },
    }),
  );
  return user!.username;
}

describe('GET /staff-attendance', () => {
  it('gives the office the whole staff room', async () => {
    const response = await get(await tokenFor('admin'), '/staff-attendance');
    expect(response.statusCode, response.body).toBe(200);

    const day = response.json();
    expect(day.rows.length).toBeGreaterThan(5);
    for (const row of day.rows) {
      expect(row.employeeCode).toBeTruthy();
      expect(row.status).toBeTruthy();
    }
  });

  it('gives a teacher their own row and nobody else\'s', async () => {
    const teacher = await aTeacher();
    const day = (await get(await tokenFor(teacher), '/staff-attendance')).json();

    // SELF scope. A colleague's attendance is an HR matter and not theirs.
    expect(day.rows.length).toBe(1);
  });

  it('is refused to a parent entirely', async () => {
    expect((await get(await tokenFor('parent001'), '/staff-attendance')).statusCode).toBe(403);
  });

  it('is refused to the office\'s accounts login', async () => {
    // ACCOUNTS runs the ledger, not the staff room. Payroll would be a
    // deliberate grant, not an accident of sharing a permission.
    expect((await get(await tokenFor('accounts'), '/staff-attendance')).statusCode).toBe(403);
  });

  it('has no rows at all on a closed day', async () => {
    const school = await findSchoolBySlug(SCHOOL);
    const holiday = await withTenant({ schoolId: school!.id }, (db) =>
      db.holiday.findFirst({ select: { startDate: true } }),
    );
    if (!holiday) return;

    const day = (
      await get(await tokenFor('admin'), `/staff-attendance?date=${toLocalDate(holiday.startDate)}`)
    ).json();

    expect(day.isSchoolDay).toBe(false);
    expect(day.rows).toEqual([]);
  });
});

describe('PUT /staff-attendance', () => {
  it('records a return and reads it back', async () => {
    const token = await tokenFor('admin');
    const date = aFreeDay(0);

    // Deliberately not asserting the day starts blank: these tests share a
    // database and are run more than once, so a precondition like that passes
    // the first time and fails ever after. The outcome is what matters.
    const before = (await get(token, `/staff-attendance?date=${date}`)).json();

    const entries = before.rows.map((row: { staffId: string }, index: number) => ({
      staffId: row.staffId,
      status: index === 0 ? 'ABSENT_UNEXPLAINED' : 'PRESENT',
    }));

    const saved = await put(token, { date, entries });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().saved).toBe(entries.length);

    const after = (await get(token, `/staff-attendance?date=${date}`)).json();
    expect(after.dayId).toBeTruthy();
    expect(after.submittedAt).toBeTruthy();
    expect(after.rows.filter((r: { status: string }) => r.status === 'ABSENT_UNEXPLAINED').length).toBe(1);
  });

  it('refuses a teacher marking their own attendance', async () => {
    const teacher = await aTeacher();
    const token = await tokenFor(teacher);
    const day = (await get(token, '/staff-attendance')).json();

    const response = await put(token, {
      date: aFreeDay(1),
      entries: [{ staffId: day.rows[0].staffId, status: 'PRESENT' }],
    });

    // The first thing anybody asks about a feature like this.
    expect(response.statusCode).toBe(403);
  });

  it('refuses a return on a closed day', async () => {
    const token = await tokenFor('admin');
    const school = await findSchoolBySlug(SCHOOL);
    const holiday = await withTenant({ schoolId: school!.id }, (db) =>
      db.holiday.findFirst({ select: { startDate: true } }),
    );
    if (!holiday) return;

    const staff = (await get(token, '/staff-attendance')).json();
    const response = await put(token, {
      date: toLocalDate(holiday.startDate),
      entries: [{ staffId: staff.rows[0].staffId, status: 'PRESENT' }],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CLOSED_DAY');
  });

  it('lets approved leave beat whatever the form sent', async () => {
    const token = await tokenFor('admin');
    const date = aFreeDay(2);
    const school = await findSchoolBySlug(SCHOOL);

    const day = (await get(token, `/staff-attendance?date=${date}`)).json();
    const target = day.rows[0].staffId;

    // The office approves leave for that person on that day.
    await withTenant({ schoolId: school!.id }, (db) =>
      db.staffLeaveRequest.create({
        data: {
          schoolId: school!.id,
          staffId: target,
          startDate: new Date(`${date}T00:00:00.000Z`),
          endDate: new Date(`${date}T00:00:00.000Z`),
          leaveType: 'Casual leave',
          status: 'APPROVED',
        },
      }),
    );

    // A clerk then files the return marking them present anyway.
    await put(token, {
      date,
      entries: day.rows.map((row: { staffId: string }) => ({
        staffId: row.staffId,
        status: 'PRESENT',
      })),
    });

    const after = (await get(token, `/staff-attendance?date=${date}`)).json();
    const row = after.rows.find((r: { staffId: string }) => r.staffId === target);

    // The school's own decision wins, so the leave register and the attendance
    // register cannot drift apart.
    expect(row.status).toBe('ABSENT_APPROVED');
    expect(row.onApprovedLeave).toBe(true);
  });

  it('writes an audit entry', async () => {
    const token = await tokenFor('admin');
    const date = aFreeDay(3);
    const day = (await get(token, `/staff-attendance?date=${date}`)).json();

    await put(token, {
      date,
      entries: day.rows.map((row: { staffId: string }) => ({
        staffId: row.staffId,
        status: 'PRESENT',
      })),
    });

    const school = await findSchoolBySlug(SCHOOL);
    const entry = await withTenant({ schoolId: school!.id }, (db) =>
      db.auditLog.findFirst({
        where: { entityType: 'StaffAttendanceDay' },
        orderBy: { at: 'desc' },
        select: { actorUserId: true, action: true },
      }),
    );

    expect(entry).toBeTruthy();
    expect(entry!.actorUserId).toBeTruthy();
  });
});
