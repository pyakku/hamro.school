import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { rawPrisma } from '../db/client.js';

/**
 * Auth, end to end, against the seeded demo school.
 *
 * The interesting cases are the ones where a system quietly does the wrong
 * thing: telling an attacker which emails exist, keeping a session alive after
 * the roles behind it changed, or accepting a refresh token twice.
 */

let app: FastifyInstance;

const SCHOOL = 'greenhill';
const PASSWORD = 'hamro-demo-2026';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rawPrisma.$disconnect();
});

/**
 * Each call comes from a different address.
 *
 * The login route is rate limited to 10 attempts a minute per IP, and that
 * limit stays switched on during tests — a limiter that is disabled in test is
 * a limiter nobody notices breaking. Tests that care about it ask from one
 * address on purpose; the rest spread out.
 */
let clientCounter = 0;
const nextAddress = (): string => `10.1.${Math.floor(clientCounter / 250)}.${(clientCounter++ % 250) + 1}`;

async function login(body: Record<string, unknown>, query = '', remoteAddress = nextAddress()) {
  return app.inject({
    method: 'POST',
    url: `/auth/login${query}`,
    payload: body,
    remoteAddress,
  });
}

describe('POST /auth/login', () => {
  it('signs a school admin in', async () => {
    const response = await login({
      schoolSlug: SCHOOL,
      email: 'admin@greenhill.example',
      password: PASSWORD,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.user.roles).toEqual(['SCHOOL_ADMIN']);
    expect(body.user.school.slug).toBe(SCHOOL);
    expect(body.user.school.currency).toBe('INR');
  });

  it('sends the browser its refresh token as an httpOnly cookie, not in the body', async () => {
    const response = await login({
      schoolSlug: SCHOOL,
      email: 'admin@greenhill.example',
      password: PASSWORD,
    });

    expect(response.json().refreshToken).toBeUndefined();
    const cookie = response.cookies.find((c) => c.name === 'hamro_refresh');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.value).toBeTruthy();
  });

  it('scopes the refresh cookie to the path the browser will use', async () => {
    // Behind the production proxy the browser calls /api/auth/refresh while
    // this process only ever sees /auth/refresh. Scope the cookie to the
    // latter and the browser never sends it — sessions die on reload, with no
    // error anywhere.
    const response = await login({
      schoolSlug: SCHOOL,
      email: 'admin@greenhill.example',
      password: PASSWORD,
    });

    const cookie = response.cookies.find((c) => c.name === 'hamro_refresh');
    expect(cookie?.path).toBe(process.env.REFRESH_COOKIE_PATH ?? '/auth');
  });

  it('gives the mobile client the token in the body instead', async () => {
    const response = await login(
      { schoolSlug: SCHOOL, email: 'admin@greenhill.example', password: PASSWORD },
      '?client=mobile',
    );

    expect(response.json().refreshToken).toBeTypeOf('string');
    expect(response.cookies.find((c) => c.name === 'hamro_refresh')).toBeUndefined();
  });

  it('never says which part was wrong', async () => {
    const wrongPassword = await login({
      schoolSlug: SCHOOL,
      email: 'admin@greenhill.example',
      password: 'not the password',
    });
    const unknownUser = await login({
      schoolSlug: SCHOOL,
      email: 'nobody@greenhill.example',
      password: PASSWORD,
    });
    const unknownSchool = await login({
      schoolSlug: 'not-a-school',
      email: 'admin@greenhill.example',
      password: PASSWORD,
    });

    for (const response of [wrongPassword, unknownUser, unknownSchool]) {
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
    }
  });

  it('returns an i18n key rather than an English sentence', async () => {
    const response = await login({
      schoolSlug: SCHOOL,
      email: 'admin@greenhill.example',
      password: 'wrong',
    });
    expect(response.json().error.key).toBe('error.auth.invalid_credentials');
  });

  it('rejects a malformed request with per-field keys', async () => {
    const response = await login({ schoolSlug: SCHOOL, email: 'not-an-email', password: 'x' });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.fields?.email).toBe('validation.email');
  });

  it('will not let one school log in through another school', async () => {
    // The teacher exists, the password is right, the school is not theirs.
    const other = await rawPrisma.school.create({
      data: { slug: `rival-${Date.now().toString(36)}`, name: 'Rival School', timezone: 'UTC' },
    });

    const response = await login({
      schoolSlug: other.slug,
      email: 'admin@greenhill.example',
      password: PASSWORD,
    });

    expect(response.statusCode).toBe(401);
    await rawPrisma.school.delete({ where: { id: other.id } });
  });
});

describe('brute force protection', () => {
  it('locks a single address out after ten attempts', async () => {
    const attacker = '198.51.100.7';
    const attempts = await Promise.all(
      Array.from({ length: 14 }, () =>
        login(
          { schoolSlug: SCHOOL, email: 'admin@greenhill.example', password: 'guess' },
          '',
          attacker,
        ),
      ),
    );

    const codes = attempts.map((response) => response.statusCode);
    expect(codes).toContain(429);
    expect(attempts.find((r) => r.statusCode === 429)?.json().error.key).toBe('error.rate_limited');
  });

  it('does not lock out everybody else', async () => {
    const innocent = await login({
      schoolSlug: SCHOOL,
      email: 'admin@greenhill.example',
      password: PASSWORD,
    });
    expect(innocent.statusCode).toBe(200);
  });
});

describe('the permission matrix reaches the client', () => {
  it('gives accounts the ledger and no marks', async () => {
    const response = await login({
      schoolSlug: SCHOOL,
      email: 'accounts@greenhill.example',
      password: PASSWORD,
    });

    const permissions: Array<{ permission: string; scope: string }> = response.json().user.permissions;
    const names = permissions.map((grant) => grant.permission);

    expect(names).toContain('payment:record');
    expect(names).toContain('invoice:read');
    expect(names).not.toContain('mark:read');
    expect(names).not.toContain('report_card:read');
  });

  it('scopes a teacher to their own sections', async () => {
    const response = await login({
      schoolSlug: SCHOOL,
      email: 'radhika.karthik@greenhill.example',
      password: PASSWORD,
    });

    const permissions: Array<{ permission: string; scope: string }> = response.json().user.permissions;
    const attendance = permissions.find((grant) => grant.permission === 'attendance:write');
    expect(attendance?.scope).toBe('OWN_SECTIONS');
  });
});

describe('GET /auth/me', () => {
  it('refuses without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.key).toBe('error.unauthenticated');
  });

  it('refuses a token that is not one of ours', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.nope' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rebuilds the session from the database', async () => {
    const signIn = await login({
      schoolSlug: SCHOOL,
      email: 'admin@greenhill.example',
      password: PASSWORD,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${signIn.json().accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe('admin@greenhill.example');
  });
});

describe('refresh token rotation', () => {
  it('exchanges a token for a new one', async () => {
    const signIn = await login(
      { schoolSlug: SCHOOL, email: 'admin@greenhill.example', password: PASSWORD },
      '?client=mobile',
    );
    const first = signIn.json().refreshToken;

    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/refresh?client=mobile',
      payload: { refreshToken: first },
    });

    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().refreshToken).not.toBe(first);
    expect(refreshed.json().accessToken).toBeTypeOf('string');
  });

  it('treats a replayed token as a theft and kills the whole chain', async () => {
    const signIn = await login(
      { schoolSlug: SCHOOL, email: 'accounts@greenhill.example', password: PASSWORD },
      '?client=mobile',
    );
    const stolen = signIn.json().refreshToken;

    const legitimate = await app.inject({
      method: 'POST',
      url: '/auth/refresh?client=mobile',
      payload: { refreshToken: stolen },
    });
    const replacement = legitimate.json().refreshToken;

    // The attacker replays the token they copied.
    const replay = await app.inject({
      method: 'POST',
      url: '/auth/refresh?client=mobile',
      payload: { refreshToken: stolen },
    });
    expect(replay.statusCode).toBe(401);

    // And the legitimate client's newer token is dead too, because we cannot
    // tell which of the two was the thief. Both sign in again.
    const afterBreach = await app.inject({
      method: 'POST',
      url: '/auth/refresh?client=mobile',
      payload: { refreshToken: replacement },
    });
    expect(afterBreach.statusCode).toBe(401);
  });

  it('refreshes a browser session from the cookie alone, with no body', async () => {
    // The shape the web app actually sends: no payload, no content-type, the
    // token is in an httpOnly cookie the page cannot read.
    const signIn = await login({
      schoolSlug: SCHOOL,
      email: 'admin@greenhill.example',
      password: PASSWORD,
    });
    const cookie = signIn.cookies.find((c) => c.name === 'hamro_refresh');

    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { hamro_refresh: String(cookie?.value) },
    });

    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().accessToken).toBeTypeOf('string');
    expect(refreshed.json().refreshToken).toBeUndefined();
  });

  it('signs out from the cookie alone', async () => {
    const signIn = await login({
      schoolSlug: SCHOOL,
      email: 'admin@greenhill.example',
      password: PASSWORD,
    });
    const cookie = signIn.cookies.find((c) => c.name === 'hamro_refresh');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { hamro_refresh: String(cookie?.value) },
    });
    expect(response.statusCode).toBe(204);

    // And the token is dead.
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { hamro_refresh: String(cookie?.value) },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it('rejects a token belonging to no school', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh?client=mobile',
      payload: { refreshToken: 'cmnotarealschool.abcdefghijklmnop' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.key).toBe('error.auth.session_expired');
  });

  it('signs out without complaining about an unknown token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: 'garbage' },
    });
    expect(response.statusCode).toBe(204);
  });
});

describe('GET /health', () => {
  it('reports the database, not just the process', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', database: 'ok' });
  });
});
