import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { signupRequestSchema, isSchoolSlugAvailable, type MessageKey } from '@hamro/shared';
import { ApiRequestError, api } from '../lib/api.js';
import { baseDomain } from '../lib/tenant.js';
import { useT } from '../lib/i18n.js';

interface SignupResult {
  school: { slug: string; name: string; plan: string };
  url: string;
}

/**
 * School signup.
 *
 * The school picks its own address, and that address is the thing they will
 * type every morning for years — so it is checked live, shown in full as they
 * type it, and confirmed before anything is created.
 */
export default function Signup() {
  const t = useT();

  const [schoolName, setSchoolName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [availability, setAvailability] = useState<
    { state: 'idle' | 'checking' } | { state: 'done'; available: boolean; reason?: string }
  >({ state: 'idle' });

  const [adminFirstName, setAdminFirstName] = useState('');
  const [adminLastName, setAdminLastName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SignupResult | null>(null);

  // Suggest an address from the name, until they edit it themselves.
  useEffect(() => {
    if (slugTouched) return;
    setSlug(
      schoolName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40),
    );
  }, [schoolName, slugTouched]);

  // Debounced, because it runs on every keystroke and the answer only matters
  // once they stop typing.
  useEffect(() => {
    if (!slug || !isSchoolSlugAvailable(slug)) {
      setAvailability(slug ? { state: 'done', available: false, reason: 'validation.slug_unavailable' } : { state: 'idle' });
      return;
    }

    setAvailability({ state: 'checking' });
    const timer = setTimeout(() => {
      api
        .get<{ available: boolean; reason?: string }>(
          `/signup/slug-available?slug=${encodeURIComponent(slug)}`,
        )
        .then((r) => setAvailability({ state: 'done', available: r.available, reason: r.reason }))
        .catch(() => setAvailability({ state: 'idle' }));
    }, 400);

    return () => clearTimeout(timer);
  }, [slug]);

  if (result) {
    return (
      <main className="min-h-full flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[440px] rounded-[3px] border border-ink bg-white">
          <div className="border-b-[1.5px] border-ink bg-card px-5 py-3.5">
            <h1 className="text-[19px]">{t('signup.done.title')}</h1>
          </div>
          <div className="px-5 py-5">
            <p className="text-[14.5px] text-ink-70">{t('signup.done.body', { url: result.url })}</p>
            <a className="btn-primary mt-5 w-full" href={result.url}>
              {t('auth.sign_in.submit')}
            </a>
          </div>
        </div>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const parsed = signupRequestSchema.safeParse({
      schoolName,
      slug,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      currency: 'USD',
      adminFirstName,
      adminLastName,
      adminEmail,
      adminPassword,
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errors[String(issue.path[0] ?? '_')] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      setResult(await api.post<SignupResult>('/signup', parsed.data));
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFormError(error.key as MessageKey);
        if (error.fields) setFieldErrors(error.fields);
      } else {
        setFormError('error.generic');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const slugState =
    availability.state === 'checking'
      ? t('signup.address_checking')
      : availability.state === 'done'
        ? availability.available
          ? t('signup.address_available')
          : t((availability.reason ?? 'validation.slug_unavailable') as MessageKey)
        : t('signup.address_help');

  const slugBad = availability.state === 'done' && !availability.available;

  return (
    <main className="min-h-full flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-7 flex items-baseline gap-px">
          <span className="font-display text-[22px] font-bold tracking-[-0.03em]">hamro</span>
          <span className="font-mono text-[14px] text-marigold-deep">.school</span>
        </div>

        <div className="rounded-[3px] border border-ink bg-white">
          <div className="border-b-[1.5px] border-ink bg-card px-5 py-3.5">
            <h1 className="text-[19px]">{t('signup.title')}</h1>
            <p className="mt-0.5 text-[13.5px] text-ink-45">{t('signup.subtitle')}</p>
          </div>

          <form className="px-5 py-5" onSubmit={handleSubmit} noValidate>
            {formError && (
              <div
                role="alert"
                className="mb-4 rounded-[3px] border border-stamp bg-stamp/8 px-3 py-2.5 text-[13.5px] text-stamp"
              >
                {t(formError)}
              </div>
            )}

            <label className="mb-3.5 block" htmlFor="schoolName">
              <span className="field-label mb-1.5 block">{t('signup.school_name')}</span>
              <input
                id="schoolName"
                className="input"
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                aria-invalid={Boolean(fieldErrors.schoolName)}
                required
              />
            </label>

            <label className="mb-3.5 block" htmlFor="slug">
              <span className="field-label mb-1.5 block">{t('signup.address')}</span>
              <div className="flex items-center gap-1">
                <input
                  id="slug"
                  className="input font-mono"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={slugBad || Boolean(fieldErrors.slug)}
                  aria-describedby="slug-help"
                  required
                />
                <span className="shrink-0 font-mono text-[13px] text-ink-45">.{baseDomain}</span>
              </div>
              <span
                id="slug-help"
                className={`mt-1.5 block font-mono text-[11px] ${slugBad ? 'text-stamp' : 'text-ink-45'}`}
              >
                {slugState}
              </span>
            </label>

            <div className="my-5 border-t border-rule pt-4">
              <p className="field-label mb-3">{t('signup.admin_heading')}</p>

              <div className="mb-3.5 grid grid-cols-2 gap-3">
                <label htmlFor="firstName">
                  <span className="field-label mb-1.5 block">{t('signup.first_name')}</span>
                  <input
                    id="firstName"
                    className="input"
                    value={adminFirstName}
                    onChange={(e) => setAdminFirstName(e.target.value)}
                    autoComplete="given-name"
                    required
                  />
                </label>
                <label htmlFor="lastName">
                  <span className="field-label mb-1.5 block">{t('signup.last_name')}</span>
                  <input
                    id="lastName"
                    className="input"
                    value={adminLastName}
                    onChange={(e) => setAdminLastName(e.target.value)}
                    autoComplete="family-name"
                    required
                  />
                </label>
              </div>

              <label className="mb-3.5 block" htmlFor="adminEmail">
                <span className="field-label mb-1.5 block">{t('auth.sign_in.email')}</span>
                <input
                  id="adminEmail"
                  type="email"
                  className="input"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  autoComplete="email"
                  autoCapitalize="none"
                  aria-invalid={Boolean(fieldErrors.adminEmail)}
                  required
                />
                {fieldErrors.adminEmail && (
                  <span className="mt-1.5 block font-mono text-[11px] text-stamp">
                    {t(fieldErrors.adminEmail as MessageKey)}
                  </span>
                )}
              </label>

              <label className="mb-1 block" htmlFor="adminPassword">
                <span className="field-label mb-1.5 block">{t('auth.sign_in.password')}</span>
                <input
                  id="adminPassword"
                  type="password"
                  className="input"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  autoComplete="new-password"
                  aria-invalid={Boolean(fieldErrors.adminPassword)}
                  required
                />
                <span
                  className={`mt-1.5 block font-mono text-[11px] ${fieldErrors.adminPassword ? 'text-stamp' : 'text-ink-45'}`}
                >
                  {t(
                    (fieldErrors.adminPassword ?? 'validation.password.too_short') as MessageKey,
                  )}
                </span>
              </label>
            </div>

            <button type="submit" className="btn-primary w-full" disabled={submitting || slugBad}>
              {submitting ? t('signup.submitting') : t('signup.submit')}
            </button>

            <p className="mt-4 text-center text-[13.5px] text-ink-45">
              {t('signup.have_account')}{' '}
              <Link to="/sign-in" className="underline underline-offset-4 hover:text-ink">
                {t('auth.sign_in.submit')}
              </Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
