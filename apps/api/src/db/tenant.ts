import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@hamro/shared';
import { rawPrisma } from './client.js';
import { isAuditedModel, isSoftDeleteModel, isTenantModel } from './models.js';

/**
 * Tenant isolation, in one place.
 *
 * A bug that shows one school another school's data ends this business, so it
 * is defended twice and neither layer is optional:
 *
 *   1. This Prisma extension puts `schoolId` into the `where` of every read and
 *      the `data` of every create. A route handler cannot forget it, because a
 *      route handler never writes it.
 *
 *   2. Postgres row-level security, set up in the RLS migration and switched on
 *      per transaction below. If a query ever escapes the extension — raw SQL,
 *      a background job, someone in psql with the app credentials — the
 *      database itself returns nothing.
 *
 * The second layer is why every request runs its database work inside
 * `withTenant()`: `SET LOCAL` only lasts for a transaction, and a transaction
 * is the only unit of work that reliably owns one connection from the pool.
 */

export interface TenantContext {
  readonly schoolId: string;
  /** Null before login, e.g. while looking up a user by email. */
  readonly userId?: string | null;
  /** Which hat the user is wearing; recorded on audit entries. */
  readonly actorRole?: Role | null;
  readonly requestId?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export class TenantScopeError extends Error {}
export class AuditRequiredError extends Error {}

/** Operations whose `args.where` identifies the rows they touch. */
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

/** Operations that bring new rows into being. */
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

/** Reads, where a soft-deleted row should be invisible unless asked for. */
const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

type Args = Record<string, unknown>;

/**
 * Set while a write to an audited model is legitimately in progress. See
 * `auditedWrite` in ./audit.ts — writes to marks, fees and attendance outside
 * that helper throw, so "I forgot the audit entry" fails loudly in development
 * rather than quietly in a dispute two years later.
 */
export const auditScope = new AsyncLocalStorage<{ entityType: string }>();

function withSchoolFilter(where: unknown, schoolId: string): Args {
  const existing = (where ?? {}) as Args;
  if (existing.schoolId !== undefined && existing.schoolId !== schoolId) {
    throw new TenantScopeError(
      `Query tried to scope to school ${String(existing.schoolId)} inside the context of ${schoolId}.`,
    );
  }
  return { ...existing, schoolId };
}

function withSoftDeleteFilter(where: Args): Args {
  // An explicit mention of deletedAt is the opt-out: a "restore deleted
  // student" screen says `deletedAt: { not: null }` and means it.
  if ('deletedAt' in where) return where;
  return { ...where, deletedAt: null };
}

/**
 * Creates still name their own `schoolId` — Prisma's generated types require
 * it and there is no way to relax that without rewriting the whole client's
 * types. So the extension's job here is not to fill it in but to refuse a
 * wrong one: writing a row into a school other than the caller's context is a
 * hard error, not a silent correction.
 */
function withSchoolData(data: unknown, schoolId: string): unknown {
  const check = (row: Args): Args => {
    if (row.schoolId !== undefined && row.schoolId !== schoolId) {
      throw new TenantScopeError(
        `Refusing to write a row into school ${String(row.schoolId)} from the context of ${schoolId}.`,
      );
    }
    return { ...row, schoolId };
  };

  if (Array.isArray(data)) return data.map((row) => check(row as Args));
  return check((data ?? {}) as Args);
}

/**
 * Wraps the base client so that every query is confined to one school.
 * Returned by `withTenant()`; not exported for direct use.
 */
function scopedClient(ctx: TenantContext) {
  return rawPrisma.$extends({
    name: 'hamro-tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantModel(model)) {
            // School and PlatformAdmin. Neither has a schoolId to filter on;
            // both are guarded by the policy layer instead.
            return query(args);
          }

          if (
            isAuditedModel(model) &&
            WRITE_OPERATIONS.has(operation) &&
            auditScope.getStore() === undefined
          ) {
            throw new AuditRequiredError(
              `${operation} on ${model} must go through auditedWrite(): marks, fees and ` +
                `attendance carry an append-only audit trail. See src/db/audit.ts.`,
            );
          }

          const next = { ...(args as Args) };

          if (WHERE_OPERATIONS.has(operation)) {
            let where = withSchoolFilter(next.where, ctx.schoolId);
            if (isSoftDeleteModel(model) && READ_OPERATIONS.has(operation)) {
              where = withSoftDeleteFilter(where);
            }
            next.where = where;
          }

          if (CREATE_OPERATIONS.has(operation)) {
            if (operation === 'upsert') {
              next.create = withSchoolData(next.create, ctx.schoolId);
            } else if (next.data !== undefined) {
              next.data = withSchoolData(next.data, ctx.schoolId);
            }
          }

          return query(next);
        },
      },
    },
  });
}

export type TenantClient = Omit<
  ReturnType<typeof scopedClient>,
  '$connect' | '$disconnect' | '$transaction' | '$extends'
>;

/**
 * Runs a unit of database work as one school.
 *
 * Everything inside is a single transaction on a single connection, with
 * `app.school_id` set for its lifetime, which is what makes the RLS policies
 * bite. Two rules follow:
 *
 *   · No network call inside — no FCM push, no email, no S3 upload. Those hold
 *     the connection open and turn a 200ms request into a lock. Do the database
 *     work, let `withTenant` return, then talk to the outside world.
 *
 *   · No cross-school work inside. One call, one school, by construction.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (db: TenantClient) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  if (!ctx.schoolId) {
    throw new TenantScopeError('withTenant requires a schoolId.');
  }

  const client = scopedClient(ctx);

  return client.$transaction(
    async (tx) => {
      // `true` scopes the setting to this transaction, so a pooled connection
      // never carries one school's id into another school's request.
      await tx.$executeRaw`SELECT set_config('app.school_id', ${ctx.schoolId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
      return fn(tx as unknown as TenantClient);
    },
    { timeout: options?.timeoutMs ?? 10_000 },
  );
}

/**
 * The pre-login path: resolving a school from the slug someone typed on the
 * sign-in screen. `School` has no `schoolId` to filter by and no tenant exists
 * yet, so this is the one legitimate unscoped read in the application.
 *
 * It returns only what the login screen needs and never accepts a filter from
 * the caller.
 */
export async function findSchoolBySlug(slug: string) {
  return rawPrisma.school.findFirst({
    where: { slug, isActive: true, deletedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      timezone: true,
      currency: true,
      currencyMinorUnits: true,
      defaultLocale: true,
    },
  });
}
