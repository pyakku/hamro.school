import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  platformLoginRequestSchema,
  platformLoginResponseSchema,
  platformSchoolsResponseSchema,
  platformSettingsSchema,
  platformUsersResponseSchema,
  updatePlatformSettingsSchema,
  updateSchoolRequestSchema,
} from '@hamro/shared';
import { unauthenticated } from '../lib/errors.js';
import {
  getSettings,
  listSchools,
  listUsers,
  platformLogin,
  updateSchool,
  updateSettings,
  verifyPlatformToken,
  type PlatformAdminSession,
} from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    platformAdmin?: PlatformAdminSession;
  }
}

const platformRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.decorateRequest('platformAdmin', undefined);

  /** Its own guard, not the school one. The two must never be interchangeable. */
  async function requirePlatformAdmin(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthenticated();
    request.platformAdmin = await verifyPlatformToken(header.slice(7).trim());
  }

  app.post(
    '/platform/auth/login',
    {
      // Tighter than a school login: this account sees every school.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { body: platformLoginRequestSchema, response: { 200: platformLoginResponseSchema } },
    },
    async (request) => platformLogin(request.body),
  );

  app.get(
    '/platform/me',
    { preHandler: requirePlatformAdmin, schema: { response: { 200: z.object({ admin: z.object({ id: z.string(), email: z.string(), name: z.string() }) }) } } },
    async (request) => ({ admin: request.platformAdmin! }),
  );

  app.get(
    '/platform/schools',
    { preHandler: requirePlatformAdmin, schema: { response: { 200: platformSchoolsResponseSchema } } },
    async () => ({ schools: await listSchools() }),
  );

  app.patch(
    '/platform/schools/:id',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        params: z.object({ id: z.string() }),
        body: updateSchoolRequestSchema,
        response: { 200: platformSchoolsResponseSchema },
      },
    },
    async (request) => {
      await updateSchool(request.params.id, request.body);
      return { schools: await listSchools() };
    },
  );

  app.get(
    '/platform/users',
    {
      preHandler: requirePlatformAdmin,
      schema: {
        querystring: z.object({
          schoolId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).default(200),
        }),
        response: { 200: platformUsersResponseSchema },
      },
    },
    async (request) => listUsers(request.query),
  );

  app.get(
    '/platform/settings',
    { preHandler: requirePlatformAdmin, schema: { response: { 200: platformSettingsSchema } } },
    async () => getSettings(),
  );

  app.patch(
    '/platform/settings',
    {
      preHandler: requirePlatformAdmin,
      schema: { body: updatePlatformSettingsSchema, response: { 200: platformSettingsSchema } },
    },
    async (request) => {
      await updateSettings(request.body);
      return getSettings();
    },
  );
};

export default platformRoutes;
