import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  examQuerySchema,
  examRowSchema,
  examSubjectRowSchema,
  idSchema,
  markQuerySchema,
  markRowSchema,
} from '@hamro/shared';
import { inSchool } from '../lib/request.js';
import { notFound } from '../lib/errors.js';
import { listExamSubjects, listExams, listMarks } from './service.js';

/**
 * Exams and marks.
 *
 * Note what is *not* here: no endpoint returns a grade, a percentage or a rank.
 * Those come from the grading scale engine at report card time, and shipping a
 * convenient `percentage` field from here is exactly how a school ends up with
 * two different answers for the same child (rule 3).
 */
const assessmentRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/exams',
    {
      preHandler: fastify.requirePermission('exam:read'),
      schema: {
        querystring: examQuerySchema,
        response: { 200: z.array(examRowSchema) },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) return [];
        return listExams(db, actor, year, request.query);
      }),
  );

  app.get(
    '/exams/:examId/subjects',
    {
      preHandler: fastify.requirePermission('exam:read'),
      schema: {
        params: z.object({ examId: idSchema }),
        response: { 200: z.array(examSubjectRowSchema) },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) throw notFound();
        return listExamSubjects(db, actor, year, request.params.examId);
      }),
  );

  app.get(
    '/marks',
    {
      preHandler: fastify.requirePermission('mark:read'),
      schema: {
        querystring: markQuerySchema,
        response: { 200: z.array(markRowSchema) },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) return [];
        return listMarks(db, actor, year, request.query.examSubjectId, request.query.sectionId);
      }),
  );
};

export default assessmentRoutes;
