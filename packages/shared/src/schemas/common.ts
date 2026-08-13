import { z } from 'zod';

/**
 * Validation shared by the API and the web app.
 *
 * The same schema object validates the request on the server and the form in
 * the browser. Two copies of a rule drift, and the copy that drifts is always
 * the one the server trusts.
 *
 * Messages are i18n keys, not sentences — the client resolves them.
 */

export const idSchema = z.string().min(1).max(64);

export const schoolSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, { message: 'validation.school_slug' });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(320)
  .email({ message: 'validation.email' });

/**
 * Length only, no composition rules. Forcing a symbol produces `Password1!`
 * everywhere and buys nothing; length is what actually matters. Twelve
 * characters is a working minimum for a system holding children's records.
 */
export const passwordSchema = z
  .string()
  .min(12, { message: 'validation.password.too_short' })
  .max(200);

/** A local calendar date: "2026-08-13". Never an instant. */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'error.validation',
  });

/** Money on the wire: a string, so no amount ever becomes a float. */
export const moneyWireSchema = z.object({
  amountMinor: z.string().regex(/^-?\d+$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  minorUnits: z.number().int().min(0).max(4),
});

/** Every error the API returns has this shape. */
export const apiErrorSchema = z.object({
  error: z.object({
    /** i18n key, e.g. "error.auth.invalid_credentials". */
    key: z.string(),
    /** Machine-readable, stable across wording changes. */
    code: z.string(),
    /** Per-field keys for form errors. */
    fields: z.record(z.string(), z.string()).optional(),
    /** Correlates a user's screenshot with a server log line. */
    requestId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
