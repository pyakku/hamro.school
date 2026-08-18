import { useDeferredValue, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useStudents } from '../lib/queries.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { DataTable, Td, Th, Tr } from '../components/DataTable.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';

/**
 * The roster for the current year.
 *
 * "Students" here means enrolments: the grade, section and roll number belong
 * to the year, not to the child. A teacher sees their own sections and the
 * office sees everyone, decided by the server rather than by this table.
 */
export default function StudentsPage() {
  const t = useT();
  const { can } = useSession();
  const [search, setSearch] = useState('');

  // The typed value leads, the query follows — so the field never feels like it
  // is waiting for the network.
  const deferred = useDeferredValue(search);
  const students = useStudents({ search: deferred.trim() || undefined });

  const showGuardians = can('guardian:read');
  const columns = showGuardians ? '56px 1.4fr 110px 1.2fr 130px' : '56px 1.4fr 110px 1fr';

  const rows = students.data ?? [];

  return (
    <>
      <PageHeader
        title={t('page.students.title')}
        subtitle={t('page.students.subtitle')}
        actions={
          <label className="block">
            <span className="sr-only">{t('page.students.search')}</span>
            <input
              type="search"
              className="input w-[240px]"
              placeholder={t('page.students.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        }
      />

      <QueryState
        isLoading={students.isLoading}
        error={students.error}
        onRetry={() => void students.refetch()}
      >
        <Panel
          title={t('page.students.title')}
          meta={t('page.students.count', { count: rows.length })}
        >
          {rows.length === 0 ? (
            <EmptyState
              message={deferred.trim() ? 'page.students.no_match' : 'page.students.empty'}
              values={{ query: deferred.trim() }}
            />
          ) : (
            <DataTable
              columns={columns}
              label={t('page.students.title')}
              head={
                <>
                  <Th numeric>{t('column.roll')}</Th>
                  <Th>{t('column.name')}</Th>
                  <Th>{t('column.section')}</Th>
                  <Th>{showGuardians ? t('column.guardian') : t('column.status')}</Th>
                  {showGuardians && <Th>{t('column.contact')}</Th>}
                </>
              }
            >
              {rows.map((student) => (
                <Tr key={student.enrolmentId} columns={columns}>
                  <Td numeric>{student.rollNumber}</Td>
                  <Td>{student.fullName}</Td>
                  <Td mono>{student.sectionName}</Td>
                  {showGuardians ? (
                    <>
                      <Td muted>{student.primaryGuardianName ?? '—'}</Td>
                      <Td mono muted>
                        {student.primaryGuardianPhone ?? '—'}
                      </Td>
                    </>
                  ) : (
                    <Td mono muted>
                      {student.admissionNumber}
                    </Td>
                  )}
                </Tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </QueryState>
    </>
  );
}
