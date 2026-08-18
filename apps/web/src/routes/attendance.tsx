import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays, type SectionAttendance } from '@hamro/shared';
import { useT, useLocale } from '../lib/i18n.js';
import { useAttendanceSections, useRegister, useSchoolContext } from '../lib/queries.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { DataTable, Td, Th, Tr } from '../components/DataTable.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';
import { AttendancePill, StatusPill } from '../components/StatusPill.js';
import { attendanceRate, attendanceRateLabel, attendanceTone, dateShort } from '../lib/format.js';

const COLUMNS = '56px 1fr 130px 1fr';

/**
 * Registers, read.
 *
 * This is the reading half of the screen the design system calls the one to get
 * right. Taking a register — everyone present, tap the absentees, sticky save
 * bar, unsaved stamp — is the writing half, and it lands with the attendance
 * session (roadmap 3). What is here is what a school needs to *check*: who was
 * in, which registers are missing, and what a closed day looks like.
 *
 * The three states are kept visibly distinct, because a school that cannot tell
 * them apart cannot answer a parent:
 *
 *   · closed — a holiday. No records, and nobody absent.
 *   · open, no register — a teacher owes one.
 *   · a register — the rows.
 */
export default function AttendancePage() {
  const t = useT();
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const { data: context } = useSchoolContext();

  const sections = useAttendanceSections();
  const sectionParam = params.get('section');

  // Land on the class that still owes a register — the reason a teacher opened
  // this page at all.
  const activeSection = useMemo(() => {
    const list = sections.data ?? [];
    if (sectionParam && list.some((section) => section.sectionId === sectionParam)) {
      return sectionParam;
    }
    return list.find((section) => !section.registerTakenToday)?.sectionId ?? list[0]?.sectionId ?? null;
  }, [sections.data, sectionParam]);

  const [date, setDate] = useState<string | null>(null);
  const effectiveDate = date ?? context?.today ?? null;

  const register = useRegister(activeSection, effectiveDate);

  return (
    <>
      <PageHeader title={t('page.attendance.title')} subtitle={t('page.attendance.subtitle')} />

      <QueryState
        isLoading={sections.isLoading}
        error={sections.error}
        onRetry={() => void sections.refetch()}
      >
        {(sections.data ?? []).length === 0 ? (
          <Panel>
            <EmptyState message="page.attendance.empty" />
          </Panel>
        ) : (
          <div className="grid gap-4">
            <SectionPicker
              sections={sections.data ?? []}
              active={activeSection}
              onPick={(sectionId) => {
                const next = new URLSearchParams(params);
                next.set('section', sectionId);
                setParams(next, { replace: true });
              }}
            />

            <Panel
              title={register.data?.sectionName ?? t('page.attendance.title')}
              meta={effectiveDate ? dateShort(effectiveDate, locale) : undefined}
              action={
                effectiveDate && (
                  <div className="flex items-center gap-1">
                    <DayButton
                      label={t('action.previous_day')}
                      glyph="‹"
                      onClick={() => setDate(addDays(effectiveDate, -1))}
                    />
                    <button
                      type="button"
                      onClick={() => setDate(context?.today ?? null)}
                      className="rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-ink-70 uppercase hover:border-ink"
                    >
                      {t('action.today')}
                    </button>
                    <DayButton
                      label={t('action.next_day')}
                      glyph="›"
                      onClick={() => setDate(addDays(effectiveDate, 1))}
                    />
                  </div>
                )
              }
              footer={
                register.data && register.data.rows.length > 0 ? (
                  <RegisterTally rows={register.data.rows} />
                ) : undefined
              }
            >
              <QueryState
                isLoading={register.isLoading}
                error={register.error}
                onRetry={() => void register.refetch()}
              >
                <RegisterBody register={register.data} />
              </QueryState>
            </Panel>
          </div>
        )}
      </QueryState>
    </>
  );
}

function DayButton({
  label,
  glyph,
  onClick,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-[3px] border border-rule font-mono text-[13px] text-ink-70 hover:border-ink hover:text-ink"
    >
      {glyph}
    </button>
  );
}

function SectionPicker({
  sections,
  active,
  onPick,
}: {
  sections: SectionAttendance[];
  active: string | null;
  onPick: (sectionId: string) => void;
}) {
  const t = useT();

  return (
    <Panel title={t('nav.attendance')} meta={`${sections.length}`}>
      <div className="flex flex-wrap gap-2 px-4 py-3 sm:px-5">
        {sections.map((section) => {
          const isActive = section.sectionId === active;
          const rate = attendanceRateLabel({
            present: section.present,
            late: section.late,
            absentUnexplained: 0,
            absentApproved: 0,
            total: section.totalRecords,
          });

          return (
            <button
              key={section.sectionId}
              type="button"
              onClick={() => onPick(section.sectionId)}
              aria-pressed={isActive}
              className={[
                'flex min-h-[44px] items-center gap-2.5 rounded-[3px] border px-3 py-1.5 text-left transition-colors',
                isActive
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule bg-white hover:border-ink',
              ].join(' ')}
            >
              <span className="text-[14px] font-medium">{section.name}</span>
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  isActive ? 'text-paper/70' : 'text-ink-45'
                }`}
              >
                {rate}
              </span>
              {!section.registerTakenToday && !isActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-marigold" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function RegisterBody({ register }: { register: ReturnType<typeof useRegister>['data'] }) {
  const t = useT();

  if (!register) return null;

  // A closed day. No records exist, and none should — the day is out of the
  // denominator rather than a class full of absentees.
  if (!register.isSchoolDay) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="mx-auto max-w-[44ch] text-[14.5px] text-ink-70">
          {t('page.attendance.closed', { reason: register.nonSchoolDayReason ?? '' })}
        </p>
      </div>
    );
  }

  if (!register.sessionId || register.rows.length === 0) {
    return <EmptyState message="page.attendance.not_taken" />;
  }

  return (
    <DataTable
      columns={COLUMNS}
      label={register.sectionName}
      head={
        <>
          <Th numeric>{t('column.roll')}</Th>
          <Th>{t('column.name')}</Th>
          <Th>{t('column.status')}</Th>
          {/* Lateness and remarks; the column speaks for itself in the rows. */}
          <Th>{''}</Th>
        </>
      }
    >
      {register.rows.map((row) => (
        <Tr
          key={row.enrolmentId}
          columns={COLUMNS}
          tone={
            row.status === 'ABSENT_UNEXPLAINED'
              ? 'stamp'
              : row.status === 'LATE'
                ? 'marigold'
                : 'none'
          }
        >
          <Td numeric>{row.rollNumber}</Td>
          <Td>{row.fullName}</Td>
          <Td>
            <AttendancePill status={row.status} />
          </Td>
          <Td mono muted>
            {row.minutesLate ? `+${row.minutesLate}m` : (row.remark ?? '')}
          </Td>
        </Tr>
      ))}
    </DataTable>
  );
}

function RegisterTally({ rows }: { rows: NonNullable<ReturnType<typeof useRegister>['data']>['rows'] }) {
  const t = useT();

  const tally = rows.reduce(
    (totals, row) => {
      if (row.status === 'PRESENT') totals.present += 1;
      else if (row.status === 'LATE') totals.late += 1;
      else if (row.status === 'ABSENT_UNEXPLAINED') totals.absentUnexplained += 1;
      else totals.absentApproved += 1;
      totals.total += 1;
      return totals;
    },
    { present: 0, late: 0, absentUnexplained: 0, absentApproved: 0, total: 0 },
  );

  const tone = attendanceTone(attendanceRate(tally));
  const toneClass =
    tone === 'jade'
      ? 'text-jade'
      : tone === 'marigold'
        ? 'text-marigold-deep'
        : tone === 'stamp'
          ? 'text-stamp'
          : 'text-ink-45';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="font-mono text-[11.5px] tabular-nums text-ink-70">
        {t('page.attendance.summary', {
          present: tally.present,
          absent: tally.absentUnexplained,
          late: tally.late,
        })}
      </span>
      {tally.absentApproved > 0 && (
        <StatusPill
          label={`${tally.absentApproved} ${t('attendance.status.ABSENT_APPROVED')}`}
          tone="muted"
        />
      )}
      <span className={`ml-auto font-mono text-[13px] tabular-nums ${toneClass}`}>
        {attendanceRateLabel(tally)}
      </span>
    </div>
  );
}
