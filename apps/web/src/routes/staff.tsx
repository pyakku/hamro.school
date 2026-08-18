import type { MessageKey } from '@hamro/shared';
import { useT } from '../lib/i18n.js';
import { useStaff } from '../lib/queries.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { DataTable, Td, Th, Tr } from '../components/DataTable.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';
import { StatusPill } from '../components/StatusPill.js';
import { joinMeta } from '../lib/format.js';

const COLUMNS = '1.2fr 110px 1fr 1fr 100px';

/**
 * The staff room.
 *
 * Roles come from `RoleAssignment`, and a person may hold several — the teacher
 * who is also a parent of a child at the school is a normal case, so the column
 * lists them all rather than picking one to display.
 */
export default function StaffPage() {
  const t = useT();
  const staff = useStaff();
  const rows = staff.data ?? [];

  return (
    <>
      <PageHeader title={t('page.staff.title')} subtitle={t('page.staff.subtitle')} />

      <QueryState isLoading={staff.isLoading} error={staff.error} onRetry={() => void staff.refetch()}>
        <Panel title={t('page.staff.title')} meta={`${rows.length}`}>
          {rows.length === 0 ? (
            <EmptyState message="page.staff.empty" />
          ) : (
            <DataTable
              columns={COLUMNS}
              label={t('page.staff.title')}
              head={
                <>
                  <Th>{t('column.name')}</Th>
                  <Th>{t('column.role')}</Th>
                  <Th>{t('column.subject')}</Th>
                  <Th>{t('column.section')}</Th>
                  <Th>{t('column.status')}</Th>
                </>
              }
            >
              {rows.map((member) => (
                <Tr key={member.id} columns={COLUMNS}>
                  <Td>
                    <span className="block truncate">{member.fullName}</span>
                    {member.designation && (
                      <span className="block truncate font-mono text-[10.5px] text-ink-45">
                        {member.designation}
                      </span>
                    )}
                  </Td>
                  <Td mono muted>
                    {member.roles.map((role) => t(`role.${role}` as MessageKey)).join(', ')}
                  </Td>
                  <Td muted>{joinMeta(...member.subjectsTaught) || '—'}</Td>
                  <Td muted>{joinMeta(...member.classTeacherOf) || '—'}</Td>
                  <Td>
                    <StatusPill
                      label={t(`staff.status.${member.status}` as MessageKey)}
                      tone={
                        member.status === 'ACTIVE'
                          ? 'jade'
                          : member.status === 'ON_LEAVE'
                            ? 'marigold'
                            : 'muted'
                      }
                    />
                  </Td>
                </Tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </QueryState>
    </>
  );
}
