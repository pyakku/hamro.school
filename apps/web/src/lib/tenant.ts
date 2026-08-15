import { schoolSlugFromHost } from '@hamro/shared';

declare const __BASE_DOMAIN__: string;

/**
 * The school this browser tab is for, from the address bar.
 *
 * On `stmarys.hamro.school` it is "stmarys" and the sign-in screen does not
 * ask. On `app.hamro.school` it is null and the user tells us. The API does
 * the same thing with the Host header, using the same function, so the two
 * cannot drift.
 */
export const currentSchoolSlug: string | null = schoolSlugFromHost(window.location.hostname, {
  baseDomain: __BASE_DOMAIN__,
});

export const baseDomain = __BASE_DOMAIN__;

/** True on admin.<base>: the platform console, not a school. */
export const isPlatformConsole: boolean =
  window.location.hostname.toLowerCase() === `admin.${__BASE_DOMAIN__}`;
