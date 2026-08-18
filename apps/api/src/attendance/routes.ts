import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { registerQuerySchema, registerSchema, sectionAttendanceSchema } from '@hamro/shared';
import { inSchool } from '../lib/request.js';
import { notFound } from '../lib/errors.js';
import { listSections, loadRegister } from './service.js';

/**
 * Reading registers.
 *
 * `requirePermission('attendance:read')` at the door answers "may a role of
 * this kind read attendance at all" — which is what keeps the office out
 * entirely, since ACCOUNTS holds no such grant anywhere in the matrix. Whose
 * registers, and whose rows inside them, is settled in the service against the
 * database, because "their own classes" is a fact about teaching assignments
 * rather than about a token.
 */
const attendanceRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/attendance/sections',
    {
      preHandler: fastify.requirePermission('attendance:read'),
      schema: { response: { 200: z.array(sectionAttendanceSchema) } },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year, today }) => {
        if (!year) return [];
        return listSections(db, actor, year, today);
      }),
  );

  app.get(
    '/attendance/register',
    {
      preHandler: fastify.requirePermission('attendance:read'),
      schema: {
        querystring: registerQuerySchema,
        response: { 200: registerSchema },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year, today }) => {
        if (!year) throw notFound();
        // The date defaults to today *at the school*, never the browser's day.
        return loadRegister(db, actor, year, request.query.sectionId, request.query.date ?? today);
      }),
  );
};

export default attendanceRoutes;
