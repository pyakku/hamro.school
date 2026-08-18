import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  type AttendanceStatusWire,
  type MessageKey,
  type StaffAttendanceDayView,
} from '@hamro/shared';
import { useT, useLocale } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useSaveStaffAttendance, useSchoolContext, useStaffAttendance } from '../lib/queries.js';
import { ApiRequestError } from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';
import { StatusPill } from '../components/StatusPill.js';
import { AttendanceLegend, AttendanceSegmented } from '../components/SegmentedControl.js';
import { Toast, UnsavedStamp } from '../components/Toast.js';
import { dateShort } from '../lib/format.js';

type Marks = Record<string, AttendanceStatusWire>;

/**
 * The staff return.
 *
 * Deliberately the same screen as a class register — same statuses, same
 * colours, same save bar — because it is the same job and a school should not
 * have to learn it twice.
 *
 * Two readers, one page. The office gets the staff room and a save bar; a
 * teacher gets their own row and no controls, because nobody marks their own
 * attendance. Which one you get is decided by what the server sent, not by a
 * role check here.
 */
export default function StaffAttendancePage() {
  const t = useT();
  const locale = useLocale();
  const { can } = useSession();
  const { data: context } = useSchoolContext();

  const [date, setDate] = useState<string | null>(null);
  const effectiveDate = date ?? context?.today ?? null;

  const day = useStaffAttendance(effectiveDate);
  const canWrite = can('staff_attendance:write');

  return (
    <>
      <PageHeader
        title={t('page.staff_attendance.title')}
        subtitle={t('page.staff_attendance.subtitle')}
      />

      <QueryState isLoading={day.isLoading} error={day.error} onRetry={() => void day.refetch()}>
        {day.data && effectiveDate && (
          <DayPanel
            key={effectiveDate}
            day={day.data}
            date={effectiveDate}
            canWrite={canWrite}
            locale={locale}
            onPrevious={() => setDate(addDays(effectiveDate, -1))}
            onNext={() => setDate(addDays(effectiveDate, 1))}
            onToday={() => setDate(context?.today ?? null)}
          />
        )}
      </QueryState>
    </>
  );
}

function DayPanel({
  day,
  date,
  canWrite,
  locale,
  onPrevious,
  onNext,
  onToday,
}: {
  day: StaffAttendanceDayView;
  date: string;
  canWrite: boolean;
  locale: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const t = useT();
  const save = useSaveStaffAttendance();

  const initial = useMemo<Marks>(
    () => Object.fromEntries(day.rows.map((row) => [row.staffId, row.status])),
    [day.rows],
  );

  const [marks, setMarks] = useState<Marks>(initial);
  const [toast, setToast] = useState<{ kicker: string; detail: string; tone: 'ink' | 'stamp' } | null>(
    null,
  );

  useEffect(() => setMarks(initial), [initial]);

  const dirty = useMemo(
    () => Object.entries(marks).some(([id, status]) => status !== initial[id]),
    [marks, initial],
  );

  const tally = useMemo(() => {
    const counts = { present: 0, absentUnexplained: 0, absentApproved: 0, late: 0 };
    for (const status of Object.values(marks)) {
      if (status === 'PRESENT') counts.present += 1;
      else if (status === 'ABSENT_UNEXPLAINED') counts.absentUnexplained += 1;
      else if (status === 'ABSENT_APPROVED') counts.absentApproved += 1;
      else counts.late += 1;
    }
    return counts;
  }, [marks]);

  const nav = <DayNav onPrevious={onPrevious} onNext={onNext} onToday={onToday} />;

  if (!day.isSchoolDay) {
    return (
      <Panel title={t('page.staff_attendance.title')} meta={dateShort(date, locale)} action={nav}>
        <div className="px-5 py-10 text-center">
          <p className="mx-auto max-w-[44ch] text-[14.5px] text-ink-70">
            {t('page.attendance.closed', { reason: day.nonSchoolDayReason ?? '' })}
          </p>
        </div>
      </Panel>
    );
  }

  if (day.rows.length === 0) {
    return (
      <Panel title={t('page.staff_attendance.title')} meta={dateShort(date, locale)} action={nav}>
        <EmptyState message="page.staff_attendance.empty" />
      </Panel>
    );
  }

  // A teacher reading their own single row: no controls, no save bar.
  const isOwnRowOnly = !canWrite;

  async function onSave() {
    try {
      const result = await save.mutateAsync({
        date,
        entries: day.rows.map((row) => ({
          staffId: row.staffId,
          status: marks[row.staffId] ?? 'PRESENT',
        })),
      });
      setToast({
        kicker: t('page.staff_attendance.saved'),
        detail: t('attendance.saved_detail', {
          present: tally.present,
          absent: tally.absentUnexplained,
          late: tally.late,
        }),
        tone: 'ink',
      });
      void result;
    } catch (error) {
      setToast({
        kicker: t('error.generic'),
        detail: error instanceof ApiRequestError ? t(error.key as MessageKey) : t('error.generic'),
        tone: 'stamp',
      });
    }
  }

  return (
    <>
      <Panel
        title={isOwnRowOnly ? t('page.staff_attendance.mine') : t('page.staff_attendance.title')}
        meta={dateShort(date, locale)}
        action={
          <div className="flex items-center gap-2">
            {dirty && <UnsavedStamp label={t('attendance.unsaved')} />}
            {nav}
          </div>
        }
        footer={
          canWrite ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
              <button
                type="button"
                className="btn-primary ml-auto"
                disabled={!dirty || save.isPending}
                onClick={() => void onSave()}
              >
                {save.isPending ? t('attendance.saving') : t('page.staff_attendance.save')}
              </button>
            </div>
          ) : undefined
        }
      >
        {canWrite && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule-soft px-4 py-2.5 sm:px-5">
            {!day.submittedAt && (
              <p className="text-[13px] text-ink-45">{t('attendance.tap_hint')}</p>
            )}
            <span className="ml-auto">
              <AttendanceLegend />
            </span>
          </div>
        )}

        <ul>
          {day.rows.map((row) => {
            const status = marks[row.staffId] ?? 'PRESENT';
            return (
              <li
                key={row.staffId}
                className={`flex items-center gap-3 border-b border-rule-soft px-4 py-2 last:border-b-0 sm:px-5 ${
                  status === 'ABSENT_UNEXPLAINED'
                    ? 'bg-stamp/6'
                    : status === 'LATE'
                      ? 'bg-marigold/8'
                      : ''
                }`}
              >
                <span className="w-[74px] shrink-0 truncate font-mono text-[11px] text-ink-45">
                  {row.employeeCode}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px]">{row.fullName}</span>
                  {row.designation && (
                    <span className="block truncate font-mono text-[10.5px] text-ink-45">
                      {row.designation}
                    </span>
                  )}
                </span>

                {row.onApprovedLeave ? (
                  // The office already approved this. Re-deciding it here is how
                  // the leave register and this one stop agreeing, so it is shown
                  // rather than offered.
                  <span title={t('page.staff_attendance.leave_locked')}>
                    <StatusPill
                      label={row.leaveType ?? t('page.staff_attendance.on_leave')}
                      tone="muted"
                    />
                  </span>
                ) : canWrite ? (
                  <AttendanceSegmented
                    value={status}
                    label={row.fullName}
                    onChange={(next) => setMarks((current) => ({ ...current, [row.staffId]: next }))}
                  />
                ) : (
                  <StatusPill
                    label={t(`attendance.status.${status}` as MessageKey)}
                    tone={
                      status === 'PRESENT'
                        ? 'jade'
                        : status === 'LATE'
                          ? 'marigold'
                          : status === 'ABSENT_UNEXPLAINED'
                            ? 'stamp'
                            : 'muted'
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      {toast && (
        <Toast
          kicker={toast.kicker}
          detail={toast.detail}
          tone={toast.tone}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  );
}

function DayNav({
  onPrevious,
  onNext,
  onToday,
}: {
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onPrevious}
        aria-label={t('action.previous_day')}
        className="flex h-7 w-7 items-center justify-center rounded-[3px] border border-rule font-mono text-[13px] text-ink-70 hover:border-ink"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={onToday}
        className="rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-ink-70 uppercase hover:border-ink"
      >
        {t('action.today')}
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label={t('action.next_day')}
        className="flex h-7 w-7 items-center justify-center rounded-[3px] border border-rule font-mono text-[13px] text-ink-70 hover:border-ink"
      >
        ›
      </button>
    </div>
  );
}
