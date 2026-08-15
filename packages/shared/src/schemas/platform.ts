import { z } from 'zod';
import { emailSchema } from './common.js';

/**
 * The platform console at admin.hamro.school — us, not a school.
 *
 * Deliberately a separate identity system from school logins: a bug in school
 * authentication must not be able to produce a session that can see every
 * school at once.
 */
export const platformLoginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: 'validation.required' }),
});

export const platformSessionSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});

export const platformLoginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  admin: platformSessionSchema,
});

export const platformSchoolSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  plan: z.enum(['BETA', 'STARTER', 'PRO']),
  isActive: z.boolean(),
  timezone: z.string(),
  currency: z.string(),
  createdAt: z.string(),
  onboardedAt: z.string().nullable(),
  url: z.string(),
  counts: z.object({
    users: z.number().int(),
    students: z.number().int(),
  }),
});

export const platformSchoolsResponseSchema = z.object({
  schools: z.array(platformSchoolSchema),
});

export const updateSchoolRequestSchema = z.object({
  plan: z.enum(['BETA', 'STARTER', 'PRO']).optional(),
  isActive: z.boolean().optional(),
});

export const platformUserSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  contactEmail: z.string().nullable(),
  roles: z.array(z.string()),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
  schoolId: z.string(),
  schoolSlug: z.string(),
  schoolName: z.string(),
});

export const platformUsersResponseSchema = z.object({
  users: z.array(platformUserSchema),
  total: z.number().int(),
});

export const platformSettingsSchema = z.object({
  /** When false, /signup refuses. The switch for opening and closing the beta. */
  signupEnabled: z.boolean(),
});

export const updatePlatformSettingsSchema = platformSettingsSchema.partial();
