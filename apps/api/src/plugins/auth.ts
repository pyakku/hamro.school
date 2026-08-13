import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Permission, Role, Scope } from '@hamro/shared';
import { resolveScope } from '@hamro/shared';
import { forbidden, unauthenticated } from '../lib/errors.js';
import { InvalidTokenError, verifyAccessToken } from '../auth/tokens.js';
import type { Actor } from '../policy/guard.js';
import type { TenantContext } from '../db/tenant.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only after `requireAuth` has run. */
    actor?: Actor;
    /** Ready-made tenant context for `withTenant`. */
    tenant?: TenantContext;
  }

  interface FastifyInstance {
    requireAuth: preHandlerAsyncHookHandler;
    requirePermission: (permission: Permission) => preHandlerAsyncHookHandler;
  }
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Authentication and the permission gate.
 *
 * `requirePermission` is coarse by design — it answers "may a role of this kind
 * do this at all", and it is the check that must never be forgotten, so it sits
 * in the route definition where it is visible in review. The finer question of
 * *whose* records is answered inside the handler by the scope resolvers in
 * policy/guard.ts, because that needs the database and the request's own
 * academic year.
 */
const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('actor', undefined);
  app.decorateRequest('tenant', undefined);

  const requireAuth: preHandlerAsyncHookHandler = async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = bearerToken(request);
    if (!token) throw unauthenticated();

    try {
      const claims = await verifyAccessToken(token);
      const roles = (claims.roles ?? []) as Role[];

      request.actor = { userId: claims.sub, schoolId: claims.sid, roles };
      request.tenant = {
        schoolId: claims.sid,
        userId: claims.sub,
        actorRole: roles[0] ?? null,
        requestId: request.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      };
    } catch (cause) {
      if (cause instanceof InvalidTokenError) throw unauthenticated('error.auth.session_expired');
      throw cause;
    }
  };

  const requirePermission = (permission: Permission): preHandlerAsyncHookHandler => {
    return async (request, reply) => {
      await requireAuth.call(app, request, reply);
      const actor = request.actor;
      if (!actor) throw unauthenticated();

      const scope: Scope | null = resolveScope(actor.roles, permission);
      if (scope === null) {
        request.log.warn(
          { userId: actor.userId, roles: actor.roles, permission },
          'permission denied',
        );
        throw forbidden();
      }
    };
  };

  app.decorate('requireAuth', requireAuth);
  app.decorate('requirePermission', requirePermission);
};

export default fp(authPlugin, { name: 'hamro-auth' });
