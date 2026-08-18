import { Link } from 'react-router-dom';
import { useT, useLocale } from '../lib/i18n.js';
import { useOverview } from '../lib/queries.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { StatRow, StatTile } from '../components/StatTile.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';
import { AttendancePill, StatusPill } from '../components/StatusPill.js';
import {
  attendanceRate,
  attendanceRateLabel,
  attendanceTone,
  count,
  isZeroMoney,
  money,
} from '../lib/format.js';

/**
 * A guardian's children, one panel each.
 *
 * Built from the overview rather than a second endpoint: the server already
 * assembles exactly this — the children this guardian may see, honouring
 * `canViewRecords` on each link — and a parallel endpoint would be a second
 * place for that rule to be got wrong.
 */
export default function ChildrenPage() {
  const t = useT();
  const locale = useLocale();
  const overview = useOverview();
  const children = overview.data?.myChildren ?? [];

  return (
    <>
      <PageHeader title={t('home.children.title')} />

      <QueryState
        isLoading={overview.isLoading}
        error={overview.error}
        onRetry={() => void overview.refetch()}
      >
        {children.length === 0 ? (
          <Panel>
            <EmptyState message="home.children.empty" />
          </Panel>
        ) : (
          <div className="grid gap-4">
            {children.map((child) => {
              const rate = attendanceRate(child.term);
              return (
                <Panel
                  key={child.enrolmentId}
                  title={child.fullName}
                  meta={`${child.sectionName} · ${child.rollNumber}`}
                  action={
                    child.todayStatus ? (
                      <AttendancePill status={child.todayStatus} />
                    ) : (
                      <StatusPill label={t('home.children.no_register')} tone="muted" />
                    )
                  }
                  footer={
                    <div className="flex flex-wrap gap-x-4 gap-y-1 font-display text-[13px] font-semibold">
                      <Link to="/attendance" className="underline underline-offset-4 hover:text-marigold-deep">
                        {t('nav.attendance')}
                      </Link>
                      <Link to="/homework" className="underline underline-offset-4 hover:text-marigold-deep">
                        {t('nav.homework')}
                      </Link>
                      <Link to="/fees" className="underline underline-offset-4 hover:text-marigold-deep">
                        {t('nav.fees')}
                      </Link>
                    </div>
                  }
                >
                  <StatRow>
                    <StatTile
                      label={t('home.children.term_attendance')}
                      value={attendanceRateLabel(child.term)}
                      tone={attendanceTone(rate)}
                      hint={t('home.attendance.of_days', { count: child.term.schoolDays })}
                    />
                    <StatTile
                      label={t('home.attendance.present_days')}
                      value={count(child.term.present, locale)}
                    />
                    <StatTile
                      label={t('home.registers.late')}
                      value={count(child.term.late, locale)}
                      tone={child.term.late > 0 ? 'marigold' : 'muted'}
                    />
                    {child.outstanding ? (
                      <StatTile
                        label={t('home.children.dues')}
                        value={
                          isZeroMoney(child.outstanding)
                            ? '—'
                            : money(child.outstanding, locale)
                        }
                        tone={isZeroMoney(child.outstanding) ? 'muted' : 'stamp'}
                        hint={isZeroMoney(child.outstanding) ? t('home.fees.settled') : undefined}
                      />
                    ) : (
                      <StatTile
                        label={t('home.registers.absent')}
                        value={count(child.term.absentUnexplained, locale)}
                        tone={child.term.absentUnexplained > 0 ? 'stamp' : 'muted'}
                      />
                    )}
                  </StatRow>
                </Panel>
              );
            })}
          </div>
        )}
      </QueryState>
    </>
  );
}
