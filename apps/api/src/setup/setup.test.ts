import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { rawPrisma } from '../db/client.js';

/**
 * School setup.
 *
 * The interesting tests are the refusals. Creating a grade level is
 * uninteresting; refusing to delete one with a year of enrolments behind it is
 * the difference between a soft delete and a silently broken report card.
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
const nextAddress = (): string => `10.51.${Math.floor(counter / 250)}.${(counter++ % 250) + 1}`;

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

const call = (token: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { payload: body as never }),
    remoteAddress: nextAddress(),
  });

/** Unique per run, so the suite can be run twice against the same database. */
const unique = () => Math.random().toString(36).slice(2, 8).toUpperCase();

describe('GET /setup', () => {
  it('describes the shape of the year', async () => {
    const setup = (await call(await tokenFor('admin'), 'GET', '/setup')).json();

    expect(setup.gradeLevels.length).toBeGreaterThan(0);
    expect(setup.sections.length).toBeGreaterThan(0);
    expect(setup.subjects.length).toBeGreaterThan(0);
    expect(setup.teachers.length).toBeGreaterThan(0);

    // Grades come in promotion order, which is what makes "what comes next"
    // answerable at the end of a year.
    const levels = setup.gradeLevels.map((g: { level: number }) => g.level);
    expect([...levels].sort((a: number, b: number) => a - b)).toEqual(levels);
  });

  it('counts a single-day holiday as one day, not zero', async () => {
    const setup = (await call(await tokenFor('admin'), 'GET', '/setup')).json();
    for (const holiday of setup.holidays) {
      expect(holiday.days).toBeGreaterThan(0);
      if (holiday.startDate === holiday.endDate) expect(holiday.days).toBe(1);
    }
  });

  it('is refused to a teacher for writing, and to a parent entirely', async () => {
    const school = await tokenFor('admin');
    expect((await call(school, 'GET', '/setup')).statusCode).toBe(200);
    expect((await call(await tokenFor('parent001'), 'GET', '/setup')).statusCode).toBe(403);

    // A teacher may read the structure — they need the section list — but the
    // shape of the year is not theirs to change mid-term.
    const teacherToken = await tokenFor('radhika.karthik');
    expect((await call(teacherToken, 'GET', '/setup')).statusCode).toBe(200);
    expect(
      (await call(teacherToken, 'POST', '/setup/subjects', { code: 'X' + unique(), name: 'X' }))
        .statusCode,
    ).toBe(403);
  });
});

describe('grade levels', () => {
  it('creates one and refuses a duplicate level', async () => {
    const token = await tokenFor('admin');
    const level = 15 + Math.floor(Math.random() * 5);

    const first = await call(token, 'POST', '/setup/grade-levels', {
      name: `Grade ${unique()}`,
      level,
    });
    expect(first.statusCode, first.body).toBe(200);

    // Two grades on the same level makes promotion ambiguous.
    const second = await call(token, 'POST', '/setup/grade-levels', {
      name: `Grade ${unique()}`,
      level,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('NAME_TAKEN');

    await call(token, 'DELETE', `/setup/grade-levels/${first.json().id}`);
  });

  it('refuses to delete one that has students behind it', async () => {
    const token = await tokenFor('admin');
    const setup = (await call(token, 'GET', '/setup')).json();
    const inUse = setup.gradeLevels.find((g: { students: number }) => g.students > 0);

    const response = await call(token, 'DELETE', `/setup/grade-levels/${inUse.id}`);

    // Soft delete hides the row but the foreign keys survive: last year's
    // report card would point at a blank.
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('STILL_IN_USE');
  });

  it('deletes an empty one', async () => {
    const token = await tokenFor('admin');
    const created = await call(token, 'POST', '/setup/grade-levels', {
      name: `Temp ${unique()}`,
      level: 19,
    });
    const response = await call(token, 'DELETE', `/setup/grade-levels/${created.json().id}`);
    expect(response.statusCode, response.body).toBe(200);

    const setup = (await call(token, 'GET', '/setup')).json();
    expect(setup.gradeLevels.some((g: { id: string }) => g.id === created.json().id)).toBe(false);
  });
});

describe('sections', () => {
  it('creates one in the current year and assigns a class teacher', async () => {
    const token = await tokenFor('admin');
    const setup = (await call(token, 'GET', '/setup')).json();
    const name = unique();

    const created = await call(token, 'POST', '/setup/sections', {
      gradeLevelId: setup.gradeLevels[0].id,
      name,
      classTeacherId: setup.teachers[0].id,
      room: 'Room 9',
    });
    expect(created.statusCode, created.body).toBe(200);

    const after = (await call(token, 'GET', '/setup')).json();
    const section = after.sections.find((s: { id: string }) => s.id === created.json().id);
    expect(section.classTeacherName).toBe(setup.teachers[0].fullName);
    expect(section.students).toBe(0);

    await call(token, 'DELETE', `/setup/sections/${created.json().id}`);
  });

  it('refuses a duplicate name within the same grade and year', async () => {
    const token = await tokenFor('admin');
    const setup = (await call(token, 'GET', '/setup')).json();
    const existing = setup.sections[0];

    const response = await call(token, 'POST', '/setup/sections', {
      gradeLevelId: existing.gradeLevelId,
      name: existing.name,
    });
    expect(response.statusCode).toBe(409);
  });

  it('refuses to delete a section with a roster', async () => {
    const token = await tokenFor('admin');
    const setup = (await call(token, 'GET', '/setup')).json();
    const populated = setup.sections.find((s: { students: number }) => s.students > 0);

    const response = await call(token, 'DELETE', `/setup/sections/${populated.id}`);
    expect(response.statusCode).toBe(409);
  });
});

describe('subjects', () => {
  it('creates, renames and refuses a duplicate code', async () => {
    const token = await tokenFor('admin');
    const code = `Z${unique()}`;

    const created = await call(token, 'POST', '/setup/subjects', { code, name: `Subject ${code}` });
    expect(created.statusCode, created.body).toBe(200);

    const renamed = await call(token, 'PATCH', `/setup/subjects/${created.json().id}`, {
      name: `Renamed ${code}`,
    });
    expect(renamed.statusCode).toBe(200);

    const clash = await call(token, 'POST', '/setup/subjects', { code, name: 'Different' });
    expect(clash.statusCode).toBe(409);

    await call(token, 'DELETE', `/setup/subjects/${created.json().id}`);
  });

  it('refuses to delete a subject with marks behind it', async () => {
    const token = await tokenFor('admin');
    const setup = (await call(token, 'GET', '/setup')).json();
    const taught = setup.subjects.find((s: { offeredTo: string[] }) => s.offeredTo.length > 0);

    const response = await call(token, 'DELETE', `/setup/subjects/${taught.id}`);
    // Marks hang off ExamSubject, which hangs off this.
    expect(response.statusCode).toBe(409);
  });
});

describe('the calendar', () => {
  it('adds a holiday, and attendance stops being expected on it', async () => {
    const token = await tokenFor('admin');

    // A Saturday well clear of the seeded term, so nothing else is disturbed.
    const created = await call(token, 'POST', '/setup/holidays', {
      name: `Founders Day ${unique()}`,
      startDate: '2027-03-15',
      endDate: '2027-03-17',
    });
    expect(created.statusCode, created.body).toBe(200);

    const setup = (await call(token, 'GET', '/setup')).json();
    const holiday = setup.holidays.find((h: { id: string }) => h.id === created.json().id);
    expect(holiday.days).toBe(3);

    const sections = (await call(token, 'GET', '/attendance/sections')).json();
    const register = (
      await call(
        token,
        'GET',
        `/attendance/register?sectionId=${sections[0].sectionId}&date=2027-03-16`,
      )
    ).json();

    // The point of the calendar: the day leaves the denominator.
    expect(register.isSchoolDay).toBe(false);
    expect(register.rows).toEqual([]);

    await call(token, 'DELETE', `/setup/holidays/${created.json().id}`);
  });

  it('refuses an end date before the start', async () => {
    const response = await call(await tokenFor('admin'), 'POST', '/setup/holidays', {
      name: 'Backwards',
      startDate: '2027-03-20',
      endDate: '2027-03-18',
    });
    // 422, not 400: the error handler maps a schema refusal to VALIDATION_FAILED
    // like every other invalid body in this API.
    expect(response.statusCode).toBe(422);
  });
});
