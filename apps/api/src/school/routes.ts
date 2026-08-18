import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { schoolContextSchema } from '@hamro/shared';
import { withTenant } from '../db/tenant.js';
import { unauthenticated } from '../lib/errors.js';
import { findSchoolById } from '../auth/service.js';
import { loadSchoolContext } from './service.js';

/**
 * The context the shell reads on every page.
 *
 * Cheap and cached hard on the client: an academic year does not change while
 * somebody is looking at a register. `academic_year:read` gates it, which every
 * role in the matrix holds — a driver needs to know the school is shut today as
 * much as the head does.
 */
const schoolRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/school/context',
    {
      preHandler: fastify.requirePermission('academic_year:read'),
      schema: { response: { 200: schoolContextSchema } },
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) throw unauthenticated();

      // The school row carries the timezone, and the timezone decides what day
      // it is — so this is read before the tenant scope opens, not inside it.
      const school = await findSchoolById(actor.schoolId);
      if (!school) throw unauthenticated();

      return withTenant(request.tenant ?? { schoolId: actor.schoolId }, (db) =>
        loadSchoolContext(db, school),
      );
    },
  );
};

export default schoolRoutes;
