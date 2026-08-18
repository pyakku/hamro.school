import { useT, useLocale } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useHomework, useSchoolContext } from '../lib/queries.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';
import { StatusPill } from '../components/StatusPill.js';
import { date as formatDate } from '../lib/format.js';

/**
 * Homework, grouped by the day it is due.
 *
 * Due dates are calendar dates, so "Friday" means Friday at the school for
 * everyone reading — including a parent in another timezone, who would
 * otherwise be told their child's homework is due a day early.
 */
export default function HomeworkPage() {
  const t = useT();
  const locale = useLocale();
  const { can } = useSession();
  const { data: context } = useSchoolContext();
  const homework = useHomework();

  const canPost = can('homework:write');

  const groups = groupByDueDate(homework.data ?? []);

  return (
    <>
      <PageHeader title={t('page.homework.title')} subtitle={t('page.homework.subtitle')} />

      <QueryState
        isLoading={homework.isLoading}
        error={homework.error}
        onRetry={() => void homework.refetch()}
      >
        {groups.length === 0 ? (
          <Panel>
            <EmptyState message={canPost ? 'page.homework.empty' : 'page.homework.empty_parent'} />
          </Panel>
        ) : (
          <div className="grid gap-4">
            {groups.map(([dueDate, posts]) => (
              <Panel
                key={dueDate}
                title={t('page.homework.due', { date: formatDate(dueDate, locale) })}
                meta={`${posts.length}`}
                action={
                  // Marigold means pending, here as everywhere: work still due.
                  context && dueDate >= context.today ? (
                    <StatusPill label={t('column.due')} tone="marigold" />
                  ) : undefined
                }
              >
                <ul>
                  {posts.map((post) => (
                    <li
                      key={post.id}
                      className="border-b border-rule-soft px-4 py-3 last:border-b-0 sm:px-5"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        {/* Subject and section are school-authored; shown verbatim. */}
                        <span className="text-[14.5px] font-medium">{post.subjectName}</span>
                        <span className="font-mono text-[10.5px] text-ink-45">
                          {post.sectionName}
                        </span>
                        <span className="ml-auto font-mono text-[10.5px] text-ink-45">
                          {post.postedByName}
                        </span>
                      </div>
                      {post.title && (
                        <div className="mt-0.5 text-[14px] text-ink-70">{post.title}</div>
                      )}
                      <p className="mt-0.5 text-[13.5px] whitespace-pre-line text-ink-70">
                        {post.body}
                      </p>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        )}
      </QueryState>
    </>
  );
}

function groupByDueDate<T extends { dueDate: string }>(posts: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const post of posts) {
    const bucket = groups.get(post.dueDate) ?? [];
    bucket.push(post);
    groups.set(post.dueDate, bucket);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
