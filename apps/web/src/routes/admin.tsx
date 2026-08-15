import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformLoginRequestSchema, type MessageKey } from '@hamro/shared';
import { ApiRequestError, api, setAccessToken } from '../lib/api.js';
import { useT } from '../lib/i18n.js';

/**
 * The platform console at admin.hamro.school.
 *
 * A separate identity from any school login — a different table, a different
 * token audience, a different guard on the server. Nothing here is reachable
 * with a school session, however privileged that session is inside its own
 * school.
 *
 * The token is held in memory only, and there is no refresh cookie: this is a
 * console someone opens deliberately, and a two-hour session that ends when the
 * tab closes is the right trade for an account that can see every school.
 */

interface PlatformSchool {
  id: string;
  slug: string;
  name: string;
  plan: 'BETA' | 'STARTER' | 'PRO';
  isActive: boolean;
  timezone: string;
  currency: string;
  createdAt: string;
  url: string;
  counts: { users: number; students: number };
}

interface PlatformUser {
  id: string;
  identifier: string;
  firstName: string;
  lastName: string;
  contactEmail: string | null;
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  schoolId: string;
  schoolSlug: string;
  schoolName: string;
}

export default function Admin() {
  const [admin, setAdmin] = useState<{ name: string; email: string } | null>(null);
  return admin ? <Console admin={admin} onSignOut={() => setAdmin(null)} /> : <PlatformSignIn onSignedIn={setAdmin} />;
}

// ── Sign in ────────────────────────────────────────────────────────────────

function PlatformSignIn({ onSignedIn }: { onSignedIn: (a: { name: string; email: string }) => void }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = platformLoginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError('error.validation');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.post<{ accessToken: string; admin: { name: string; email: string } }>(
        '/platform/auth/login',
        parsed.data,
      );
      setAccessToken(result.accessToken);
      onSignedIn(result.admin);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? (caught.key as MessageKey) : 'error.generic');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative z-10 flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex items-baseline gap-2">
          <span className="font-display text-[22px] font-bold tracking-[-0.03em]">hamro</span>
          <span className="font-mono text-[10px] tracking-[0.16em] text-stamp uppercase">
            platform
          </span>
        </div>

        <div className="rounded-[3px] border border-ink bg-white">
          <div className="border-b-[1.5px] border-ink bg-card px-5 py-3.5">
            <h1 className="text-[19px]">{t('admin.sign_in.title')}</h1>
          </div>

          <form className="px-5 py-5" onSubmit={handleSubmit} noValidate>
            {error && (
              <div
                role="alert"
                className="mb-4 rounded-[3px] border border-stamp bg-stamp/8 px-3 py-2.5 text-[13.5px] text-stamp"
              >
                {t(error)}
              </div>
            )}

            <label className="mb-3.5 block" htmlFor="admin-email">
              <span className="field-label mb-1.5 block">{t('auth.sign_in.email')}</span>
              <input
                id="admin-email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                required
              />
            </label>

            <label className="mb-5 block" htmlFor="admin-password">
              <span className="field-label mb-1.5 block">{t('auth.sign_in.password')}</span>
              <input
                id="admin-password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
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

// ── Console ────────────────────────────────────────────────────────────────

function Console({
  admin,
  onSignOut,
}: {
  admin: { name: string; email: string };
  onSignOut: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [schoolFilter, setSchoolFilter] = useState<string | null>(null);

  const schools = useQuery({
    queryKey: ['platform', 'schools'],
    queryFn: () => api.get<{ schools: PlatformSchool[] }>('/platform/schools'),
  });

  const settings = useQuery({
    queryKey: ['platform', 'settings'],
    queryFn: () => api.get<{ signupEnabled: boolean }>('/platform/settings'),
  });

  const users = useQuery({
    queryKey: ['platform', 'users', schoolFilter],
    queryFn: () =>
      api.get<{ users: PlatformUser[]; total: number }>(
        `/platform/users${schoolFilter ? `?schoolId=${schoolFilter}` : ''}`,
      ),
  });

  const toggleSignup = useMutation({
    mutationFn: (signupEnabled: boolean) =>
      api.patch<{ signupEnabled: boolean }>('/platform/settings', { signupEnabled }),
    onSuccess: (data) => queryClient.setQueryData(['platform', 'settings'], data),
  });

  const updateSchool = useMutation({
    mutationFn: (input: { id: string; plan?: string; isActive?: boolean }) =>
      api.patch<{ schools: PlatformSchool[] }>(`/platform/schools/${input.id}`, {
        plan: input.plan,
        isActive: input.isActive,
      }),
    onSuccess: (data) => queryClient.setQueryData(['platform', 'schools'], data),
  });

  const list = schools.data?.schools ?? [];

  return (
    <div className="relative z-10 mx-auto w-full max-w-[1080px] px-6 py-8">
      <header className="mb-7 flex items-baseline gap-3">
        <span className="font-display text-[22px] font-bold tracking-[-0.03em]">hamro</span>
        <span className="font-mono text-[10px] tracking-[0.16em] text-stamp uppercase">platform</span>
        <span className="ml-auto font-mono text-[11px] text-ink-45">{admin.email}</span>
        <button
          type="button"
          className="font-display text-[13px] font-semibold text-ink-70 underline underline-offset-4 hover:text-ink"
          onClick={() => {
            setAccessToken(null);
            queryClient.clear();
            onSignOut();
          }}
        >
          {t('auth.sign_out')}
        </button>
      </header>

      {/* ── Beta switch ── */}
      <section className="mb-6 rounded-[3px] border border-ink bg-white">
        <div className="border-b-[1.5px] border-ink bg-card px-5 py-3">
          <h2 className="text-[15px]">{t('admin.signups.title')}</h2>
        </div>
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[14.5px]">
              {settings.data?.signupEnabled ? t('admin.signups.open') : t('admin.signups.closed')}
            </p>
            <p className="mt-0.5 text-[13px] text-ink-45">{t('admin.signups.help')}</p>
          </div>
          <button
            type="button"
            className="btn-primary ml-auto shrink-0"
            disabled={settings.isLoading || toggleSignup.isPending}
            onClick={() => toggleSignup.mutate(!(settings.data?.signupEnabled ?? true))}
          >
            {settings.data?.signupEnabled ? t('admin.signups.close') : t('admin.signups.open_action')}
          </button>
        </div>
      </section>

      {/* ── Schools ── */}
      <section className="mb-6 rounded-[3px] border border-ink bg-white">
        <div className="flex items-center gap-3 border-b-[1.5px] border-ink bg-card px-5 py-3">
          <h2 className="text-[15px]">{t('admin.schools.title')}</h2>
          <span className="ml-auto font-mono text-[11px] text-ink-45">{list.length}</span>
        </div>

        {list.length === 0 ? (
          <p className="px-5 py-6 text-[14px] text-ink-45">{t('admin.schools.empty')}</p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_110px_90px_110px_88px] gap-3 border-b border-rule px-5 py-2 font-mono text-[9.5px] tracking-[0.12em] text-ink-45 uppercase max-md:hidden">
              <div>{t('admin.schools.school')}</div>
              <div>{t('admin.schools.plan')}</div>
              <div className="text-right">{t('admin.schools.users')}</div>
              <div className="text-right">{t('admin.schools.students')}</div>
              <div className="text-right">{t('admin.schools.status')}</div>
            </div>

            {list.map((school) => (
              <div
                key={school.id}
                className="grid grid-cols-[1fr_110px_90px_110px_88px] items-center gap-3 border-b border-rule-soft px-5 py-3 last:border-b-0 hover:bg-card max-md:grid-cols-1"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{school.name}</div>
                  <a
                    href={school.url}
                    className="font-mono text-[11px] text-ink-45 underline-offset-2 hover:underline"
                  >
                    {school.slug}
                  </a>
                </div>

                <select
                  className="input px-2 py-1 font-mono text-[12px]"
                  value={school.plan}
                  disabled={updateSchool.isPending}
                  onChange={(e) => updateSchool.mutate({ id: school.id, plan: e.target.value })}
                  aria-label={t('admin.schools.plan')}
                >
                  <option value="BETA">BETA</option>
                  <option value="STARTER">STARTER</option>
                  <option value="PRO">PRO</option>
                </select>

                <button
                  type="button"
                  className="text-right font-mono text-[13px] underline-offset-2 hover:underline"
                  onClick={() => setSchoolFilter(school.id)}
                >
                  {school.counts.users}
                </button>

                <div className="text-right font-mono text-[13px]">{school.counts.students}</div>

                <div className="text-right">
                  <button
                    type="button"
                    className={`font-mono text-[10px] tracking-[0.08em] uppercase ${school.isActive ? 'text-jade' : 'text-stamp'}`}
                    disabled={updateSchool.isPending}
                    onClick={() => updateSchool.mutate({ id: school.id, isActive: !school.isActive })}
                  >
                    {school.isActive ? t('admin.schools.active') : t('admin.schools.suspended')}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      {/* ── Users ── */}
      <section className="rounded-[3px] border border-ink bg-white">
        <div className="flex items-center gap-3 border-b-[1.5px] border-ink bg-card px-5 py-3">
          <h2 className="text-[15px]">{t('admin.users.title')}</h2>
          {schoolFilter && (
            <button
              type="button"
              className="font-mono text-[11px] text-ink-45 underline underline-offset-2"
              onClick={() => setSchoolFilter(null)}
            >
              {t('admin.users.all_schools')}
            </button>
          )}
          <span className="ml-auto font-mono text-[11px] text-ink-45">{users.data?.total ?? 0}</span>
        </div>

        {(users.data?.users ?? []).length === 0 ? (
          <p className="px-5 py-6 text-[14px] text-ink-45">{t('empty.generic')}</p>
        ) : (
          (users.data?.users ?? []).map((user) => (
            <div
              key={user.id}
              className="grid grid-cols-[1fr_1fr_150px] items-center gap-3 border-b border-rule-soft px-5 py-2.5 last:border-b-0 hover:bg-card max-md:grid-cols-1"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {user.firstName} {user.lastName}
                </div>
                <div className="truncate font-mono text-[11px] text-ink-45">{user.identifier}</div>
              </div>
              <div className="truncate font-mono text-[11px] text-ink-45">{user.schoolName}</div>
              <div className="font-mono text-[10px] tracking-[0.08em] text-ink-45 uppercase">
                {user.roles.map((role) => t(`role.${role}` as MessageKey)).join(' · ')}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
