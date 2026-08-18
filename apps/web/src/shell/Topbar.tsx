import { useLocation } from 'react-router-dom';
import type { MessageKey } from '@hamro/shared';
import { useT, useLocale } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { activeNavItem, visibleNavItems } from '../lib/nav.js';
import { useSchoolContext } from '../lib/queries.js';
import { dateShort } from '../lib/format.js';

/**
 * The topbar: 56px, breadcrumb left, date and term right.
 *
 * The date is always on screen, and that is deliberate rather than decorative —
 * half of school work is date-dependent, and "which day is this register for"
 * is a question a teacher should never have to ask. It is the school's date,
 * from the server, not the browser's.
 */
export function Topbar() {
  const t = useT();
  const locale = useLocale();
  const { user, can, scopeFor } = useSession();
  const location = useLocation();
  const { data: context } = useSchoolContext(can('academic_year:read'));

  const current = activeNavItem(location.pathname, visibleNavItems(scopeFor));

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-rule bg-paper/92 px-4 backdrop-blur-sm sm:px-6">
      <div className="flex min-w-0 items-baseline gap-2">
        {/* The school is the constant; the page is where you are in it. */}
        <span className="truncate font-display text-[15px] font-bold">{user?.school.name}</span>
        {current && (
          <>
            <span aria-hidden className="text-ink-20">
              /
            </span>
            <span className="truncate text-[14px] text-ink-70">{t(current.label)}</span>
          </>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {context && (
          <>
            <span className="hidden font-mono text-[11px] text-ink-45 sm:inline">
              {context.currentTerm
                ? `${t('shell.term')} ${context.currentTerm.sequence}`
                : t('shell.between_terms')}
            </span>
            <span
              className="font-mono text-[11.5px] tabular-nums text-ink"
              // A date is data. Machine-readable as well as human-readable.
              title={context.academicYear?.name}
            >
              <time dateTime={context.today}>{dateShort(context.today, locale)}</time>
            </span>
            {!context.isSchoolDay && context.nonSchoolDayReason && (
              // School-authored wording, shown verbatim: "Dashain", "Snow day".
              <span className="hidden max-w-[220px] truncate rounded-full border border-marigold-deep/35 bg-marigold/15 px-2 py-px font-mono text-[10px] tracking-[0.08em] text-marigold-deep uppercase md:inline">
                {context.nonSchoolDayReason}
              </span>
            )}
          </>
        )}
      </div>
    </header>
  );
}

/** The roles line, for the account panel in Settings. */
export function useRoleNames(): string {
  const t = useT();
  const { user } = useSession();
  return (user?.roles ?? []).map((role) => t(`role.${role}` as MessageKey)).join(' · ');
}
