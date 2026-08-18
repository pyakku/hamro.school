import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  saveStaffAttendanceRequestSchema,
  saveStaffAttendanceResponseSchema,
  staffAttendanceDaySchema,
  staffAttendanceQuerySchema,
} from '@hamro/shared';
import { inSchool } from '../lib/request.js';
import { notFound, unauthenticated } from '../lib/errors.js';
import { loadStaffAttendance, saveStaffAttendance } from './service.js';

/**
 * The staff return.
 *
 * Read is granted to the office at ALL scope and to a teacher at SELF. Write is
 * the office only — nobody marks their own attendance, which is the first thing
 * anybody asks about a feature like this.
 */
const staffAttendanceRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/staff-attendance',
    {
      preHandler: fastify.requirePermission('staff_attendance:read'),
      schema: {
        querystring: staffAttendanceQuerySchema,
        response: { 200: staffAttendanceDaySchema },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year, today }) => {
        if (!year) throw notFound();
        return loadStaffAttendance(db, actor, year, request.query.date ?? today);
      }),
  );

  app.put(
    '/staff-attendance',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: fastify.requirePermission('staff_attendance:write'),
      schema: {
        body: saveStaffAttendanceRequestSchema,
        response: { 200: saveStaffAttendanceResponseSchema },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) throw notFound();
        const ctx = request.tenant;
        if (!ctx) throw unauthenticated();
        return saveStaffAttendance(db, ctx, actor, year, request.body);
      }),
  );
};

export default staffAttendanceRoutes;
