import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { rawPrisma } from './client.js';
import { TenantScopeError, withTenant } from './tenant.js';
import { auditedWrite } from './audit.js';

/**
 * The tests that matter most in this codebase.
 *
 * "A bug that leaks one school's data into another's is fatal to this
 * business" is not a thing to verify by reading the code. Two schools go into
 * a real database here, and every one of these tests tries to get at the
 * second one's rows from inside the first one's context.
 */

const suffix = Date.now().toString(36);
let schoolA = '';
let schoolB = '';

beforeAll(async () => {
  const a = await rawPrisma.school.create({
    data: { slug: `test-a-${suffix}`, name: 'Test School A', currency: 'INR', timezone: 'Asia/Kathmandu' },
  });
  const b = await rawPrisma.school.create({
    data: { slug: `test-b-${suffix}`, name: 'Test School B', currency: 'INR', timezone: 'Asia/Kathmandu' },
  });
  schoolA = a.id;
  schoolB = b.id;

  for (const [schoolId, name] of [
    [schoolA, 'Grade 6'],
    [schoolB, 'Grade 6'],
  ] as const) {
    await withTenant({ schoolId }, async (db) => {
      await db.gradeLevel.create({ data: { schoolId, name, level: 6 } });
      await db.subject.create({ data: { schoolId, code: 'MATH', name: 'Mathematics' } });
    });
  }
});

afterAll(async () => {
  // Cleanup runs as the owner, not as the app role — the app role genuinely
  // cannot delete an audit entry, which is the point of the append-only grant
  // and is asserted below. The owner is also exempt from RLS, so one pass
  // clears both schools.
  const owner = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
    }),
  });

  const ids = [schoolA, schoolB];
  await owner.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
  await owner.feeStructure.deleteMany({ where: { schoolId: { in: ids } } });
  await owner.subject.deleteMany({ where: { schoolId: { in: ids } } });
  await owner.gradeLevel.deleteMany({ where: { schoolId: { in: ids } } });
  await owner.academicYear.deleteMany({ where: { schoolId: { in: ids } } });
  await owner.school.deleteMany({ where: { id: { in: ids } } });

  await owner.$disconnect();
  await rawPrisma.$disconnect();
});

describe('the Prisma tenant extension', () => {
  it('confines a read to one school without the caller asking', async () => {
    const fromA = await withTenant({ schoolId: schoolA }, (db) => db.gradeLevel.findMany());
    expect(fromA).toHaveLength(1);
    expect(fromA[0]?.schoolId).toBe(schoolA);
  });

  it('cannot reach another school even when asked to by id', async () => {
    // The handler explicitly names school B's row. It still gets nothing,
    // because the extension adds `schoolId = A` alongside the id.
    const otherGrade = await withTenant({ schoolId: schoolB }, (db) =>
      db.gradeLevel.findFirstOrThrow(),
    );

    const leaked = await withTenant({ schoolId: schoolA }, (db) =>
      db.gradeLevel.findUnique({ where: { id: otherGrade.id } }),
    );

    expect(leaked).toBeNull();
  });

  it('refuses a query that names a different school outright', async () => {
    await expect(
      withTenant({ schoolId: schoolA }, (db) => db.gradeLevel.findMany({ where: { schoolId: schoolB } })),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it('refuses to write a row into another school', async () => {
    await expect(
      withTenant({ schoolId: schoolA }, (db) =>
        db.subject.create({ data: { schoolId: schoolB, code: 'SNEAK', name: 'Sneaky' } }),
      ),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it('does not update another school through updateMany', async () => {
    const updated = await withTenant({ schoolId: schoolA }, (db) =>
      db.subject.updateMany({ where: { code: 'MATH' }, data: { name: 'Renamed by A' } }),
    );
    expect(updated.count).toBe(1);

    const bsSubject = await withTenant({ schoolId: schoolB }, (db) =>
      db.subject.findFirstOrThrow({ where: { code: 'MATH' } }),
    );
    expect(bsSubject.name).toBe('Mathematics');
  });

  it('hides soft-deleted rows from ordinary reads', async () => {
    await withTenant({ schoolId: schoolA }, async (db) => {
      const subject = await db.subject.create({
        data: { schoolId: schoolA, code: 'TEMP', name: 'Temporary' },
      });
      await db.subject.update({ where: { id: subject.id }, data: { deletedAt: new Date() } });

      expect(await db.subject.findFirst({ where: { code: 'TEMP' } })).toBeNull();

      // ...unless the caller says otherwise, which a "restore" screen would.
      const deleted = await db.subject.findFirst({
        where: { code: 'TEMP', deletedAt: { not: null } },
      });
      expect(deleted?.name).toBe('Temporary');
    });
  });
});

/**
 * The second layer. If a query ever escapes the extension, Postgres itself has
 * to be the thing that says no.
 */
describe('row-level security', () => {
  it('returns nothing at all to a connection with no tenant context', async () => {
    // rawPrisma connects as hamro_app and this query never sets app.school_id.
    // Every tenant table is empty from where it is standing — including the
    // 120 seeded students.
    const [students] = await rawPrisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM students
    `;
    const [grades] = await rawPrisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM grade_levels
    `;

    expect(Number(students?.count ?? -1)).toBe(0);
    expect(Number(grades?.count ?? -1)).toBe(0);
  });

  it('shows only the school named in app.school_id', async () => {
    const rows = await withTenant({ schoolId: schoolA }, (db) =>
      db.$queryRaw<Array<{ school_id: string }>>`SELECT school_id FROM grade_levels`,
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.school_id === schoolA)).toBe(true);
  });

  it('is enabled on every table that carries a school_id', async () => {
    const rows = await rawPrisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
                         AND a.attname = 'school_id'
                         AND a.attnum > 0
                         AND NOT a.attisdropped
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND NOT c.relrowsecurity
    `;

    // A table added later without calling enable_tenant_rls() lands here.
    expect(rows.map((row) => row.table_name)).toEqual([]);
  });
});

describe('the audit trail', () => {
  it('refuses a write to an audited model that skips the audit entry', async () => {
    await expect(
      withTenant({ schoolId: schoolA }, (db) =>
        db.feeStructure.create({
          data: {
            schoolId: schoolA,
            academicYearId: 'nonexistent',
            name: 'Unaudited',
          },
        }),
      ),
    ).rejects.toThrow(/must go through auditedWrite/);
  });

  it('cannot be rewritten by the application role', async () => {
    // The grant, not the code, is what makes the log worth anything.
    await expect(
      rawPrisma.$executeRaw`UPDATE audit_logs SET reason = 'tidied up'`,
    ).rejects.toThrow(/permission denied/i);

    await expect(rawPrisma.$executeRaw`DELETE FROM audit_logs`).rejects.toThrow(/permission denied/i);
  });

  it('cannot delete a payment', async () => {
    // Money is reversed, never deleted, and the database agrees.
    await expect(rawPrisma.$executeRaw`DELETE FROM payments`).rejects.toThrow(/permission denied/i);
  });

  it('records who changed what, in the same transaction', async () => {
    const ctx = { schoolId: schoolA, userId: null, actorRole: 'SCHOOL_ADMIN' as const };

    const entry = await withTenant(ctx, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId: schoolA,
          name: `Audit year ${suffix}`,
          startDate: new Date('2026-04-01'),
          endDate: new Date('2027-03-31'),
        },
      });

      await auditedWrite(
        db,
        ctx,
        { entityType: 'FeeStructure', entityId: '', action: 'CREATE', reason: 'seeded by a test' },
        () =>
          db.feeStructure.create({
            data: { schoolId: schoolA, academicYearId: year.id, name: 'Audited structure' },
          }),
      );

      return db.auditLog.findFirst({
        where: { entityType: 'FeeStructure' },
        orderBy: { at: 'desc' },
      });
    });

    expect(entry?.action).toBe('CREATE');
    expect(entry?.reason).toBe('seeded by a test');
    expect(entry?.actorRole).toBe('SCHOOL_ADMIN');
    expect(entry?.entityId).not.toBe('');
  });
});
