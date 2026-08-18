import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  addDays,
  type AttendanceStatusWire,
  type MessageKey,
  type Register,
  type SectionAttendance,
} from '@hamro/shared';
import { useT, useLocale } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import {
  useAttendanceSections,
  useRegister,
  useSaveRegister,
  useSchoolContext,
} from '../lib/queries.js';
import { ApiRequestError } from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';
import { StatusPill } from '../components/StatusPill.js';
import { AttendanceLegend, AttendanceSegmented } from '../components/SegmentedControl.js';
import { Toast, UnsavedStamp } from '../components/Toast.js';
import { attendanceRateLabel, dateShort } from '../lib/format.js';

type Marks = Record<string, { status: AttendanceStatusWire; minutesLate?: number | null }>;

/**
 * The register — the screen the design system says to get right.
 *
 * **Everyone starts present. You only tap the absentees.** In a class of 45
 * that is typically three taps rather than 45, and it is the whole reason this
 * is faster than the paper register it has to replace. If it is not faster, the
 * school goes back to paper and the account is lost.
 *
 * The exception-first *interface* does not imply exception-only *storage*: the
 * client sends a status for every child, because "no record" has to keep
 * meaning "no register was taken" (rule 6).
 *
 * The tally updates live, the save bar sticks to the foot of the panel, and the
 * unsaved stamp appears the moment anything changes.
 */
export default function AttendancePage() {
  const t = useT();
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const { can } = useSession();
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
    return (
      list.find((section) => !section.registerTakenToday)?.sectionId ?? list[0]?.sectionId ?? null
    );
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

            <QueryState
              isLoading={register.isLoading}
              error={register.error}
              onRetry={() => void register.refetch()}
            >
              {register.data && effectiveDate && (
                <RegisterPanel
                  // Remounts on a change of class or day, so no half-edited
                  // register can survive into a different one.
                  key={`${activeSection}-${effectiveDate}`}
                  register={register.data}
                  date={effectiveDate}
                  canWrite={can('attendance:write')}
                  canAmend={can('attendance:amend')}
                  locale={locale}
                  onPrevious={() => setDate(addDays(effectiveDate, -1))}
                  onNext={() => setDate(addDays(effectiveDate, 1))}
                  onToday={() => setDate(context?.today ?? null)}
                />
              )}
            </QueryState>
          </div>
        )}
      </QueryState>
    </>
  );
}

function RegisterPanel({
  register,
  date,
  canWrite,
  canAmend,
  locale,
  onPrevious,
  onNext,
  onToday,
}: {
  register: Register;
  date: string;
  canWrite: boolean;
  canAmend: boolean;
  locale: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const t = useT();
  const save = useSaveRegister();

  /**
   * Everyone starts present.
   *
   * On a day already taken this seeds from what was recorded; on a fresh day
   * every child starts PRESENT, which is the default the whole interaction is
   * built on.
   */
  const initial = useMemo<Marks>(() => {
    const marks: Marks = {};
    for (const row of register.rows) {
      marks[row.enrolmentId] = { status: row.status, minutesLate: row.minutesLate };
    }
    return marks;
  }, [register.rows]);

  const [marks, setMarks] = useState<Marks>(initial);
  const [amendReason, setAmendReason] = useState('');
  const [toast, setToast] = useState<{ kicker: string; detail: string; tone: 'ink' | 'stamp' } | null>(
    null,
  );

  useEffect(() => setMarks(initial), [initial]);

  const dirty = useMemo(
    () =>
      Object.entries(marks).some(
        ([id, mark]) =>
          mark.status !== initial[id]?.status || mark.minutesLate !== initial[id]?.minutesLate,
      ),
    [marks, initial],
  );

  const tally = useMemo(() => {
    const counts = { present: 0, absentUnexplained: 0, absentApproved: 0, late: 0, total: 0 };
    for (const mark of Object.values(marks)) {
      counts.total += 1;
      if (mark.status === 'PRESENT') counts.present += 1;
      else if (mark.status === 'ABSENT_UNEXPLAINED') counts.absentUnexplained += 1;
      else if (mark.status === 'ABSENT_APPROVED') counts.absentApproved += 1;
      else counts.late += 1;
    }
    return counts;
  }, [marks]);

  // A closed day: no records exist and none should. Nobody is absent.
  if (!register.isSchoolDay) {
    return (
      <Panel
        title={register.sectionName}
        meta={dateShort(date, locale)}
        action={<DayNav onPrevious={onPrevious} onNext={onNext} onToday={onToday} />}
      >
        <div className="px-5 py-10 text-center">
          <p className="mx-auto max-w-[44ch] text-[14.5px] text-ink-70">
            {t('page.attendance.closed', { reason: register.nonSchoolDayReason ?? '' })}
          </p>
        </div>
      </Panel>
    );
  }

  // Nothing recorded and no permission to record it.
  if (register.rows.length === 0 && !canWrite) {
    return (
      <Panel
        title={register.sectionName}
        meta={dateShort(date, locale)}
        action={<DayNav onPrevious={onPrevious} onNext={onNext} onToday={onToday} />}
      >
        <EmptyState message="page.attendance.not_taken" />
      </Panel>
    );
  }

  const rows = register.rows;
  const editable = canWrite;

  async function onSave() {
    try {
      const result = await save.mutateAsync({
        sectionId: register.sectionId,
        date,
        entries: rows.map((row) => ({
          enrolmentId: row.enrolmentId,
          status: marks[row.enrolmentId]?.status ?? 'PRESENT',
          minutesLate: marks[row.enrolmentId]?.minutesLate ?? null,
        })),
        ...(amendReason.trim() ? { amendReason: amendReason.trim() } : {}),
      });

      setToast({
        kicker: t('attendance.saved'),
        // Says what happened and its consequence, per the design system.
        detail:
          result.absentees > 0
            ? t('attendance.saved_notify', { count: result.absentees })
            : t('attendance.saved_detail', {
                present: tally.present,
                absent: tally.absentUnexplained,
                late: tally.late,
              }),
        tone: 'ink',
      });
      setAmendReason('');
    } catch (error) {
      setToast({
        kicker: t('error.generic'),
        detail:
          error instanceof ApiRequestError ? t(error.key as MessageKey) : t('error.generic'),
        tone: 'stamp',
      });
    }
  }

  return (
    <>
      <Panel
        title={register.sectionName}
        meta={dateShort(date, locale)}
        action={
          <div className="flex items-center gap-2">
            {dirty && <UnsavedStamp label={t('attendance.unsaved')} />}
            <DayNav onPrevious={onPrevious} onNext={onNext} onToday={onToday} />
          </div>
        }
        footer={
          rows.length > 0 ? (
            <SaveBar
              tally={tally}
              dirty={dirty}
              editable={editable}
              saving={save.isPending}
              onSave={() => void onSave()}
              onAllPresent={() =>
                setMarks(
                  Object.fromEntries(
                    rows.map((row) => [row.enrolmentId, { status: 'PRESENT' as const }]),
                  ),
                )
              }
            />
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <EmptyState message="page.attendance.not_taken" />
        ) : (
          <>
            {editable && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule-soft px-4 py-2.5 sm:px-5">
                {!register.sessionId && (
                  <p className="text-[13px] text-ink-45">{t('attendance.tap_hint')}</p>
                )}
                {/* Always on, not only on a blank register: the letters need
                    explaining whenever they can be tapped. */}
                <span className="ml-auto">
                  <AttendanceLegend />
                </span>
              </div>
            )}

            <ul>
              {rows.map((row) => {
                const mark = marks[row.enrolmentId]?.status ?? 'PRESENT';
                return (
                  <li
                    key={row.enrolmentId}
                    className={`flex items-center gap-3 border-b border-rule-soft px-4 py-2 last:border-b-0 sm:px-5 ${
                      mark === 'ABSENT_UNEXPLAINED'
                        ? 'bg-stamp/6'
                        : mark === 'LATE'
                          ? 'bg-marigold/8'
                          : ''
                    }`}
                  >
                    <span className="w-8 shrink-0 font-mono text-[12.5px] tabular-nums text-ink-45">
                      {row.rollNumber}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14.5px]">{row.fullName}</span>

                    {editable ? (
                      <AttendanceSegmented
                        value={mark}
                        label={row.fullName}
                        onChange={(status) =>
                          setMarks((current) => ({
                            ...current,
                            [row.enrolmentId]: {
                              status,
                              minutesLate:
                                status === 'LATE' ? (current[row.enrolmentId]?.minutesLate ?? null) : null,
                            },
                          }))
                        }
                      />
                    ) : (
                      <StatusPill
                        label={t(`attendance.status.${mark}` as MessageKey)}
                        tone={
                          mark === 'PRESENT'
                            ? 'jade'
                            : mark === 'LATE'
                              ? 'marigold'
                              : mark === 'ABSENT_UNEXPLAINED'
                                ? 'stamp'
                                : 'muted'
                        }
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Amending a locked day is recorded, so the reason is asked for
                here rather than assumed. */}
            {editable && canAmend && register.submittedAt && dirty && (
              <div className="border-t border-rule bg-card px-4 py-3 sm:px-5">
                <label className="block">
                  <span className="field-label mb-1.5 block">{t('attendance.amend_reason')}</span>
                  <input
                    className="input"
                    value={amendReason}
                    placeholder={t('attendance.amend_placeholder')}
                    onChange={(event) => setAmendReason(event.target.value)}
                  />
                </label>
              </div>
            )}
          </>
        )}
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

/** The sticky action bar: the running tally, and the primary action. */
function SaveBar({
  tally,
  dirty,
  editable,
  saving,
  onSave,
  onAllPresent,
}: {
  tally: { present: number; absentUnexplained: number; absentApproved: number; late: number };
  dirty: boolean;
  editable: boolean;
  saving: boolean;
  onSave: () => void;
  onAllPresent: () => void;
}) {
  const t = useT();
  const counted = tally.present + tally.absentUnexplained + tally.late;
  const rate = counted > 0 ? Math.round(((tally.present + tally.late) / counted) * 100) : null;

  return (
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

      {editable && (
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onAllPresent}
            className="font-mono text-[10.5px] tracking-[0.1em] text-ink-45 uppercase underline underline-offset-4 hover:text-ink"
          >
            {t('attendance.all_present')}
          </button>
          <button type="button" className="btn-primary" disabled={!dirty || saving} onClick={onSave}>
            {saving ? t('attendance.saving') : t('attendance.save')}
          </button>
        </div>
      )}
      {!editable && rate !== null && (
        <span className="ml-auto font-mono text-[13px] tabular-nums text-ink-70">{rate}%</span>
      )}
    </div>
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
      <DayButton label={t('action.previous_day')} glyph="‹" onClick={onPrevious} />
      <button
        type="button"
        onClick={onToday}
        className="rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-ink-70 uppercase hover:border-ink"
      >
        {t('action.today')}
      </button>
      <DayButton label={t('action.next_day')} glyph="›" onClick={onNext} />
    </div>
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
                isActive ? 'border-ink bg-ink text-paper' : 'border-rule bg-white hover:border-ink',
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
              {/* Marigold means pending: this class still owes a register. */}
              {!section.registerTakenToday && !isActive && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-marigold"
                  aria-label={t('home.my_sections.register_due')}
                />
              )}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
