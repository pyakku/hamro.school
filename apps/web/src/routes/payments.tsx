import type { MessageKey } from '@hamro/shared';
import { useT, useLocale } from '../lib/i18n.js';
import { usePayments } from '../lib/queries.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { DataTable, Td, Th, Tr } from '../components/DataTable.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';
import { StatusPill } from '../components/StatusPill.js';
import { date as formatDate, money } from '../lib/format.js';

const COLUMNS = '120px 1.2fr 120px 120px 110px';

/**
 * Receipts.
 *
 * Reversed payments stay on the list and are marked as such. Money is never
 * deleted — a correction is a reversing entry, and both rows remain, because a
 * ledger that quietly loses a row stops reconciling against a bank statement
 * and nobody can tell you when it started (rule 10).
 */
export default function PaymentsPage() {
  const t = useT();
  const locale = useLocale();
  const payments = usePayments();
  const rows = payments.data ?? [];

  return (
    <>
      <PageHeader title={t('nav.payments')} subtitle={t('page.fees.subtitle')} />

      <QueryState
        isLoading={payments.isLoading}
        error={payments.error}
        onRetry={() => void payments.refetch()}
      >
        <Panel title={t('nav.payments')} meta={`${rows.length}`}>
          {rows.length === 0 ? (
            <EmptyState message="page.fees.empty" />
          ) : (
            <DataTable
              columns={COLUMNS}
              label={t('nav.payments')}
              head={
                <>
                  <Th>{t('column.receipt')}</Th>
                  <Th>{t('column.name')}</Th>
                  <Th>{t('column.date')}</Th>
                  <Th numeric>{t('column.amount')}</Th>
                  <Th>{t('column.method')}</Th>
                </>
              }
            >
              {rows.map((payment) => (
                <Tr
                  key={payment.id}
                  columns={COLUMNS}
                  tone={payment.status === 'RECORDED' ? 'none' : 'stamp'}
                >
                  <Td mono>{payment.receiptNumber}</Td>
                  <Td>{payment.studentName}</Td>
                  <Td mono muted>
                    {formatDate(payment.receivedOn, locale)}
                  </Td>
                  <Td numeric>
                    <span className={payment.status === 'REVERSED' ? 'line-through' : ''}>
                      {money(payment.amount, locale)}
                    </span>
                  </Td>
                  <Td>
                    {payment.status === 'RECORDED' ? (
                      <span className="font-mono text-[11px] text-ink-45">
                        {t(`payment.method.${payment.method}` as MessageKey)}
                      </span>
                    ) : (
                      <StatusPill
                        label={t(`payment.status.${payment.status}` as MessageKey)}
                        tone="stamp"
                      />
                    )}
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
