import { buildApp } from './app.js';
import { env } from './config/env.js';
import { disconnectDatabase } from './db/client.js';

const app = await buildApp();

/**
 * Shut down in order: stop accepting requests, let the in-flight ones finish,
 * then drop the database connections. A teacher mid-save during a deploy should
 * get their save, not a socket error.
 */
async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown(signal));
}

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}
