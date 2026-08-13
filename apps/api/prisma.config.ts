import { defineConfig, env } from 'prisma/config';

// One .env at the repo root for the whole monorepo. Prisma's CLI does not run
// through our own entrypoint, so it loads the file itself.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // Absent in CI, where the environment is already populated.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',

  // Migrations and the seed connect as the table owner, which is not subject
  // to row-level security. The API never uses this URL.
  datasource: {
    url: env('MIGRATION_DATABASE_URL'),
  },

  migrations: {
    seed: 'tsx --env-file=../../.env prisma/seed.ts',
  },
});
