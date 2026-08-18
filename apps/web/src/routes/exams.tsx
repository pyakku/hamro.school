import { useEffect, useState } from 'react';
import { useT, useLocale } from '../lib/i18n.js';
import { useExamSubjects, useExams, useMarks } from '../lib/queries.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { DataTable, Td, Th, Tr } from '../components/DataTable.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';
import { StatusPill } from '../components/StatusPill.js';
import { date as formatDate } from '../lib/format.js';

const MARK_COLUMNS = '56px 1fr 120px 1fr';

/**
 * Exams and marks — raw marks, and nothing else.
 *
 * No percentage, no letter, no average, no rank appears anywhere on this page,
 * because none of them is stored and none can be worked out without the
 * school's grading scale version (rule 3). A mark reads "87 out of 100": the
 * number is data, the words are a catalogue key.
 *
 * "Not entered" is shown as its own state rather than as a zero. A child who
 * has not been marked has not scored nothing.
 */
export default function ExamsPage() {
  const t = useT();
  const locale = useLocale();

  const exams = useExams();
  const [examId, setExamId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);

  // Open the most recent exam by default; a page that starts empty makes a user
  // guess at what to click.
  useEffect(() => {
    if (!examId && exams.data?.length) setExamId(exams.data[0]!.id);
  }, [exams.data, examId]);

  const subjects = useExamSubjects(examId);
  useEffect(() => {
    setSubjectId(null);
  }, [examId]);

  const marks = useMarks(subjectId);
  const activeSubject = subjects.data?.find((subject) => subject.id === subjectId);

  return (
    <>
      <PageHeader title={t('page.exams.title')} subtitle={t('page.exams.subtitle')} />

      <QueryState isLoading={exams.isLoading} error={exams.error} onRetry={() => void exams.refetch()}>
        {(exams.data ?? []).length === 0 ? (
          <Panel>
            <EmptyState message="page.exams.empty" />
          </Panel>
        ) : (
          <div className="grid gap-4">
            <Panel title={t('page.exams.title')} meta={`${exams.data?.length ?? 0}`}>
              <ul>
                {(exams.data ?? []).map((exam) => (
                  <li key={exam.id}>
                    <button
                      type="button"
                      onClick={() => setExamId(exam.id)}
                      aria-pressed={exam.id === examId}
                      className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule-soft px-4 py-3 text-left last:border-b-0 sm:px-5 ${
                        exam.id === examId ? 'bg-card' : 'hover:bg-card'
                      }`}
                    >
                      <span className="text-[14.5px] font-medium">{exam.name}</span>
                      {exam.termName && (
                        <span className="font-mono text-[10.5px] text-ink-45">{exam.termName}</span>
                      )}
                      {exam.startDate && (
                        <span className="font-mono text-[10.5px] text-ink-45">
                          {formatDate(exam.startDate, locale)}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-2">
                        <span className="font-mono text-[11px] tabular-nums text-ink-45">
                          {t('page.exams.marks_entered', {
                            entered: exam.marksEntered,
                            total: exam.marksExpected,
                          })}
                        </span>
                        {exam.resultsPublishedAt && (
                          <StatusPill label={t('mark.published')} tone="jade" />
                        )}
                        {exam.marksLockedAt && !exam.resultsPublishedAt && (
                          <StatusPill label={t('mark.locked')} tone="marigold" />
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>

            {examId && (
              <QueryState
                isLoading={subjects.isLoading}
                error={subjects.error}
                onRetry={() => void subjects.refetch()}
              >
                <Panel title={t('column.subject')} meta={`${subjects.data?.length ?? 0}`}>
                  <div className="flex flex-wrap gap-2 px-4 py-3 sm:px-5">
                    {(subjects.data ?? []).map((subject) => (
                      <button
                        key={subject.id}
                        type="button"
                        onClick={() => setSubjectId(subject.id)}
                        aria-pressed={subject.id === subjectId}
                        className={[
                          'flex min-h-[44px] items-center gap-2 rounded-[3px] border px-3 py-1.5',
                          subject.id === subjectId
                            ? 'border-ink bg-ink text-paper'
                            : 'border-rule bg-white hover:border-ink',
                        ].join(' ')}
                      >
                        <span className="text-[14px]">{subject.subjectName}</span>
                        <span
                          className={`font-mono text-[10.5px] ${
                            subject.id === subjectId ? 'text-paper/70' : 'text-ink-45'
                          }`}
                        >
                          {subject.gradeLevelName}
                        </span>
                      </button>
                    ))}
                  </div>
                </Panel>
              </QueryState>
            )}

            {subjectId && (
              <QueryState
                isLoading={marks.isLoading}
                error={marks.error}
                onRetry={() => void marks.refetch()}
              >
                <Panel
                  title={activeSubject?.subjectName ?? t('column.marks')}
                  meta={
                    activeSubject
                      ? t('page.exams.out_of', { max: activeSubject.maxMarks })
                      : undefined
                  }
                >
                  {(marks.data ?? []).length === 0 ? (
                    <EmptyState message="page.exams.no_marks" />
                  ) : (
                    <DataTable
                      columns={MARK_COLUMNS}
                      label={t('column.marks')}
                      head={
                        <>
                          <Th numeric>{t('column.roll')}</Th>
                          <Th>{t('column.name')}</Th>
                          <Th numeric>{t('column.marks')}</Th>
                          <Th>{''}</Th>
                        </>
                      }
                    >
                      {(marks.data ?? []).map((mark) => (
                        <Tr key={mark.enrolmentId} columns={MARK_COLUMNS}>
                          <Td numeric>{mark.rollNumber}</Td>
                          <Td>{mark.fullName}</Td>
                          <Td numeric>
                            {/* The raw mark, as a string, exactly as stored. */}
                            {mark.rawMarks === null ? (
                              <span className="text-ink-20">—</span>
                            ) : (
                              <>
                                {mark.rawMarks}
                                <span className="text-ink-45">/{mark.maxMarks}</span>
                              </>
                            )}
                          </Td>
                          <Td>
                            {mark.isAbsent ? (
                              <StatusPill
                                label={t('attendance.status.ABSENT_UNEXPLAINED')}
                                tone="stamp"
                              />
                            ) : mark.isExempt ? (
                              <StatusPill label={t('mark.exempt')} tone="muted" />
                            ) : mark.rawMarks === null ? (
                              <StatusPill label={t('page.exams.not_entered')} tone="muted" />
                            ) : null}
                          </Td>
                        </Tr>
                      ))}
                    </DataTable>
                  )}
                </Panel>
              </QueryState>
            )}
          </div>
        )}
      </QueryState>
    </>
  );
}
