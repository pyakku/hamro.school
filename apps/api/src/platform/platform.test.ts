import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { rawPrisma } from '../db/client.js';
import { hashPassword } from '../auth/password.js';

/**
 * The platform console.
 *
 * The property that matters most here is negative: a school session, however
 * privileged inside its own school, must not reach any of this.
 */

let app: FastifyInstance;
let token = '';
const EMAIL = `platform-test-${Date.now().toString(36)}@example.com`;
const PASSWORD = 'platform-test-password';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await rawPrisma.platformAdmin.create({
    data: { email: EMAIL, passwordHash: await hashPassword(PASSWORD), name: 'Test Platform Admin' },
  });
});

afterAll(async () => {
  await rawPrisma.platformAdmin.deleteMany({ where: { email: EMAIL } });
  await app.close();
  await rawPrisma.$disconnect();
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe('platform authentication', () => {
  it('signs a platform admin in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/platform/auth/login',
      payload: { email: EMAIL, password: PASSWORD },
      remoteAddress: '10.20.0.1',
    });

    expect(response.statusCode).toBe(200);
    token = response.json().accessToken;
    expect(response.json().admin.name).toBe('Test Platform Admin');
  });

  it('refuses a wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/platform/auth/login',
      payload: { email: EMAIL, password: 'wrong' },
      remoteAddress: '10.20.0.2',
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses every platform route without a token', async () => {
    for (const url of ['/platform/me', '/platform/schools', '/platform/users', '/platform/settings']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  /**
   * The one that matters. A school admin is the most privileged role inside a
   * school; it must still be nothing at all out here.
   */
  it('refuses a school session, however privileged', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: 'admin@modelschool', password: 'hamro-demo-2026' },
      remoteAddress: '10.20.0.3',
    });
    expect(login.statusCode).toBe(200);

    const schoolToken = login.json().accessToken;
    for (const url of ['/platform/schools', '/platform/users', '/platform/settings']) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${schoolToken}` },
      });
      expect(response.statusCode, url).toBe(401);
    }
  });
});

describe('the console', () => {
  it('lists schools with their counts', async () => {
    const response = await app.inject({ method: 'GET', url: '/platform/schools', headers: auth() });
    expect(response.statusCode).toBe(200);

    const school = response.json().schools.find((s: { slug: string }) => s.slug === 'modelschool');
    expect(school.plan).toBe('BETA');
    expect(school.counts.students).toBeGreaterThan(100);
    expect(school.url).toBe('https://modelschool.hamro.school');
  });

  it('lists users, and filters them by school', async () => {
    const all = await app.inject({ method: 'GET', url: '/platform/users', headers: auth() });
    expect(all.json().total).toBeGreaterThan(0);

    const schools = await app.inject({ method: 'GET', url: '/platform/schools', headers: auth() });
    const id = schools.json().schools[0].id;

    const filtered = await app.inject({
      method: 'GET',
      url: `/platform/users?schoolId=${id}`,
      headers: auth(),
    });
    expect(filtered.json().users.every((u: { schoolId: string }) => u.schoolId === id)).toBe(true);
  });

  it('changes a school plan', async () => {
    const schools = await app.inject({ method: 'GET', url: '/platform/schools', headers: auth() });
    const school = schools.json().schools.find((s: { slug: string }) => s.slug === 'modelschool');

    const updated = await app.inject({
      method: 'PATCH',
      url: `/platform/schools/${school.id}`,
      headers: auth(),
      payload: { plan: 'PRO' },
    });
    expect(updated.json().schools.find((s: { id: string }) => s.id === school.id).plan).toBe('PRO');

    await app.inject({
      method: 'PATCH',
      url: `/platform/schools/${school.id}`,
      headers: auth(),
      payload: { plan: 'BETA' },
    });
  });

  it('opens and closes beta signups', async () => {
    const closed = await app.inject({
      method: 'PATCH',
      url: '/platform/settings',
      headers: auth(),
      payload: { signupEnabled: false },
    });
    expect(closed.json().signupEnabled).toBe(false);

    // And signup actually refuses while it is closed.
    const attempt = await app.inject({
      method: 'POST',
      url: '/signup',
      remoteAddress: '10.20.9.9',
      payload: {
        schoolName: 'Should Not Exist',
        slug: `closed-${Date.now().toString(36)}`,
        timezone: 'UTC',
        currency: 'USD',
        adminFirstName: 'A',
        adminLastName: 'B',
        adminUsername: 'admin',
        adminPassword: 'a-long-enough-password',
      },
    });
    expect(attempt.statusCode).toBe(403);
    expect(attempt.json().error.key).toBe('error.signup.closed');

    const reopened = await app.inject({
      method: 'PATCH',
      url: '/platform/settings',
      headers: auth(),
      payload: { signupEnabled: true },
    });
    expect(reopened.json().signupEnabled).toBe(true);
  });
});
