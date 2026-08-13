import type { AuditAction } from '../generated/prisma/enums.js';
import { auditScope, type TenantClient, type TenantContext } from './tenant.js';

/**
 * The audit trail for marks, fees and attendance.
 *
 * Schools have disputes. A parent will one day insist their child's mark was
 * 78, and someone will have to say who changed it to 68, when, and why. That
 * conversation is only possible if the trail is written at the moment of the
 * change and cannot be tidied up afterwards, so:
 *
 *   · `audit_logs` is append-only at the database. The migration revokes UPDATE
 *     and DELETE on it from the application role, so not even a bug in this
 *     file can rewrite history.
 *
 *   · The entry is written in the same transaction as the change. Either both
 *     land or neither does; there is no window where a mark moved and the log
 *     did not notice.
 *
 *   · Writes to audited models outside `auditedWrite` throw. The tenant
 *     extension checks for this scope, so forgetting is a loud failure in
 *     development rather than a quiet gap in evidence.
 */

export interface AuditSpec {
  /** Prisma model name, e.g. "Mark". */
  entityType: string;
  entityId: string;
  action: AuditAction;
  /** The row before the change. Omit for CREATE. */
  before?: Record<string, unknown> | null;
  /** The row after. Omit for a hard delete. */
  after?: Record<string, unknown> | null;
  /**
   * Why. Required by the service layer for the changes that get argued about:
   * amending a locked attendance day, editing a mark after results are
   * published, reversing a payment.
   */
  reason?: string | null;
}

/** Values that would bloat the log or leak a secret if copied into it. */
const NEVER_LOGGED = new Set(['passwordHash', 'tokenHash', 'medicalNotes']);

function serialise(value: Record<string, unknown> | null | undefined): unknown {
  if (value === null || value === undefined) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (NEVER_LOGGED.has(key)) continue;
    // BigInt money and Decimal marks are not JSON values. Both go in as exact
    // strings — turning either into a number would defeat the point of storing
    // them precisely in the first place.
    if (typeof raw === 'bigint') {
      output[key] = raw.toString();
    } else if (raw instanceof Date) {
      output[key] = raw.toISOString();
    } else if (raw !== null && typeof raw === 'object' && 'toFixed' in raw) {
      output[key] = String(raw);
    } else {
      output[key] = raw;
    }
  }
  return output;
}

function changedFieldsOf(before: unknown, after: unknown): string[] {
  if (before === undefined || after === undefined) return [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys].filter((key) => JSON.stringify(b[key]) !== JSON.stringify(a[key]));
}

/**
 * Performs a write to an audited model and records it, in one transaction.
 *
 * ```ts
 * await withTenant(ctx, (db) =>
 *   auditedWrite(db, ctx, { entityType: 'Mark', entityId: mark.id, action: 'UPDATE',
 *                           before, reason: 'Re-mark after remark request' },
 *     () => db.mark.update({ where: { id: mark.id }, data: { rawMarks } }),
 *   ),
 * );
 * ```
 */
export async function auditedWrite<T>(
  db: TenantClient,
  ctx: TenantContext,
  spec: AuditSpec,
  write: () => Promise<T>,
): Promise<T> {
  return auditScope.run({ entityType: spec.entityType }, async () => {
    const result = await write();

    const before = serialise(spec.before);
    const after = serialise(
      spec.after ?? (result !== null && typeof result === 'object' ? (result as Record<string, unknown>) : null),
    );

    await db.auditLog.create({
      data: {
        schoolId: ctx.schoolId,
        entityType: spec.entityType,
        // A create only knows its id once it exists.
        entityId: spec.entityId || extractId(result),
        action: spec.action,
        changedFields: changedFieldsOf(before, after),
        before: (before ?? null) as never,
        after: (after ?? null) as never,
        actorUserId: ctx.userId ?? null,
        actorRole: ctx.actorRole ?? null,
        reason: spec.reason ?? null,
        requestId: ctx.requestId ?? null,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });

    return result;
  });
}

function extractId(result: unknown): string {
  if (result !== null && typeof result === 'object' && 'id' in result) {
    return String((result as { id: unknown }).id);
  }
  return '';
}

/**
 * Records something that happened without a single row behind it — a bulk
 * promotion run, a published report card, an exported mark sheet.
 */
export async function recordAuditEvent(
  db: TenantClient,
  ctx: TenantContext,
  spec: AuditSpec,
): Promise<void> {
  await auditScope.run({ entityType: spec.entityType }, async () => {
    await db.auditLog.create({
      data: {
        schoolId: ctx.schoolId,
        entityType: spec.entityType,
        entityId: spec.entityId,
        action: spec.action,
        changedFields: changedFieldsOf(serialise(spec.before), serialise(spec.after)),
        before: (serialise(spec.before) ?? null) as never,
        after: (serialise(spec.after) ?? null) as never,
        actorUserId: ctx.userId ?? null,
        actorRole: ctx.actorRole ?? null,
        reason: spec.reason ?? null,
        requestId: ctx.requestId ?? null,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
  });
}
