import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { buildApp } from '../app.js';
import { rawPrisma } from '../db/client.js';
import { withTenant } from '../db/tenant.js';

let app: FastifyInstance;
const created: string[] = [];
const suffix = Date.now().toString(36).slice(-5);

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  const owner = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
    }),
  });
  for (const id of created) {
    await owner.refreshToken.deleteMany({ where: { schoolId: id } });
    await owner.roleAssignment.deleteMany({ where: { schoolId: id } });
    await owner.user.deleteMany({ where: { schoolId: id } });
    await owner.academicYear.deleteMany({ where: { schoolId: id } });
    await owner.school.deleteMany({ where: { id } });
  }
  await owner.$disconnect();
  await app.close();
  await rawPrisma.$disconnect();
});

const validSignup = (slug: string) => ({
  schoolName: 'Test Academy',
  slug,
  timezone: 'Asia/Kathmandu',
  currency: 'INR',
  adminFirstName: 'Test',
  adminLastName: 'Admin',
  adminUsername: 'principal',
  adminContactEmail: `principal@${slug}.example`,
  adminPassword: 'a-long-enough-password',
});

async function signup(body: Record<string, unknown>, remoteAddress = '10.9.0.1') {
  return app.inject({ method: 'POST', url: '/signup', payload: body, remoteAddress });
}

describe('POST /signup', () => {
  it('creates a school, an admin and a usable academic year', async () => {
    const slug = `test-${suffix}`;
    const response = await signup(validSignup(slug), '10.9.1.1');

    expect(response.statusCode).toBe(200);
    const body = response.json();
    created.push(body.school.id);

    expect(body.school.slug).toBe(slug);
    expect(body.school.plan).toBe('BETA');
    expect(body.url).toBe(`https://${slug}.hamro.school`);

    // A school with no current year cannot record anything at all, so signup
    // has to leave one behind.
    //
    // Read through withTenant: rawPrisma connects as the RLS-restricted role,
    // and a query with no tenant context correctly sees nothing at all.
    const years = await withTenant({ schoolId: body.school.id }, (db) =>
      db.academicYear.findMany({ where: { isCurrent: true } }),
    );
    expect(years).toHaveLength(1);
  });

  it('lets the new admin sign in immediately', async () => {
    const slug = `test2-${suffix}`;
    const created2 = await signup(validSignup(slug), '10.9.1.2');
    created.push(created2.json().school.id);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: `principal@${slug}`, password: 'a-long-enough-password' },
      remoteAddress: '10.9.1.3',
    });

    expect(login.statusCode).toBe(200);
    expect(login.json().user.roles).toEqual(['SCHOOL_ADMIN']);
  });

  it('refuses a slug that is already taken', async () => {
    const slug = `test3-${suffix}`;
    const first = await signup(validSignup(slug), '10.9.1.4');
    created.push(first.json().school.id);

    const second = await signup(validSignup(slug), '10.9.1.5');
    expect(second.statusCode).toBe(409);
    expect(second.json().error.key).toBe('error.signup.slug_taken');
  });

  it('refuses the names our own infrastructure uses', async () => {
    // admin.hamro.school is ours. So are api, www and the rest.
    for (const reserved of ['admin', 'api', 'www', 'internal']) {
      const response = await signup(validSignup(reserved), '10.9.2.1');
      expect(response.statusCode, reserved).toBe(422);
    }
  });

  it('refuses a slug that could not be a hostname', async () => {
    for (const bad of ['-nope', 'nope-', 'a', 'has space', 'UPPER!']) {
      const response = await signup(validSignup(bad), '10.9.2.2');
      expect([422, 409]).toContain(response.statusCode);
    }
  });

  it('refuses a weak admin password', async () => {
    const response = await signup(
      { ...validSignup(`weak-${suffix}`), adminPassword: 'short' },
      '10.9.2.3',
    );
    expect(response.statusCode).toBe(422);
  });
});

describe('GET /signup/slug-available', () => {
  it('reports a free slug as available', async () => {
    const response = await app.inject({ method: 'GET', url: `/signup/slug-available?slug=free-${suffix}` });
    expect(response.json().available).toBe(true);
  });

  it('reports a reserved slug as unavailable, with a reason', async () => {
    const response = await app.inject({ method: 'GET', url: '/signup/slug-available?slug=admin' });
    expect(response.json().available).toBe(false);
    expect(response.json().reason).toBe('validation.slug_unavailable');
  });

  it('reports the seeded school as taken', async () => {
    const response = await app.inject({ method: 'GET', url: '/signup/slug-available?slug=modelschool' });
    expect(response.json().available).toBe(false);
    expect(response.json().reason).toBe('error.signup.slug_taken');
  });
});

describe('the on-demand TLS gate', () => {
  it('allows a hostname belonging to a real school', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/tls-allowed?domain=modelschool.hamro.school',
    });
    expect(response.statusCode).toBe(200);
  });

  it('refuses a hostname belonging to nobody', async () => {
    // Without this, anyone pointing a name at the box makes us burn one of the
    // 50 certificates Let's Encrypt allows per week.
    for (const domain of ['nosuchschool.hamro.school', 'evil.com', 'a.b.hamro.school']) {
      const response = await app.inject({ method: 'GET', url: `/internal/tls-allowed?domain=${domain}` });
      expect(response.statusCode, domain).toBe(404);
    }
  });

  it('allows the shared sign-in host', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/tls-allowed?domain=app.hamro.school',
    });
    expect(response.statusCode).toBe(200);
  });
});
