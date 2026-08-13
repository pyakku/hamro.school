import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { loginRequestSchema, type MessageKey } from '@hamro/shared';
import { ApiRequestError } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';

/**
 * The sign-in screen — the only UI in this session.
 *
 * The school field is here because emails are unique per school, not globally:
 * one parent can hold an account at two schools. In production the subdomain
 * fills it in and this field is hidden; in development you type "greenhill".
 */
export default function SignIn() {
  const t = useT();
  const { user, signIn } = useSession();

  const [schoolSlug, setSchoolSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // The same schema the API validates against, so the browser and the server
    // cannot disagree about what a valid email is.
    const parsed = loginRequestSchema.safeParse({ schoolSlug, email, password });
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
      await signIn(parsed.data);
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

  return (
    <main className="min-h-full flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex items-baseline gap-px">
          <span className="font-display text-[22px] font-bold tracking-[-0.03em]">hamro</span>
          <span className="font-mono text-[14px] text-marigold-deep">.school</span>
        </div>

        <div className="rounded-[3px] border border-ink bg-white">
          <div className="border-b-[1.5px] border-ink bg-card px-5 py-3.5">
            <h1 className="text-[19px]">{t('auth.sign_in.title')}</h1>
            <p className="mt-0.5 text-[13.5px] text-ink-45">{t('auth.sign_in.subtitle')}</p>
          </div>

          <form className="px-5 py-5" onSubmit={handleSubmit} noValidate>
            {formError && (
              /* role=alert, so a screen reader hears the failure rather than
                 only seeing a red box appear. */
              <div
                role="alert"
                className="mb-4 rounded-[3px] border border-stamp bg-stamp/8 px-3 py-2.5 text-[13.5px] text-stamp"
              >
                {t(formError)}
              </div>
            )}

            <label className="mb-3.5 block" htmlFor="schoolSlug">
              <span className="field-label mb-1.5 block">{t('auth.sign_in.school')}</span>
              <input
                id="schoolSlug"
                className="input font-mono"
                value={schoolSlug}
                onChange={(event) => setSchoolSlug(event.target.value)}
                placeholder={t('auth.sign_in.school_placeholder')}
                autoComplete="organization"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={Boolean(fieldErrors.schoolSlug)}
                aria-describedby="schoolSlug-help"
                required
              />
              <span id="schoolSlug-help" className="mt-1.5 block font-mono text-[11px] text-ink-45">
                {fieldErrors.schoolSlug
                  ? t(fieldErrors.schoolSlug as MessageKey)
                  : t('auth.sign_in.school_help')}
              </span>
            </label>

            <label className="mb-3.5 block" htmlFor="email">
              <span className="field-label mb-1.5 block">{t('auth.sign_in.email')}</span>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={Boolean(fieldErrors.email)}
                required
              />
              {fieldErrors.email && (
                <span className="mt-1.5 block font-mono text-[11px] text-stamp">
                  {t(fieldErrors.email as MessageKey)}
                </span>
              )}
            </label>

            <label className="mb-5 block" htmlFor="password">
              <span className="field-label mb-1.5 block">{t('auth.sign_in.password')}</span>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                aria-invalid={Boolean(fieldErrors.password)}
                required
              />
              {fieldErrors.password && (
                <span className="mt-1.5 block font-mono text-[11px] text-stamp">
                  {t(fieldErrors.password as MessageKey)}
                </span>
              )}
            </label>

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? t('auth.sign_in.submitting') : t('auth.sign_in.submit')}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
