import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  homeworkQuerySchema,
  homeworkSummarySchema,
  noticeQuerySchema,
  noticeSummarySchema,
} from '@hamro/shared';
import { inSchool } from '../lib/request.js';
import { listHomework, listNotices } from './service.js';

const communicationRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/homework',
    {
      preHandler: fastify.requirePermission('homework:read'),
      schema: {
        querystring: homeworkQuerySchema,
        response: { 200: z.array(homeworkSummarySchema) },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year, today }) => {
        if (!year) return [];
        return listHomework(db, actor, year, today, request.query);
      }),
  );

  app.get(
    '/notices',
    {
      preHandler: fastify.requirePermission('notice:read'),
      schema: {
        querystring: noticeQuerySchema,
        response: { 200: z.array(noticeSummarySchema) },
      },
    },
    async (request) =>
      inSchool(request, ({ db, actor, year, today }) =>
        // Notices survive having no academic year: a school still in setup can
        // still tell its staff something.
        listNotices(db, actor, year, today, request.query.limit),
      ),
  );
};

export default communicationRoutes;
