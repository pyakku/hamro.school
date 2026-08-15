import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  signupRequestSchema,
  signupResponseSchema,
  slugAvailabilityQuerySchema,
  slugAvailabilityResponseSchema,
} from '@hamro/shared';
import { checkSlug, isCertificateAllowed, signUpSchool } from './service.js';

const signupRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * Creating a school is unauthenticated by necessity and cheap to abuse, so
   * it is the most tightly limited route in the product.
   */
  app.post(
    '/signup',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: { body: signupRequestSchema, response: { 200: signupResponseSchema } },
    },
    async (request) => signUpSchool(request.body),
  );

  app.get(
    '/signup/slug-available',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        querystring: slugAvailabilityQuerySchema,
        response: { 200: slugAvailabilityResponseSchema },
      },
    },
    async (request) => checkSlug(request.query.slug),
  );

  /**
   * Caddy's on-demand TLS gate. Not reachable from outside: the reverse proxy
   * refuses /api/internal/* before it ever gets here.
   *
   * Answers with a bare status because that is all Caddy reads.
   */
  app.get(
    '/internal/tls-allowed',
    { schema: { querystring: z.object({ domain: z.string().max(253) }) } },
    async (request, reply) => {
      const allowed = await isCertificateAllowed(request.query.domain);
      if (!allowed) {
        request.log.warn({ domain: request.query.domain }, 'refused certificate for unknown host');
        return reply.status(404).send();
      }
      return reply.status(200).send();
    },
  );
};

export default signupRoutes;
