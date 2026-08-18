import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  feeSummarySchema,
  invoiceQuerySchema,
  invoiceRowSchema,
  paymentRowSchema,
} from '@hamro/shared';
import { inSchool } from '../lib/request.js';
import { feeSummary, listInvoices, listPayments } from './service.js';

const feeRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/fees/summary',
    {
      preHandler: fastify.requirePermission('invoice:read'),
      schema: { response: { 200: feeSummarySchema } },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, school, year, today }) => {
        if (!year) {
          const zero = { amountMinor: '0', currency: school.currency, minorUnits: school.currencyMinorUnits };
          return {
            invoiced: zero,
            collected: zero,
            outstanding: zero,
            overdue: zero,
            overdueCount: 0,
            invoiceCount: 0,
          };
        }
        return feeSummary(db, actor, school, year, today);
      }),
  );

  app.get(
    '/invoices',
    {
      preHandler: fastify.requirePermission('invoice:read'),
      schema: {
        querystring: invoiceQuerySchema,
        response: { 200: z.array(invoiceRowSchema) },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, school, year, today }) => {
        if (!year) return [];
        return listInvoices(db, actor, school, year, today, request.query);
      }),
  );

  app.get(
    '/payments',
    {
      preHandler: fastify.requirePermission('payment:read'),
      schema: {
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }),
        response: { 200: z.array(paymentRowSchema) },
      },
    },
    async (request) =>
      inSchool(request, async ({ db, actor, school, year }) => {
        if (!year) return [];
        return listPayments(db, actor, school, year, request.query.limit);
      }),
  );
};

export default feeRoutes;
