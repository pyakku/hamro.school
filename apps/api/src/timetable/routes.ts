import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idSchema, localDateSchema } from '@hamro/shared';
import { inSchool } from '../lib/request.js';
import { loadTimetable } from './service.js';

const timetableCellSchema = z.object({
  id: idSchema,
  dayOfWeek: z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']),
  periodName: z.string(),
  periodSequence: z.number().int(),
  startTime: z.string(),
  endTime: z.string(),
  subjectName: z.string(),
  sectionName: z.string(),
  teacherName: z.string().nullable(),
  room: z.string().nullable(),
});

const timetableRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/timetable',
    {
      preHandler: fastify.requirePermission('timetable:read'),
      schema: {
        querystring: z.object({
          sectionId: idSchema.optional(),
          /** The timetable *in force on this date*, not "the" timetable. */
          on: localDateSchema.optional(),
        }),
        response: { 200: z.array(timetableCellSchema) },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year, today }) => {
        if (!year) return [];
        return loadTimetable(db, actor, year, request.query.on ?? today, {
          sectionId: request.query.sectionId,
        });
      }),
  );
};

export default timetableRoutes;
