import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from './config/env.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import authRoutes from './auth/routes.js';
import signupRoutes from './signup/routes.js';
import platformRoutes from './platform/routes.js';
import schoolRoutes from './school/routes.js';
import overviewRoutes from './overview/routes.js';
import attendanceRoutes from './attendance/routes.js';
import communicationRoutes from './communication/routes.js';
import peopleRoutes from './people/routes.js';
import feeRoutes from './fees/routes.js';
import assessmentRoutes from './assessment/routes.js';
import timetableRoutes from './timetable/routes.js';
import { rawPrisma } from './db/client.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Never log a password, a token or a cookie, in any environment. The
      // easiest way to leak a credential is to print it.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'body.password',
          'body.refreshToken',
          'body.newPassword',
          'body.currentPassword',
        ],
        censor: '[redacted]',
      },
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
        : {}),
    },
    // Trust the proxy in production so request.ip is the client's, not the
    // load balancer's — rate limiting and audit entries depend on it.
    trustProxy: env.NODE_ENV === 'production',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    // The API serves JSON to a separate origin; CSP belongs on the web app.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    // Every school has its own origin, so the allowed set is a rule rather
    // than a list: the configured origins, plus any subdomain of the base
    // domain. A wildcard string would not do — browsers refuse to send
    // credentials to `*`, and the refresh cookie is the whole session.
    origin(origin, callback) {
      if (!origin) return callback(null, true); // same-origin, curl, mobile
      let hostname: string;
      try {
        hostname = new URL(origin).hostname.toLowerCase();
      } catch {
        return callback(null, false);
      }
      const base = env.APP_BASE_DOMAIN.toLowerCase();
      const allowed =
        env.CORS_ORIGINS.includes(origin) ||
        hostname === base ||
        hostname.endsWith(`.${base}`);
      callback(null, allowed);
    },
    credentials: true, // the refresh cookie
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: false, // opted into per route, tightest where it matters
    max: 300,
    timeWindow: '1 minute',
  });

  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);

  app.get(
    '/health',
    { schema: { response: { 200: z.object({ status: z.string(), database: z.string() }) } } },
    async () => {
      // Liveness alone is not worth much: a process that is up but cannot
      // reach Postgres serves nothing but errors.
      await rawPrisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok' };
    },
  );

  await app.register(authRoutes);
  await app.register(signupRoutes);
  await app.register(platformRoutes);
  await app.register(schoolRoutes);
  await app.register(overviewRoutes);
  await app.register(attendanceRoutes);
  await app.register(communicationRoutes);
  await app.register(peopleRoutes);
  await app.register(feeRoutes);
  await app.register(assessmentRoutes);
  await app.register(timetableRoutes);

  return app;
}
