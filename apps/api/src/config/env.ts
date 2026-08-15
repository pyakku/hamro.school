import { z } from 'zod';

/**
 * Configuration is validated once, at boot, and the process refuses to start
 * if anything is missing. A server that comes up with a blank JWT secret and
 * fails on the first login is worse than one that never comes up.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** The API's connection: the RLS-restricted `hamro_app` role. */
  DATABASE_URL: z.string().url(),
  /** Migrations and the seed only. Owner role, not subject to RLS. */
  MIGRATION_DATABASE_URL: z.string().url().optional(),

  /**
   * The domain schools live under. `<slug>.hamro.school` identifies the tenant,
   * so this is what turns a Host header into a school.
   */
  APP_BASE_DOMAIN: z.string().default('hamro.school'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  /**
   * Path the refresh cookie is scoped to, as the *browser* sees it.
   *
   * In production a reverse proxy serves the API under /api, so the browser
   * requests /api/auth/refresh while the API itself only ever sees
   * /auth/refresh. Scope the cookie to the API's own path and the browser
   * never sends it — every session dies on reload, silently.
   */
  REFRESH_COOKIE_PATH: z.string().startsWith('/').default('/auth'),

  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.string().optional(),
  FCM_PRIVATE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment. Copy .env.example to .env.\n${details}`);
  }

  if (parsed.data.NODE_ENV === 'production') {
    const weak = ['dev-only', 'change-me', 'secret'];
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (weak.some((marker) => parsed.data[key].includes(marker))) {
        throw new Error(`${key} still holds its development placeholder. Generate a real one.`);
      }
    }
  }

  return parsed.data;
}

export const env = load();

/** Turns "15m" / "30d" / "3600" into seconds. */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])?$/.exec(ttl.trim());
  if (!match) throw new Error(`Unparseable TTL: ${ttl}`);
  const amount = Number(match[1]);
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
  return amount * (match[2] ? (multipliers[match[2]] ?? 1) : 1);
}
