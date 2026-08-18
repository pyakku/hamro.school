import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  idSchema,
  staffRowSchema,
  studentDetailSchema,
  studentQuerySchema,
  studentRowSchema,
} from '@hamro/shared';
import { inSchool } from '../lib/request.js';
import { notFound } from '../lib/errors.js';
import { listStaff, listStudents, loadStudent } from './service.js';

const peopleRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/students',
    {
      preHandler: fastify.requirePermission('student:read'),
      schema: {
        querystring: studentQuerySchema,
        response: { 200: z.array(studentRowSchema) },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) return [];
        return listStudents(db, actor, year, request.query);
      }),
  );

  app.get(
    '/students/:studentId',
    {
      preHandler: fastify.requirePermission('student:read'),
      schema: {
        params: z.object({ studentId: idSchema }),
        response: { 200: studentDetailSchema },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) throw notFound();
        return loadStudent(db, actor, year, request.params.studentId);
      }),
  );

  app.get(
    '/staff',
    {
      preHandler: fastify.requirePermission('staff:read'),
      schema: { response: { 200: z.array(staffRowSchema) } },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) return [];
        return listStaff(db, actor, year);
      }),
  );
};

export default peopleRoutes;
