/**
 * Delete the demo school, and only the demo school.
 *
 * `pnpm db:reset` drops the entire database, which on a shared development box
 * takes every other school with it — the one somebody is mid-way through
 * testing a signup against, most of all. This removes one tenant so the seed
 * can rebuild it.
 *
 * Demo data ages: the seed anchors on the day it runs, so a fortnight later the
 * registers stop before today and the homework is all overdue. Re-running this
 * before a demo is the intended cure.
 *
 * The delete order is discovered rather than declared. Forty-three tables carry
 * a `school_id`, and hand-maintaining a topological order for them is a list
 * that goes stale the first time somebody adds a model. Instead: try to delete
 * every table, keep the ones that fail a foreign key, and go round again. Each
 * pass must remove at least one table or the loop gives up rather than spinning
 * — which is what a genuine cycle would look like.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Set MIGRATION_DATABASE_URL (see .env.example) before resetting.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const SLUG = process.argv[2] ?? 'modelschool';

async function main(): Promise<void> {
  const school = await prisma.school.findUnique({
    where: { slug: SLUG },
    select: { id: true, name: true },
  });

  if (!school) {
    console.log(`No school "${SLUG}". Nothing to delete.`);
    return;
  }

  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'school_id'
    ORDER BY table_name
  `;

  let remaining = tables.map((row) => row.table_name);
  let deleted = 0;

  while (remaining.length > 0) {
    const blocked: string[] = [];

    for (const table of remaining) {
      try {
        // Autocommit, deliberately: a foreign key violation inside a
        // transaction would poison every later statement in it.
        deleted += await prisma.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE school_id = $1`,
          school.id,
        );
      } catch {
        blocked.push(table);
      }
    }

    if (blocked.length === remaining.length) {
      throw new Error(
        `Stuck with ${blocked.length} tables still referenced: ${blocked.join(', ')}. ` +
          'A new foreign key has made this a cycle; delete by hand or use pnpm db:reset.',
      );
    }
    remaining = blocked;
  }

  await prisma.school.delete({ where: { id: school.id } });
  console.log(`Deleted ${school.name} (${SLUG}) — ${deleted} rows. Run pnpm db:seed to rebuild.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
