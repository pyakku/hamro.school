import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { rawPrisma } from '../db/client.js';
import { findSchoolBySlug, withTenant } from '../db/tenant.js';

/**
 * What the search box means in a school office.
 *
 * The regression these guard against is subtle enough to survive review: an
 * admission number carries the year, so substring-matching it makes a search
 * for "2" return every child admitted in 2026 — the list does not visibly
 * change, and the user reports that search is broken rather than that it
 * matched too much.
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
const nextAddress = (): string => `10.31.${Math.floor(counter / 250)}.${(counter++ % 250) + 1}`;

async function search(query: string, username = 'admin') {
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { identifier: `${username}@${SCHOOL}`, password: PASSWORD },
    remoteAddress: nextAddress(),
  });
  const response = await app.inject({
    method: 'GET',
    url: `/students?limit=200${query ? `&search=${encodeURIComponent(query)}` : ''}`,
    headers: { authorization: `Bearer ${login.json().accessToken}` },
    remoteAddress: nextAddress(),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as Array<{ rollNumber: number; fullName: string; admissionNumber: string }>;
}

describe('student search', () => {
  it('reads a short number as a roll number, not as part of an admission number', async () => {
    const all = await search('');
    const twos = await search('2');

    // The bug: GH-2026-0001 contains "2", so every child used to match and the
    // screen looked unchanged.
    expect(twos.length).toBeGreaterThan(0);
    expect(twos.length).toBeLessThan(all.length / 2);
    for (const student of twos) expect(student.rollNumber).toBe(2);
  });

  it('treats every single digit the same way', async () => {
    // "1" appeared to work only because it happened to match fewer admission
    // numbers than "2" did.
    for (const digit of ['1', '2', '3', '7']) {
      const rows = await search(digit);
      for (const student of rows) expect(student.rollNumber).toBe(Number(digit));
    }
  });

  it('matches a two-digit roll number exactly', async () => {
    const rows = await search('22');
    for (const student of rows) expect(student.rollNumber).toBe(22);
  });

  it('still finds a full admission number', async () => {
    const all = await search('');
    const target = all[0]!;
    const rows = await search(target.admissionNumber);
    expect(rows.some((student) => student.admissionNumber === target.admissionNumber)).toBe(true);
  });

  it('finds people by name', async () => {
    const all = await search('');
    const firstName = all[0]!.fullName.split(' ')[0]!;
    const rows = await search(firstName);
    expect(rows.length).toBeGreaterThan(0);
    for (const student of rows) expect(student.fullName.toLowerCase()).toContain(firstName.toLowerCase());
  });

  it('finds a child by their guardian\'s phone number', async () => {
    // A parent rings the office and the only thing on screen is the number.
    const withGuardian = (await search('')).length;
    expect(withGuardian).toBeGreaterThan(0);

    // Through withTenant: the app role is subject to RLS, so an unscoped read
    // returns nothing at all rather than erroring.
    const school = await findSchoolBySlug(SCHOOL);
    const guardian = await withTenant({ schoolId: school!.id }, (db) =>
      db.guardian.findFirst({ where: { phone: { not: null } }, select: { phone: true } }),
    );

    const rows = await search(guardian!.phone!.slice(-6));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('cannot be used by a parent to find another family', async () => {
    /**
     * A guardian does hold `guardian:read`, at SELF scope, so they see their
     * own contact details — that is their own phone number and not a leak. What
     * matters is that the *enrolment* scope still dominates: searching a
     * fragment that matches somebody else's number must return nothing, so the
     * box cannot be used to probe the school's contact list.
     */
    const school = await findSchoolBySlug(SCHOOL);
    const mine = await search('', 'parent001');
    expect(mine.length).toBeGreaterThan(0);

    const otherGuardian = await withTenant({ schoolId: school!.id }, (db) =>
      db.guardian.findFirst({
        where: {
          phone: { not: null },
          students: { none: { student: { enrolments: { some: { id: mine[0]!.enrolmentId } } } } },
        },
        select: { phone: true },
      }),
    );

    const rows = await search(otherGuardian!.phone!.slice(-7), 'parent001');
    expect(rows).toEqual([]);
  });
});
