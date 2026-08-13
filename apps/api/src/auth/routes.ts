import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  refreshRequestSchema,
  refreshResponseSchema,
} from '@hamro/shared';
import { z } from 'zod';
import { env } from '../config/env.js';
import { withTenant } from '../db/tenant.js';
import { unauthenticated } from '../lib/errors.js';
import { REFRESH_TTL_SECONDS } from './tokens.js';
import { findSchoolById, loadSessionUser, login, refreshSession, revokeRefreshToken } from './service.js';

const REFRESH_COOKIE = 'hamro_refresh';

/**
 * Where the refresh token lives depends on who is asking.
 *
 * The browser gets an httpOnly cookie: a token in localStorage is one XSS away
 * from being someone else's, and nothing on the page needs to read it.
 *
 * The Flutter app asks with `?client=mobile` and gets the token in the body,
 * because it has secure platform storage and no cookie jar worth relying on.
 */
const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/auth',
  maxAge: REFRESH_TTL_SECONDS,
};

const clientQuerySchema = z.object({
  client: z.enum(['web', 'mobile']).default('web'),
});

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/auth/login',
    {
      // Brute force protection is per IP and deliberately tight. A school has
      // a few hundred people, not a few hundred logins a minute.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: loginRequestSchema,
        querystring: clientQuerySchema,
        response: { 200: loginResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await login(request.body, {
        requestId: request.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      const wantsCookie = request.query.client === 'web';
      if (wantsCookie) {
        reply.setCookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
      }

      return {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        ...(wantsCookie ? {} : { refreshToken: result.refreshToken }),
        user: result.user,
      };
    },
  );

  app.post(
    '/auth/refresh',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: refreshRequestSchema.optional(),
        querystring: clientQuerySchema,
        response: { 200: refreshResponseSchema },
      },
    },
    async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE] ?? request.body?.refreshToken;
      if (!token) throw unauthenticated('error.auth.session_expired');

      const result = await refreshSession(token, {
        requestId: request.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      const wantsCookie = request.query.client === 'web';
      if (wantsCookie) {
        reply.setCookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
      }

      return {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        ...(wantsCookie ? {} : { refreshToken: result.refreshToken }),
      };
    },
  );

  app.post(
    '/auth/logout',
    { schema: { body: refreshRequestSchema.optional(), response: { 204: z.null() } } },
    async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE] ?? request.body?.refreshToken;
      if (token) await revokeRefreshToken(token);
      reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
      return reply.status(204).send(null);
    },
  );

  /**
   * The session, rebuilt from the database rather than read off the token.
   * Roles change; a token minted before a teacher was made an admin should not
   * keep saying "teacher" until it expires, and one minted before a revocation
   * must not keep the access it named.
   */
  app.get(
    '/auth/me',
    {
      preHandler: fastify.requireAuth,
      schema: { response: { 200: meResponseSchema } },
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) throw unauthenticated();

      const school = await findSchoolById(actor.schoolId);
      if (!school) throw unauthenticated();

      const user = await withTenant(request.tenant ?? { schoolId: actor.schoolId }, (db) =>
        loadSessionUser(db, actor.userId, school),
      );
      if (!user) throw unauthenticated();

      return { user };
    },
  );
};

export default authRoutes;
