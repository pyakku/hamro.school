import { z } from 'zod';
import { emailSchema, passwordSchema } from './common.js';
import { isSchoolSlugAvailable } from '../tenancy/index.js';

/**
 * School self-signup.
 *
 * A school picks its own address — `<slug>.hamro.school` — so the slug is
 * validated with the same rule that parses it back out of a hostname, and
 * rejects the names our own infrastructure uses.
 */
export const schoolSignupSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(40)
  .refine(isSchoolSlugAvailable, { message: 'validation.slug_unavailable' });

export const signupRequestSchema = z.object({
  schoolName: z.string().trim().min(2).max(120),
  slug: schoolSignupSlugSchema,
  /** IANA zone. Attendance dates depend on it, so it is asked for up front. */
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  /** ISO 4217. */
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('USD'),
  adminFirstName: z.string().trim().min(1).max(80),
  adminLastName: z.string().trim().min(1).max(80),
  /** Becomes `<username>@<slug>`, which is how they sign in. */
  adminUsername: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/, { message: 'validation.username' }),
  /** A real mailbox for password resets. Optional, and not the login. */
  adminContactEmail: emailSchema.optional(),
  adminPassword: passwordSchema,
});

export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const signupResponseSchema = z.object({
  school: z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    plan: z.string(),
  }),
  /** Where the school's people sign in from now on. */
  url: z.string(),
});

export const slugAvailabilityQuerySchema = z.object({ slug: z.string().trim().toLowerCase() });

export const slugAvailabilityResponseSchema = z.object({
  slug: z.string(),
  available: z.boolean(),
  /** i18n key explaining why not, when it isn't. */
  reason: z.string().optional(),
});
