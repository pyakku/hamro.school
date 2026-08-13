import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * Tests run against a real Postgres, not a mock. The things most worth testing
 * here — row-level security, an append-only grant, a partial unique index —
 * only exist in the database, and a mock would happily agree with a bug.
 */
function loadEnvFile(): Record<string, string> {
  try {
    const contents = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
    const env: Record<string, string> = {};
    for (const line of contents.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match?.[1]) env[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '');
    }
    return env;
  } catch {
    return {};
  }
}

export default defineConfig({
  test: {
    environment: 'node',
    env: { ...loadEnvFile(), NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    // One database, shared. Running files in parallel would have them stepping
    // on each other's schools.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
