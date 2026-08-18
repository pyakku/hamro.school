import { useState, type FormEvent, type ReactNode } from 'react';
import type { GradeLevelRow, HolidayRow, MessageKey, SectionRow, SubjectRow } from '@hamro/shared';
import { useT, useLocale } from '../lib/i18n.js';
import {
  useCreateGradeLevel,
  useCreateHoliday,
  useCreateSection,
  useCreateSubject,
  useDeleteGradeLevel,
  useDeleteHoliday,
  useDeleteSection,
  useDeleteSubject,
  useSchoolContext,
  useSetup,
  useUpdateSection,
} from '../lib/queries.js';
import { ApiRequestError } from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';
import { StatusPill } from '../components/StatusPill.js';
import { Toast } from '../components/Toast.js';
import { date as formatDate } from '../lib/format.js';

/**
 * School setup — the shape of a year.
 *
 * Four panels in the order a school actually fills them in: grade levels, then
 * the classes inside them, then subjects, then the calendar. Each add form sits
 * inside its own panel rather than behind a modal, because setting up a school
 * is twenty small entries in a row and a dialog that opens and closes twenty
 * times is twenty interruptions.
 *
 * Removal is a plain "Remove" that either works or explains itself. The server
 * refuses anything still in use, so the failure a user sees is a sentence about
 * enrolments rather than a foreign key error.
 */
export default function SetupPage() {
  const t = useT();
  const setup = useSetup();
  const [toast, setToast] = useState<{ kicker: string; detail: string; tone: 'ink' | 'stamp' } | null>(
    null,
  );

  const notify = (kicker: string, detail: string, tone: 'ink' | 'stamp' = 'ink') =>
    setToast({ kicker, detail, tone });

  /** Every write reports the same way: the server's sentence, or a confirmation. */
  const report = (label: string) => ({
    ok: () => notify(label, t('page.setup.subtitle')),
    fail: (error: unknown) =>
      notify(
        t('error.generic'),
        error instanceof ApiRequestError ? t(error.key as MessageKey) : t('error.generic'),
        'stamp',
      ),
  });

  return (
    <>
      <PageHeader title={t('page.setup.title')} subtitle={t('page.setup.subtitle')} />

      <QueryState isLoading={setup.isLoading} error={setup.error} onRetry={() => void setup.refetch()}>
        {setup.data && (
          <div className="grid gap-4">
            <GradeLevels grades={setup.data.gradeLevels} report={report} />
            <Sections
              sections={setup.data.sections}
              grades={setup.data.gradeLevels}
              teachers={setup.data.teachers}
              report={report}
            />
            <Subjects subjects={setup.data.subjects} report={report} />
            <Holidays holidays={setup.data.holidays} report={report} />
          </div>
        )}
      </QueryState>

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

type Report = (label: string) => { ok: () => void; fail: (error: unknown) => void };

// ── Grade levels ────────────────────────────────────────────────────────────

function GradeLevels({ grades, report }: { grades: GradeLevelRow[]; report: Report }) {
  const t = useT();
  const create = useCreateGradeLevel();
  const remove = useDeleteGradeLevel();

  const [name, setName] = useState('');
  // Suggested, not imposed: one past the highest, which is what a school
  // filling this in from the top down is about to type anyway.
  const nextLevel = grades.length > 0 ? Math.max(...grades.map((g) => g.level)) + 1 : 1;
  const [level, setLevel] = useState(String(nextLevel));

  async function add(event: FormEvent) {
    event.preventDefault();
    const done = report(t('setup.added'));
    try {
      await create.mutateAsync({ name: name.trim(), level: Number(level) });
      setName('');
      setLevel(String(Number(level) + 1));
      done.ok();
    } catch (error) {
      done.fail(error);
    }
  }

  return (
    <Panel title={t('page.setup.grades')} meta={`${grades.length}`}>
      {grades.length === 0 ? (
        <EmptyState message="page.setup.grades.empty" compact />
      ) : (
        <ul>
          {grades.map((grade) => (
            <Row
              key={grade.id}
              title={grade.name}
              meta={`${grade.sections} · ${grade.students}`}
              // A grade with children in it cannot be removed, and saying so
              // before the click is kinder than a 409 after it.
              locked={grade.students > 0 || grade.sections > 0}
              lockedHint={t('setup.in_use_hint', { count: grade.students })}
              onRemove={async () => {
                const done = report(t('setup.removed'));
                try {
                  await remove.mutateAsync(grade.id);
                  done.ok();
                } catch (error) {
                  done.fail(error);
                }
              }}
            />
          ))}
        </ul>
      )}

      <form className="flex flex-wrap items-end gap-2 border-t border-rule bg-card px-4 py-3 sm:px-5" onSubmit={add}>
        <label className="min-w-[180px] flex-1">
          <span className="field-label mb-1 block">{t('page.setup.grades.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="w-[110px]">
          <span className="field-label mb-1 block">{t('page.setup.grades.level')}</span>
          <input
            className="input font-mono"
            type="number"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn-primary" disabled={create.isPending || !name.trim()}>
          {create.isPending ? t('action.adding') : t('action.add')}
        </button>
        <p className="w-full font-mono text-[10.5px] text-ink-45">
          {t('page.setup.grades.level_help')}
        </p>
      </form>
    </Panel>
  );
}

// ── Sections ────────────────────────────────────────────────────────────────

function Sections({
  sections,
  grades,
  teachers,
  report,
}: {
  sections: SectionRow[];
  grades: GradeLevelRow[];
  teachers: { id: string; fullName: string }[];
  report: Report;
}) {
  const t = useT();
  const create = useCreateSection();
  const update = useUpdateSection();
  const remove = useDeleteSection();

  const [gradeLevelId, setGradeLevelId] = useState('');
  const [name, setName] = useState('');

  async function add(event: FormEvent) {
    event.preventDefault();
    const done = report(t('setup.added'));
    try {
      await create.mutateAsync({ gradeLevelId: gradeLevelId || grades[0]!.id, name: name.trim() });
      setName('');
      done.ok();
    } catch (error) {
      done.fail(error);
    }
  }

  return (
    <Panel title={t('page.setup.sections')} meta={`${sections.length}`}>
      {sections.length === 0 ? (
        <EmptyState message="page.setup.sections.empty" compact />
      ) : (
        <ul>
          {sections.map((section) => (
            <li
              key={section.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule-soft px-4 py-2.5 last:border-b-0 sm:px-5"
            >
              <span className="min-w-[120px] text-[14.5px] font-medium">
                {section.gradeLevelName} {section.name}
              </span>
              <span className="font-mono text-[11px] text-ink-45">{section.students}</span>

              {/* The class teacher is the one field worth changing inline: it
                  changes hands mid-year more often than anything else here. */}
              <select
                className="input h-8 w-[190px] py-0 text-[13px]"
                value={section.classTeacherId ?? ''}
                onChange={async (event) => {
                  const done = report(t('setup.saved'));
                  try {
                    await update.mutateAsync({
                      id: section.id,
                      classTeacherId: event.target.value || null,
                    });
                    done.ok();
                  } catch (error) {
                    done.fail(error);
                  }
                }}
              >
                <option value="">{t('page.setup.sections.no_teacher')}</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.fullName}
                  </option>
                ))}
              </select>

              <RemoveButton
                locked={section.students > 0}
                lockedHint={t('setup.in_use_hint', { count: section.students })}
                onRemove={async () => {
                  const done = report(t('setup.removed'));
                  try {
                    await remove.mutateAsync(section.id);
                    done.ok();
                  } catch (error) {
                    done.fail(error);
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <form className="flex flex-wrap items-end gap-2 border-t border-rule bg-card px-4 py-3 sm:px-5" onSubmit={add}>
        <label className="w-[180px]">
          <span className="field-label mb-1 block">{t('page.setup.sections.grade')}</span>
          <select
            className="input"
            value={gradeLevelId}
            onChange={(e) => setGradeLevelId(e.target.value)}
          >
            {grades.map((grade) => (
              <option key={grade.id} value={grade.id}>
                {grade.name}
              </option>
            ))}
          </select>
        </label>
        <label className="w-[140px]">
          <span className="field-label mb-1 block">{t('page.setup.sections.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button
          type="submit"
          className="btn-primary"
          disabled={create.isPending || !name.trim() || grades.length === 0}
        >
          {create.isPending ? t('action.adding') : t('action.add')}
        </button>
        <p className="w-full font-mono text-[10.5px] text-ink-45">
          {t('page.setup.sections.per_year')}
        </p>
      </form>
    </Panel>
  );
}

// ── Subjects ────────────────────────────────────────────────────────────────

function Subjects({ subjects, report }: { subjects: SubjectRow[]; report: Report }) {
  const t = useT();
  const create = useCreateSubject();
  const remove = useDeleteSubject();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  async function add(event: FormEvent) {
    event.preventDefault();
    const done = report(t('setup.added'));
    try {
      await create.mutateAsync({ code: code.trim(), name: name.trim(), isExaminable: true });
      setCode('');
      setName('');
      done.ok();
    } catch (error) {
      done.fail(error);
    }
  }

  return (
    <Panel title={t('page.setup.subjects')} meta={`${subjects.length}`}>
      {subjects.length === 0 ? (
        <EmptyState message="page.setup.subjects.empty" compact />
      ) : (
        <ul>
          {subjects.map((subject) => (
            <li
              key={subject.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule-soft px-4 py-2.5 last:border-b-0 sm:px-5"
            >
              <span className="w-[64px] shrink-0 font-mono text-[11.5px] text-ink-45">
                {subject.code}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14.5px]">{subject.name}</span>
              {!subject.isExaminable && (
                <StatusPill label={t('page.setup.subjects.not_examinable')} tone="muted" />
              )}
              <span className="font-mono text-[10.5px] text-ink-45">
                {subject.offeredTo.length > 0
                  ? subject.offeredTo.join(', ')
                  : t('page.setup.subjects.offered_none')}
              </span>
              <RemoveButton
                locked={subject.offeredTo.length > 0}
                lockedHint={t('page.setup.subjects.offered_to')}
                onRemove={async () => {
                  const done = report(t('setup.removed'));
                  try {
                    await remove.mutateAsync(subject.id);
                    done.ok();
                  } catch (error) {
                    done.fail(error);
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <form className="flex flex-wrap items-end gap-2 border-t border-rule bg-card px-4 py-3 sm:px-5" onSubmit={add}>
        <label className="w-[110px]">
          <span className="field-label mb-1 block">{t('page.setup.subjects.code')}</span>
          <input
            className="input font-mono uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
        <label className="min-w-[180px] flex-1">
          <span className="field-label mb-1 block">{t('page.setup.subjects.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button
          type="submit"
          className="btn-primary"
          disabled={create.isPending || !code.trim() || !name.trim()}
        >
          {create.isPending ? t('action.adding') : t('action.add')}
        </button>
      </form>
    </Panel>
  );
}

// ── Holidays ────────────────────────────────────────────────────────────────

function Holidays({ holidays, report }: { holidays: HolidayRow[]; report: Report }) {
  const t = useT();
  const locale = useLocale();
  const { data: context } = useSchoolContext();
  const create = useCreateHoliday();
  const remove = useDeleteHoliday();

  const [name, setName] = useState('');
  const [from, setFrom] = useState(context?.today ?? '');
  const [to, setTo] = useState(context?.today ?? '');

  async function add(event: FormEvent) {
    event.preventDefault();
    const done = report(t('setup.added'));
    try {
      await create.mutateAsync({ name: name.trim(), startDate: from, endDate: to || from });
      setName('');
      done.ok();
    } catch (error) {
      done.fail(error);
    }
  }

  return (
    <Panel title={t('page.setup.holidays')} meta={`${holidays.length}`}>
      {holidays.length === 0 ? (
        <EmptyState message="page.setup.holidays.empty" compact />
      ) : (
        <ul>
          {holidays.map((holiday) => (
            <li
              key={holiday.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule-soft px-4 py-2.5 last:border-b-0 sm:px-5"
            >
              <span className="min-w-0 flex-1 truncate text-[14.5px]">{holiday.name}</span>
              <span className="font-mono text-[11.5px] tabular-nums text-ink-45">
                {formatDate(holiday.startDate, locale)}
                {holiday.endDate !== holiday.startDate && ` – ${formatDate(holiday.endDate, locale)}`}
              </span>
              <StatusPill label={t('page.setup.holidays.days', { count: holiday.days })} tone="muted" />
              <RemoveButton
                onRemove={async () => {
                  const done = report(t('setup.removed'));
                  try {
                    await remove.mutateAsync(holiday.id);
                    done.ok();
                  } catch (error) {
                    done.fail(error);
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <form className="flex flex-wrap items-end gap-2 border-t border-rule bg-card px-4 py-3 sm:px-5" onSubmit={add}>
        <label className="min-w-[160px] flex-1">
          <span className="field-label mb-1 block">{t('page.setup.holidays.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="w-[150px]">
          <span className="field-label mb-1 block">{t('page.setup.holidays.from')}</span>
          <input
            className="input font-mono"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            required
          />
        </label>
        <label className="w-[150px]">
          <span className="field-label mb-1 block">{t('page.setup.holidays.to')}</span>
          <input
            className="input font-mono"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={create.isPending || !name.trim() || !from}>
          {create.isPending ? t('action.adding') : t('action.add')}
        </button>
        <p className="w-full font-mono text-[10.5px] text-ink-45">{t('page.setup.holidays.note')}</p>
      </form>
    </Panel>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function Row({
  title,
  meta,
  locked,
  lockedHint,
  onRemove,
}: {
  title: string;
  meta?: ReactNode;
  locked?: boolean;
  lockedHint?: string;
  onRemove: () => Promise<void>;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule-soft px-4 py-2.5 last:border-b-0 sm:px-5">
      <span className="min-w-0 flex-1 truncate text-[14.5px]">{title}</span>
      {meta && <span className="font-mono text-[11px] text-ink-45">{meta}</span>}
      <RemoveButton locked={locked} lockedHint={lockedHint} onRemove={onRemove} />
    </li>
  );
}

/**
 * Removal, said plainly.
 *
 * Disabled when something depends on the row — the server would refuse anyway,
 * and a button that explains itself before the click beats an error after it.
 * The title carries the reason, so it is not colour or absence alone.
 */
function RemoveButton({
  locked,
  lockedHint,
  onRemove,
}: {
  locked?: boolean;
  lockedHint?: string;
  onRemove: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={locked || busy}
      title={locked ? lockedHint : undefined}
      onClick={async () => {
        setBusy(true);
        try {
          await onRemove();
        } finally {
          setBusy(false);
        }
      }}
      className={`font-mono text-[10.5px] tracking-[0.1em] uppercase underline underline-offset-4 ${
        locked ? 'cursor-not-allowed text-ink-20' : 'text-ink-45 hover:text-stamp'
      }`}
    >
      {t('action.remove')}
    </button>
  );
}
