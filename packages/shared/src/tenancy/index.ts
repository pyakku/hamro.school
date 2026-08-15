/**
 * Which school is this request for?
 *
 * Each school gets `<slug>.hamro.school`. The subdomain is the tenant, so the
 * school is known before anyone types anything — the sign-in screen loses its
 * "School" field, and a parent who bookmarks their school's address lands
 * somewhere that already knows who they are.
 *
 * This lives in shared because the API resolves the tenant from the `Host`
 * header and the web app resolves it from `window.location`, and those two
 * must never disagree about what `stmarys.hamro.school` means.
 */

/**
 * Subdomains that are ours, not a school's.
 *
 * A school signing up as "api" or "www" would take over infrastructure we
 * depend on, so the signup flow must reject these too — that is why the list
 * is exported rather than hidden in here.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'app',
  'www',
  'api',
  'admin',
  'staging',
  'demo',
  'mail',
  'smtp',
  'ftp',
  'ns1',
  'ns2',
  'cdn',
  'assets',
  'static',
  'status',
  'help',
  'support',
  'docs',
  'blog',
  'billing',
  'account',
  'accounts',
  'login',
  'auth',
  'internal',
  'test',
]);

export interface TenantHostOptions {
  /** e.g. "hamro.school" */
  baseDomain: string;
}

/**
 * The school slug in a hostname, or null when there isn't one.
 *
 * Returns null for the base domain itself, for reserved names like `app`, and
 * for anything that is not a single label under the base domain. Null means
 * "ask the user which school" rather than "reject" — that is what keeps
 * `app.hamro.school` working as a shared sign-in.
 */
export function schoolSlugFromHost(
  host: string | null | undefined,
  { baseDomain }: TenantHostOptions,
): string | null {
  if (!host) return null;

  // Strip a port, lowercase, drop a trailing dot from a fully-qualified name.
  const hostname = host.split(':')[0]?.trim().toLowerCase().replace(/\.$/, '');
  if (!hostname) return null;

  const base = baseDomain.trim().toLowerCase();
  if (hostname === base) return null;
  if (!hostname.endsWith(`.${base}`)) return null;

  const label = hostname.slice(0, -(base.length + 1));

  // Exactly one label. `a.b.hamro.school` is not a school; it is a mistake or
  // an attempt at one.
  if (label.includes('.')) return null;
  if (RESERVED_SUBDOMAINS.has(label)) return null;
  if (!isValidSchoolSlug(label)) return null;

  return label;
}

/**
 * Slug rules, shared by signup validation and hostname parsing: lowercase
 * letters, digits and internal hyphens, 2–40 characters. It has to be a legal
 * DNS label, because it becomes one.
 */
export function isValidSchoolSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(value) && value.length >= 2;
}

/** True if a school may claim this slug. */
export function isSchoolSlugAvailable(value: string): boolean {
  return isValidSchoolSlug(value) && !RESERVED_SUBDOMAINS.has(value);
}

/** The address a school's people should use. */
export function schoolUrl(slug: string, baseDomain: string): string {
  return `https://${slug}.${baseDomain}`;
}
