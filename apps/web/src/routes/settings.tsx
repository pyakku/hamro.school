import type { MessageKey } from '@hamro/shared';
import { useT, useLocale } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useSchoolContext } from '../lib/queries.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { QueryState } from '../components/QueryState.js';
import { StatusPill } from '../components/StatusPill.js';
import { date as formatDate } from '../lib/format.js';
import { baseDomain } from '../lib/tenant.js';

/**
 * How this school is set up, and who you are signed in as.
 *
 * Read-only for now. Editing the shape of a year — grades, sections, terms,
 * holidays — is school setup, and it is the next thing to build; putting a
 * half-working edit form here would be worse than a page that is honest about
 * being a reference.
 */
export default function SettingsPage() {
  const t = useT();
  const locale = useLocale();
  const { user, can, signOut } = useSession();
  const context = useSchoolContext(can('academic_year:read'));

  if (!user) return null;

  return (
    <>
      <PageHeader title={t('page.settings.title')} subtitle={t('page.settings.subtitle')} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('page.settings.school')}>
          <dl className="px-4 py-3 sm:px-5">
            <Row label={t('column.name')} value={user.school.name} />
            <Row
              label={t('page.settings.address')}
              value={`${user.school.slug}.${baseDomain}`}
              mono
            />
            <Row label={t('page.settings.timezone')} value={user.school.timezone} mono />
            <Row
              label={t('page.settings.currency')}
              value={`${user.school.currency} · ${user.school.currencyMinorUnits}`}
              mono
            />
          </dl>
        </Panel>

        <Panel title={t('page.settings.your_account')}>
          <dl className="px-4 py-3 sm:px-5">
            <Row label={t('column.name')} value={`${user.firstName} ${user.lastName}`} />
            <Row label={t('auth.sign_in.identifier')} value={user.identifier} mono />
            <Row
              label={t('page.settings.roles')}
              value={user.roles.map((role) => t(`role.${role}` as MessageKey)).join(' · ')}
            />
            <Row
              label={t('page.settings.contact_email')}
              value={user.contactEmail ?? t('page.settings.no_contact_email')}
              mono={Boolean(user.contactEmail)}
            />
          </dl>
          <div className="border-t border-rule px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={() => void signOut()}
              className="font-display text-[13.5px] font-semibold text-ink-70 underline underline-offset-4 hover:text-stamp"
            >
              {t('auth.sign_out')}
            </button>
          </div>
        </Panel>

        {/*
          Only for readers who hold `academic_year:read`. A driver holds
          `school:read` and lands here quite legitimately for their own account
          details; asking for the year on their behalf would fill half the page
          with an access error about something they never asked to see.
        */}
        {can('academic_year:read') && (
        <QueryState
          isLoading={context.isLoading}
          error={context.error}
          onRetry={() => void context.refetch()}
        >
          {context.data?.academicYear ? (
            <Panel
              title={t('page.settings.year')}
              meta={context.data.academicYear.name}
              action={
                <StatusPill
                  label={context.data.academicYear.status}
                  tone={context.data.academicYear.status === 'ACTIVE' ? 'jade' : 'muted'}
                />
              }
              className="lg:col-span-2"
            >
              <dl className="px-4 py-3 sm:px-5">
                <Row
                  label={t('page.settings.year')}
                  value={`${formatDate(context.data.academicYear.startDate, locale)} – ${formatDate(
                    context.data.academicYear.endDate,
                    locale,
                  )}`}
                  mono
                />
              </dl>

              <div className="border-t border-rule-soft">
                <div className="field-label px-4 pt-3 sm:px-5">{t('page.settings.terms')}</div>
                <ul className="px-4 pb-3 sm:px-5">
                  {context.data.terms.map((term) => {
                    const isCurrent = context.data?.currentTerm?.id === term.id;
                    return (
                      <li
                        key={term.id}
                        className="flex flex-wrap items-baseline gap-x-3 border-b border-rule-soft py-2 last:border-b-0"
                      >
                        <span className="text-[14px]">{term.name}</span>
                        <span className="font-mono text-[11.5px] tabular-nums text-ink-45">
                          {formatDate(term.startDate, locale)} – {formatDate(term.endDate, locale)}
                        </span>
                        {isCurrent && (
                          <span className="ml-auto">
                            <StatusPill label={t('shell.term')} tone="marigold" />
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Panel>
          ) : (
            <Panel title={t('page.settings.year')} className="lg:col-span-2">
              <div className="px-5 py-8 text-center text-[14.5px] text-ink-45">
                {t('shell.no_year')}
              </div>
            </Panel>
          )}
        </QueryState>
        )}
      </div>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-4 border-b border-rule-soft py-2 last:border-b-0">
      <dt className="field-label w-[120px] shrink-0">{label}</dt>
      <dd className={mono ? 'font-mono text-[12.5px]' : 'text-[14.5px]'}>{value}</dd>
    </div>
  );
}
