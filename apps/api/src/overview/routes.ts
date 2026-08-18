import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { overviewSchema } from '@hamro/shared';
import { withTenant } from '../db/tenant.js';
import { unauthenticated } from '../lib/errors.js';
import { findSchoolById } from '../auth/service.js';
import { buildOverview } from './service.js';

/**
 * What a person sees when they sign in.
 *
 * Gated on `school:read`, the one permission every role in the matrix holds,
 * because the interesting check is not at the door — it is inside, per block.
 * A coarse `requirePermission('attendance:read')` here would lock the office out
 * of their own landing page; instead each block asks the matrix for itself, and
 * a reader receives only the blocks their roles grant.
 */
const overviewRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/overview',
    {
      preHandler: fastify.requirePermission('school:read'),
      schema: { response: { 200: overviewSchema } },
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) throw unauthenticated();

      const school = await findSchoolById(actor.schoolId);
      if (!school) throw unauthenticated();

      return withTenant(request.tenant ?? { schoolId: actor.schoolId }, (db) =>
        buildOverview(db, actor, school),
      );
    },
  );
};

export default overviewRoutes;
