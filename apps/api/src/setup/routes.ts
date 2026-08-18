import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createGradeLevelSchema,
  createHolidaySchema,
  createSectionSchema,
  createSubjectSchema,
  idSchema,
  setupOverviewSchema,
  updateGradeLevelSchema,
  updateSectionSchema,
  updateSubjectSchema,
} from '@hamro/shared';
import { inSchool } from '../lib/request.js';
import { notFound } from '../lib/errors.js';
import {
  createGradeLevel,
  createHoliday,
  createSection,
  createSubject,
  deleteGradeLevel,
  deleteHoliday,
  deleteSection,
  deleteSubject,
  loadSetup,
  updateGradeLevel,
  updateSection,
  updateSubject,
} from './service.js';

const created = z.object({ id: idSchema });
const ok = z.object({ ok: z.literal(true) });

/**
 * School setup.
 *
 * `structure:write` and `calendar:write` are school-admin only in the matrix,
 * which is the point: the shape of a year is not something a class teacher
 * changes mid-term, and a section quietly renamed under a running register is
 * a support call nobody enjoys.
 */
const setupRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/setup',
    {
      preHandler: fastify.requirePermission('structure:read'),
      schema: { response: { 200: setupOverviewSchema } },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) throw notFound();
        return loadSetup(db, actor, year);
      }),
  );

  // ── Grade levels ──────────────────────────────────────────────────────────

  app.post(
    '/setup/grade-levels',
    {
      preHandler: fastify.requirePermission('structure:write'),
      schema: { body: createGradeLevelSchema, response: { 200: created } },
    },
    async (request) =>
      inSchool(request, ({ db, actor }) => createGradeLevel(db, actor, request.body)),
  );

  app.patch(
    '/setup/grade-levels/:id',
    {
      preHandler: fastify.requirePermission('structure:write'),
      schema: {
        params: z.object({ id: idSchema }),
        body: updateGradeLevelSchema,
        response: { 200: ok },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor }) => {
        await updateGradeLevel(db, actor, request.params.id, request.body);
        return { ok: true as const };
      }),
  );

  app.delete(
    '/setup/grade-levels/:id',
    {
      preHandler: fastify.requirePermission('structure:write'),
      schema: { params: z.object({ id: idSchema }), response: { 200: ok } },
    },
    async (request) =>
      inSchool(request, async ({ db, actor }) => {
        await deleteGradeLevel(db, actor, request.params.id);
        return { ok: true as const };
      }),
  );

  // ── Sections ──────────────────────────────────────────────────────────────

  app.post(
    '/setup/sections',
    {
      preHandler: fastify.requirePermission('structure:write'),
      schema: { body: createSectionSchema, response: { 200: created } },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) throw notFound();
        return createSection(db, actor, year, request.body);
      }),
  );

  app.patch(
    '/setup/sections/:id',
    {
      preHandler: fastify.requirePermission('structure:write'),
      schema: {
        params: z.object({ id: idSchema }),
        body: updateSectionSchema,
        response: { 200: ok },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) throw notFound();
        await updateSection(db, actor, year, request.params.id, request.body);
        return { ok: true as const };
      }),
  );

  app.delete(
    '/setup/sections/:id',
    {
      preHandler: fastify.requirePermission('structure:write'),
      schema: { params: z.object({ id: idSchema }), response: { 200: ok } },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) throw notFound();
        await deleteSection(db, actor, year, request.params.id);
        return { ok: true as const };
      }),
  );

  // ── Subjects ──────────────────────────────────────────────────────────────

  app.post(
    '/setup/subjects',
    {
      preHandler: fastify.requirePermission('structure:write'),
      schema: { body: createSubjectSchema, response: { 200: created } },
    },
    async (request) => inSchool(request, ({ db, actor }) => createSubject(db, actor, request.body)),
  );

  app.patch(
    '/setup/subjects/:id',
    {
      preHandler: fastify.requirePermission('structure:write'),
      schema: {
        params: z.object({ id: idSchema }),
        body: updateSubjectSchema,
        response: { 200: ok },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor }) => {
        await updateSubject(db, actor, request.params.id, request.body);
        return { ok: true as const };
      }),
  );

  app.delete(
    '/setup/subjects/:id',
    {
      preHandler: fastify.requirePermission('structure:write'),
      schema: { params: z.object({ id: idSchema }), response: { 200: ok } },
    },
    async (request) =>
      inSchool(request, async ({ db, actor }) => {
        await deleteSubject(db, actor, request.params.id);
        return { ok: true as const };
      }),
  );

  // ── The calendar ──────────────────────────────────────────────────────────

  app.post(
    '/setup/holidays',
    {
      preHandler: fastify.requirePermission('calendar:write'),
      schema: { body: createHolidaySchema, response: { 200: created } },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) throw notFound();
        return createHoliday(db, actor, year, request.body);
      }),
  );

  app.delete(
    '/setup/holidays/:id',
    {
      preHandler: fastify.requirePermission('calendar:write'),
      schema: { params: z.object({ id: idSchema }), response: { 200: ok } },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) throw notFound();
        await deleteHoliday(db, actor, year, request.params.id);
        return { ok: true as const };
      }),
  );
};

export default setupRoutes;
