import { Link } from 'react-router-dom';
import type {
  AttendanceRun,
  MessageKey,
  MyChild,
  MySection,
  NoticeSummary,
  Overview,
  Period,
} from '@hamro/shared';
import { useT, useLocale } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useOverview, useSchoolContext } from '../lib/queries.js';
import { Panel, PanelBody } from '../components/Panel.js';
import { StatRow, StatTile } from '../components/StatTile.js';
import { EmptyState } from '../components/EmptyState.js';
import { AttendancePill, StatusPill } from '../components/StatusPill.js';
import { PageHeader } from '../components/PageHeader.js';
import {
  attendanceRate,
  attendanceRateLabel,
  attendanceTone,
  count,
  instant,
  isZeroMoney,
  money,
} from '../lib/format.js';

/**
 * The overview — and, because of how it is built, every role's landing page at
 * once.
 *
 * There is no `if (role === 'TEACHER')` here either. The server sends the
 * blocks this reader is permitted, and this page renders the blocks it was
 * sent. A teacher gets classes and periods; the office gets the ledger; a
 * parent gets their children. The teacher who is also a parent gets both,
 * stacked, without a line of code that knows that combination exists.
 *
 * The upshot worth keeping: adding a role, or widening one, changes the
 * permission matrix and this page follows. Nothing here needs editing.
 */
export default function OverviewPage() {
  const t = useT();
  const { user } = useSession();
  const { data, isLoading, isError, refetch } = useOverview();
  const { data: context } = useSchoolContext();

  if (isLoading) return <PageSkeleton />;

  if (isError || !data) {
    return (
      <Panel>
        <EmptyState
          message="error.generic"
          action={
            <button type="button" className="btn-primary" onClick={() => void refetch()}>
              {t('action.retry')}
            </button>
          }
        />
      </Panel>
    );
  }

  const greeting: MessageKey =
    data.hour < 12
      ? 'home.greeting'
      : data.hour < 17
        ? 'home.greeting_afternoon'
        : 'home.greeting_evening';

  // Every block is optional, so a role with few permissions gets a short page
  // rather than a wall of empty panels.
  const hasAnything =
    data.school ||
    data.registers ||
    data.fees ||
    data.mySections ||
    data.myChildren ||
    data.periodsToday ||
    data.myAttendance;

  return (
    <>
      <PageHeader
        title={t(greeting, { name: user?.firstName ?? '' })}
        subtitle={
          context && !context.isSchoolDay && context.nonSchoolDayReason
            ? context.nonSchoolDayReason
            : undefined
        }
      />

      <div className="grid gap-4">
        {data.school && <SchoolBlock totals={data.school} />}
        {data.registers && <RegistersBlock registers={data.registers} />}
        {data.mySections && <MySectionsBlock sections={data.mySections} />}
        {data.myChildren && <MyChildrenBlock items={data.myChildren} />}
        {data.myAttendance && <MyAttendanceBlock run={data.myAttendance} />}
        {data.periodsToday && <PeriodsBlock periods={data.periodsToday} />}
        {data.fees && <FeesBlock fees={data.fees} />}
        {data.notices && <NoticesBlock notices={data.notices} />}
        {!hasAnything && !data.notices?.length && <DriverBlock />}
      </div>
    </>
  );
}

function SchoolBlock({ totals }: { totals: NonNullable<Overview['school']> }) {
  const t = useT();
  const locale = useLocale();
  return (
    <Panel title={t('home.school.title')}>
      <StatRow>
        <StatTile label={t('home.school.students')} value={count(totals.students, locale)} />
        <StatTile label={t('home.school.sections')} value={count(totals.sections, locale)} />
        <StatTile label={t('home.school.staff')} value={count(totals.staff, locale)} />
        <StatTile label={t('home.school.grade_levels')} value={count(totals.gradeLevels, locale)} />
      </StatRow>
    </Panel>
  );
}

/**
 * Registers in and registers owed.
 *
 * On a closed day `expected` is zero and the panel says so outright, rather
 * than reporting "0 of 0" and leaving an administrator to work out whether
 * something is broken. A holiday is not a compliance problem.
 */
function RegistersBlock({ registers }: { registers: NonNullable<Overview['registers']> }) {
  const t = useT();
  const locale = useLocale();
  const outstanding = Math.max(0, registers.expected - registers.taken);

  if (registers.expected === 0) {
    return (
      <Panel title={t('home.registers.title')}>
        <EmptyState message="home.registers.none_expected" compact />
      </Panel>
    );
  }

  return (
    <Panel
      title={t('home.registers.title')}
      meta={t('home.registers.expected', { count: registers.expected })}
    >
      <StatRow>
        <StatTile
          label={t('home.registers.taken')}
          value={count(registers.taken, locale)}
          tone={outstanding === 0 ? 'jade' : 'ink'}
        />
        <StatTile
          label={t('home.registers.outstanding')}
          value={count(outstanding, locale)}
          tone={outstanding === 0 ? 'muted' : 'marigold'}
        />
        <StatTile
          label={t('home.registers.present')}
          value={count(registers.tally.present, locale)}
          tone="jade"
        />
        <StatTile
          label={t('home.registers.absent')}
          value={count(registers.tally.absentUnexplained, locale)}
          tone={registers.tally.absentUnexplained > 0 ? 'stamp' : 'muted'}
          hint={
            registers.tally.absentApproved > 0
              ? `${registers.tally.absentApproved} ${t('home.registers.approved').toLowerCase()}`
              : undefined
          }
        />
      </StatRow>
      {outstanding === 0 && (
        <PanelBody className="border-t border-rule-soft py-3">
          <p className="text-[13.5px] text-jade">{t('home.registers.all_in')}</p>
        </PanelBody>
      )}
    </Panel>
  );
}

/** A teacher's classes, with whether each register is in. */
function MySectionsBlock({ sections }: { sections: MySection[] }) {
  const t = useT();
  const locale = useLocale();

  return (
    <Panel title={t('home.my_sections.title')} meta={`${sections.length}`}>
      {sections.length === 0 ? (
        <EmptyState message="home.my_sections.empty" compact />
      ) : (
        <ul>
          {sections.map((section) => (
            <li
              key={section.sectionId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rule-soft px-4 py-3 last:border-b-0 sm:px-5"
            >
              <div className="min-w-0">
                <div className="truncate text-[14.5px] font-medium">{section.name}</div>
                <div className="font-mono text-[11px] text-ink-45">
                  {t('home.my_sections.students', { count: section.students })}
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2.5">
                {section.tally && (
                  <span className="font-mono text-[11.5px] tabular-nums text-ink-45">
                    {attendanceRateLabel(section.tally)}
                  </span>
                )}
                {section.registerTaken ? (
                  <StatusPill label={t('home.my_sections.register_taken')} tone="jade" />
                ) : (
                  <StatusPill label={t('home.my_sections.register_due')} tone="marigold" />
                )}
                <Link
                  to={`/attendance?section=${section.sectionId}`}
                  className="font-display text-[13px] font-semibold underline underline-offset-4 hover:text-marigold-deep"
                >
                  {section.registerTaken ? t('action.view') : t('home.my_sections.take')}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** A guardian's children: today, the term so far, and what is owed. */
function MyChildrenBlock({ items }: { items: MyChild[] }) {
  const t = useT();
  const locale = useLocale();

  return (
    <Panel title={t('home.children.title')}>
      {items.length === 0 ? (
        <EmptyState message="home.children.empty" compact />
      ) : (
        <ul>
          {items.map((child) => {
            const rate = attendanceRate(child.term);
            return (
              <li
                key={child.enrolmentId}
                className="border-b border-rule-soft px-4 py-3.5 last:border-b-0 sm:px-5"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[15px] font-medium">{child.fullName}</span>
                  <span className="font-mono text-[11px] text-ink-45">
                    {child.sectionName} · {child.rollNumber}
                  </span>
                  <span className="ml-auto">
                    {child.todayStatus ? (
                      <AttendancePill status={child.todayStatus} />
                    ) : (
                      <StatusPill label={t('home.children.no_register')} tone="muted" />
                    )}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                  <Metric
                    label={t('home.children.term_attendance')}
                    value={attendanceRateLabel(child.term)}
                    tone={attendanceTone(rate)}
                  />
                  {child.outstanding && (
                    <Metric
                      label={t('home.children.dues')}
                      value={
                        isZeroMoney(child.outstanding)
                          ? t('home.fees.settled')
                          : money(child.outstanding, locale)
                      }
                      tone={isZeroMoney(child.outstanding) ? 'jade' : 'stamp'}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'jade' | 'marigold' | 'stamp' | 'muted';
}) {
  const colour =
    tone === 'jade'
      ? 'text-jade'
      : tone === 'stamp'
        ? 'text-stamp'
        : tone === 'marigold'
          ? 'text-marigold-deep'
          : 'text-ink-45';
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className={`font-mono text-[13px] tabular-nums ${colour}`}>{value}</div>
    </div>
  );
}

/** A student's own attendance this term. */
function MyAttendanceBlock({ run }: { run: AttendanceRun }) {
  const t = useT();
  const locale = useLocale();
  const rate = attendanceRate(run);

  return (
    <Panel title={t('home.attendance.title')}>
      <StatRow>
        <StatTile
          label={t('page.attendance.rate')}
          value={attendanceRateLabel(run)}
          tone={attendanceTone(rate)}
        />
        <StatTile
          label={t('home.attendance.present_days')}
          value={count(run.present, locale)}
          hint={t('home.attendance.of_days', { count: run.schoolDays })}
        />
        <StatTile
          label={t('home.registers.late')}
          value={count(run.late, locale)}
          tone={run.late > 0 ? 'marigold' : 'muted'}
        />
        <StatTile
          label={t('home.registers.absent')}
          value={count(run.absentUnexplained, locale)}
          tone={run.absentUnexplained > 0 ? 'stamp' : 'muted'}
        />
      </StatRow>
    </Panel>
  );
}

function PeriodsBlock({ periods }: { periods: Period[] }) {
  const t = useT();

  return (
    <Panel title={t('home.timetable.title')} meta={`${periods.length}`}>
      {periods.length === 0 ? (
        <EmptyState message="home.timetable.empty" compact />
      ) : (
        <ul>
          {periods.map((period) => (
            <li
              key={period.id}
              className="flex items-center gap-3 border-b border-rule-soft px-4 py-2.5 last:border-b-0 sm:px-5"
            >
              <span className="w-[92px] shrink-0 font-mono text-[11.5px] tabular-nums text-ink-45">
                {period.startTime}–{period.endTime}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14.5px]">
                {period.subjectName ?? t('home.timetable.free')}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-ink-45">
                {period.sectionName}
              </span>
              {period.room && (
                <span className="hidden shrink-0 font-mono text-[11px] text-ink-45 sm:inline">
                  {period.room}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FeesBlock({ fees }: { fees: NonNullable<Overview['fees']> }) {
  const t = useT();
  const locale = useLocale();

  return (
    <Panel
      title={t('home.fees.title')}
      action={
        <Link
          to="/fees"
          className="font-display text-[13px] font-semibold underline underline-offset-4 hover:text-marigold-deep"
        >
          {t('nav.fees')}
        </Link>
      }
    >
      <StatRow>
        <StatTile label={t('home.fees.invoiced')} value={money(fees.invoiced, locale)} />
        <StatTile
          label={t('home.fees.collected')}
          value={money(fees.collected, locale)}
          tone="jade"
        />
        <StatTile
          label={t('home.fees.outstanding')}
          value={money(fees.outstanding, locale)}
          tone={isZeroMoney(fees.outstanding) ? 'muted' : 'ink'}
        />
        <StatTile
          label={t('page.fees.overdue_total')}
          value={money(fees.overdue, locale)}
          tone={fees.overdueCount > 0 ? 'stamp' : 'muted'}
          hint={
            fees.overdueCount > 0
              ? t('home.fees.overdue_count', { count: fees.overdueCount })
              : t('home.fees.overdue_none')
          }
        />
      </StatRow>
    </Panel>
  );
}

function NoticesBlock({ notices }: { notices: NoticeSummary[] }) {
  const t = useT();
  const locale = useLocale();
  const { user } = useSession();
  const timezone = user?.school.timezone ?? 'UTC';

  return (
    <Panel
      title={t('home.notices.title')}
      action={
        <Link
          to="/notices"
          className="font-display text-[13px] font-semibold underline underline-offset-4 hover:text-marigold-deep"
        >
          {t('home.notices.view_all')}
        </Link>
      }
    >
      {notices.length === 0 ? (
        <EmptyState message="home.notices.empty" compact />
      ) : (
        <ul>
          {notices.map((notice) => (
            <li
              key={notice.id}
              className="border-b border-rule-soft px-4 py-3 last:border-b-0 sm:px-5"
            >
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                {notice.isPinned && <StatusPill label={t('page.notices.pinned')} tone="marigold" />}
                {/* School-authored text: shown verbatim, never a catalogue key. */}
                <span className="text-[14.5px] font-medium">{notice.title}</span>
                {notice.audienceName && (
                  <span className="font-mono text-[10.5px] text-ink-45">
                    {notice.audienceName}
                  </span>
                )}
                {notice.publishedAt && (
                  <span className="ml-auto font-mono text-[10.5px] text-ink-45">
                    {instant(notice.publishedAt, timezone, locale)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 line-clamp-2 text-[13.5px] text-ink-70">{notice.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * A driver holds almost nothing in the matrix, on purpose — they have no
 * business reading a student record, and the way to keep it that way is to
 * grant nothing. So their overview says what it is rather than looking broken.
 */
function DriverBlock() {
  const t = useT();
  return (
    <Panel title={t('home.driver.title')}>
      <PanelBody>
        <p className="max-w-[52ch] text-[14.5px] text-ink-70">{t('home.driver.body')}</p>
      </PanelBody>
    </Panel>
  );
}

function PageSkeleton() {
  const t = useT();
  return (
    <div role="status" aria-live="polite" className="grid gap-4">
      <span className="sr-only">{t('shell.loading')}</span>
      {[0, 1].map((row) => (
        <div key={row} className="rounded-[3px] border border-ink bg-white">
          <div className="h-10 border-b-[1.5px] border-ink bg-card" />
          <div className="grid grid-cols-2 divide-x divide-rule-soft sm:grid-cols-4">
            {[0, 1, 2, 3].map((tile) => (
              <div key={tile} className="px-5 py-5">
                <div className="h-2 w-16 rounded-full bg-rule" />
                <div className="mt-2.5 h-5 w-12 rounded-[2px] bg-rule-soft" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
