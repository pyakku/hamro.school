import { useT, useLocale } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useNotices } from '../lib/queries.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';
import { StatusPill } from '../components/StatusPill.js';
import { instant } from '../lib/format.js';

/**
 * Notices from the office.
 *
 * The reader only ever receives the ones they are an audience for — the server
 * decides that from the notice's scope and its `audienceRoles`, so a parent in
 * 7B never has 8A's trip letter in the response to filter out.
 */
export default function NoticesPage() {
  const t = useT();
  const locale = useLocale();
  const { user, can } = useSession();
  const notices = useNotices();
  const timezone = user?.school.timezone ?? 'UTC';

  return (
    <>
      <PageHeader title={t('page.notices.title')} subtitle={t('page.notices.subtitle')} />

      <QueryState
        isLoading={notices.isLoading}
        error={notices.error}
        onRetry={() => void notices.refetch()}
      >
        {(notices.data ?? []).length === 0 ? (
          <Panel>
            <EmptyState
              message={can('notice:write') ? 'page.notices.empty' : 'page.notices.empty_reader'}
            />
          </Panel>
        ) : (
          <div className="grid gap-3">
            {(notices.data ?? []).map((notice) => (
              <Panel key={notice.id}>
                <div className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    {notice.isPinned && (
                      <StatusPill label={t('page.notices.pinned')} tone="marigold" />
                    )}
                    <h2 className="font-display text-[16px] font-bold">{notice.title}</h2>
                    <span className="ml-auto font-mono text-[10.5px] text-ink-45">
                      {notice.publishedAt ? instant(notice.publishedAt, timezone, locale) : ''}
                    </span>
                  </div>

                  {/* School-authored copy. Stored and shown verbatim — it is
                      data, not a catalogue string. */}
                  <p className="mt-1.5 text-[14.5px] whitespace-pre-line text-ink-70">
                    {notice.body}
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-ink-45">
                    <span>
                      {notice.scope === 'SCHOOL'
                        ? t('page.notices.audience_school')
                        : (notice.audienceName ?? '')}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{notice.authorName}</span>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </QueryState>
    </>
  );
}
