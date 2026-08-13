import fp from 'fastify-plugin';
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';
import { AuditRequiredError, TenantScopeError } from '../db/tenant.js';

/**
 * One place where an exception becomes a response.
 *
 * Every body has the same shape and carries an i18n key rather than a sentence.
 * Anything unrecognised is a bug: it is logged in full and returned as a bare
 * 500, because a stack trace in a browser is a gift to whoever is poking at us.
 */
const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((rawError: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const error = rawError as FastifyError;

    if (rawError instanceof AppError) {
      // 401 and 403 are ordinary traffic; 4xx from a bug in our own validation
      // is worth seeing.
      request.log.debug({ err: rawError, code: rawError.code }, 'handled error');
      return reply.status(rawError.statusCode).send({
        error: { key: rawError.key, code: rawError.code, fields: rawError.fields, requestId },
      });
    }

    // Request validation. The Zod type provider wraps issues in Fastify's own
    // validation array rather than throwing a ZodError, so both shapes have to
    // be unpacked to get the per-field i18n keys out to the form.
    if (hasZodFastifySchemaValidationErrors(rawError)) {
      const fields: Record<string, string> = {};
      for (const issue of rawError.validation) {
        const path = issue.instancePath.replace(/^\//, '').replace(/\//g, '.');
        fields[path || '_'] = issue.message ?? 'error.validation';
      }
      return reply.status(422).send({
        error: { key: 'error.validation', code: 'VALIDATION_FAILED', fields, requestId },
      });
    }

    if (rawError instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of rawError.issues) {
        // The schema's message is an i18n key; see packages/shared/schemas.
        fields[issue.path.join('.') || '_'] = issue.message;
      }
      return reply.status(422).send({
        error: { key: 'error.validation', code: 'VALIDATION_FAILED', fields, requestId },
      });
    }

    // A tenant scope violation is never the user's fault and never routine.
    // It means application code tried to reach across schools: page someone.
    if (rawError instanceof TenantScopeError) {
      request.log.error({ err: error }, 'TENANT SCOPE VIOLATION');
      return reply.status(500).send({
        error: { key: 'error.generic', code: 'INTERNAL', requestId },
      });
    }

    if (rawError instanceof AuditRequiredError) {
      request.log.error({ err: error }, 'audited write attempted without an audit entry');
      return reply.status(500).send({
        error: { key: 'error.generic', code: 'INTERNAL', requestId },
      });
    }

    if (error.validation) {
      return reply.status(422).send({
        error: { key: 'error.validation', code: 'VALIDATION_FAILED', requestId },
      });
    }

    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: { key: 'error.rate_limited', code: 'RATE_LIMITED', requestId },
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.status(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).send({
      error: { key: 'error.generic', code: 'INTERNAL', requestId },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: { key: 'error.not_found', code: 'NOT_FOUND', requestId: request.id },
    });
  });
};

export default fp(errorHandlerPlugin, { name: 'hamro-error-handler' });
