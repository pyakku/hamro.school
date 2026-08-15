import { z } from 'zod';
import { emailSchema, idSchema, passwordSchema, schoolSlugSchema } from './common.js';
import { PERMISSIONS, ROLES, SCOPES } from '../permissions/index.js';

export const roleSchema = z.enum(ROLES);
export const permissionSchema = z.enum(PERMISSIONS);
export const scopeSchema = z.enum(SCOPES);

export const grantSchema = z.object({
  permission: permissionSchema,
  scope: scopeSchema,
});

/**
 * Emails are unique per school, not globally, so a login needs to name one.
 *
 * On `<school>.hamro.school` the hostname names it and this field is absent —
 * the sign-in screen does not show it. On the shared `app.hamro.school` the
 * user types it. The server takes the hostname over the body when both are
 * present: a request cannot talk its way into another tenant.
 */
export const loginRequestSchema = z.object({
  schoolSlug: schoolSlugSchema.optional(),
  email: emailSchema,
  password: z.string().min(1, { message: 'validation.required' }),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionUserSchema = z.object({
  id: idSchema,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  locale: z.string(),
  roles: z.array(roleSchema),
  permissions: z.array(grantSchema),
  school: z.object({
    id: idSchema,
    slug: z.string(),
    name: z.string(),
    timezone: z.string(),
    currency: z.string(),
    currencyMinorUnits: z.number().int(),
    defaultLocale: z.string(),
  }),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

/**
 * The refresh token is not in this body — it is set as an httpOnly cookie, out
 * of reach of any script on the page. The Flutter app, which has no cookie
 * jar worth the name, asks for it in the body instead via `client=mobile`.
 */
export const loginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  refreshToken: z.string().optional(),
  user: sessionUserSchema,
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().optional(),
});

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  refreshToken: z.string().optional(),
});

export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export const meResponseSchema = z.object({ user: sessionUserSchema });

export const registerDeviceRequestSchema = z.object({
  token: z.string().min(10).max(4096),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']),
  appVersion: z.string().max(40).optional(),
  deviceModel: z.string().max(120).optional(),
  locale: z.string().max(20).optional(),
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
