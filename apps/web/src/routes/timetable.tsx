import type { MessageKey } from '@hamro/shared';
import { useT } from '../lib/i18n.js';
import { useTimetable, type TimetableCell } from '../lib/queries.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const DAY_KEY: Record<(typeof DAYS)[number], MessageKey> = {
  MON: 'weekday.1',
  TUE: 'weekday.2',
  WED: 'weekday.3',
  THU: 'weekday.4',
  FRI: 'weekday.5',
  SAT: 'weekday.6',
  SUN: 'weekday.7',
};

/**
 * The week as it is scheduled.
 *
 * A day with no periods is left out rather than shown empty: schools run
 * five-, six- and seven-day weeks, and printing an empty Saturday for the ones
 * that do not is a small lie about how the school works.
 */
export default function TimetablePage() {
  const t = useT();
  const timetable = useTimetable();

  const byDay = DAYS.map((day) => ({
    day,
    entries: (timetable.data ?? [])
      .filter((entry) => entry.dayOfWeek === day)
      .sort((a, b) => a.periodSequence - b.periodSequence),
  })).filter((group) => group.entries.length > 0);

  return (
    <>
      <PageHeader title={t('page.timetable.title')} subtitle={t('page.timetable.subtitle')} />

      <QueryState
        isLoading={timetable.isLoading}
        error={timetable.error}
        onRetry={() => void timetable.refetch()}
      >
        {byDay.length === 0 ? (
          <Panel>
            <EmptyState message="page.timetable.empty" />
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {byDay.map(({ day, entries }) => (
              <Panel key={day} title={t(DAY_KEY[day])} meta={`${entries.length}`}>
                <ul>
                  {entries.map((entry) => (
                    <Row key={entry.id} entry={entry} />
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

function Row({ entry }: { entry: TimetableCell }) {
  return (
    <li className="flex items-center gap-3 border-b border-rule-soft px-4 py-2.5 last:border-b-0 sm:px-5">
      <span className="w-[92px] shrink-0 font-mono text-[11.5px] tabular-nums text-ink-45">
        {entry.startTime}–{entry.endTime}
      </span>
      <span className="min-w-0 flex-1 truncate text-[14.5px]">{entry.subjectName}</span>
      <span className="shrink-0 font-mono text-[11px] text-ink-45">{entry.sectionName}</span>
      {entry.room && (
        <span className="hidden shrink-0 font-mono text-[11px] text-ink-45 sm:inline">
          {entry.room}
        </span>
      )}
    </li>
  );
}
