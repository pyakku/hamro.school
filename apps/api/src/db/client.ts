import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

/**
 * The base client. It connects as `hamro_app`, which is subject to row-level
 * security, so even this client cannot read another school's rows once a
 * tenant context has been set on the connection.
 *
 * ⚠ Nothing outside `src/db` and the auth pre-login path should import this.
 * It carries no tenant filter of its own — that is what `withTenant()` adds.
 * Reach for `withTenant()`; if you find yourself importing `rawPrisma` in a
 * route handler, that is the bug.
 */
export const rawPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  log:
    env.NODE_ENV === 'development'
      ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
      : ['warn', 'error'],
});

export type RawPrismaClient = typeof rawPrisma;

export async function disconnectDatabase(): Promise<void> {
  await rawPrisma.$disconnect();
}
