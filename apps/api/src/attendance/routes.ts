import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  registerQuerySchema,
  registerSchema,
  saveRegisterRequestSchema,
  saveRegisterResponseSchema,
  sectionAttendanceSchema,
} from '@hamro/shared';
import { inSchool } from '../lib/request.js';
import { notFound, unauthenticated } from '../lib/errors.js';
import { listSections, loadRegister, saveRegister } from './service.js';

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

  /**
   * Taking the register.
   *
   * A PUT because it is idempotent by nature: a teacher who taps save twice, or
   * corrects a mark and saves again, is stating what the register *is* rather
   * than adding to it. The server replaces the whole set of records for the
   * session, so the stored register always matches the screen the teacher was
   * looking at.
   *
   * Rate limited per user rather than left on the global bucket: a class of 45
   * saved from a phone on a school's shared connection should never look like
   * abuse, but a runaway client should not be able to rewrite a term either.
   */
  app.put(
    '/attendance/register',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      preHandler: fastify.requirePermission('attendance:write'),
      schema: {
        body: saveRegisterRequestSchema,
        response: { 200: saveRegisterResponseSchema },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, year }) => {
        if (!year) throw notFound();
        const ctx = request.tenant;
        if (!ctx) throw unauthenticated();
        return saveRegister(db, ctx, actor, year, request.body);
      }),
  );
};

export default attendanceRoutes;
