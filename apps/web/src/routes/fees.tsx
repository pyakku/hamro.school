import { useState } from 'react';
import type { MessageKey } from '@hamro/shared';
import { useT, useLocale } from '../lib/i18n.js';
import { useFeeSummary, useInvoices } from '../lib/queries.js';
import { PageHeader } from '../components/PageHeader.js';
import { Panel } from '../components/Panel.js';
import { StatRow, StatTile } from '../components/StatTile.js';
import { DataTable, Td, Th, Tr } from '../components/DataTable.js';
import { EmptyState } from '../components/EmptyState.js';
import { QueryState } from '../components/QueryState.js';
import { StatusPill } from '../components/StatusPill.js';
import { date as formatDate, isZeroMoney, money } from '../lib/format.js';

const COLUMNS = '110px 1.2fr 110px 110px 110px 110px';

/**
 * Fees and dues.
 *
 * Every amount on this page came off the wire as a string of minor units and is
 * formatted for display without ever becoming a number. Nothing here adds two
 * amounts together — the totals are the server's, computed in bigint.
 *
 * "Overdue" is derived, not stored: issued, unpaid, past its due date.
 */
export default function FeesPage() {
  const t = useT();
  const locale = useLocale();
  const [overdueOnly, setOverdueOnly] = useState(false);

  const summary = useFeeSummary();
  const invoices = useInvoices({ overdueOnly });
  const rows = invoices.data ?? [];

  return (
    <>
      <PageHeader title={t('page.fees.title')} subtitle={t('page.fees.subtitle')} />

      <div className="grid gap-4">
        <QueryState
          isLoading={summary.isLoading}
          error={summary.error}
          onRetry={() => void summary.refetch()}
        >
          {summary.data && (
            <Panel title={t('home.fees.title')}>
              <StatRow>
                <StatTile
                  label={t('home.fees.invoiced')}
                  value={money(summary.data.invoiced, locale)}
                />
                <StatTile
                  label={t('home.fees.collected')}
                  value={money(summary.data.collected, locale)}
                  tone="jade"
                />
                <StatTile
                  label={t('page.fees.outstanding_total')}
                  value={money(summary.data.outstanding, locale)}
                  tone={isZeroMoney(summary.data.outstanding) ? 'muted' : 'ink'}
                />
                <StatTile
                  label={t('page.fees.overdue_total')}
                  value={money(summary.data.overdue, locale)}
                  tone={summary.data.overdueCount > 0 ? 'stamp' : 'muted'}
                  hint={
                    summary.data.overdueCount > 0
                      ? t('home.fees.overdue_count', { count: summary.data.overdueCount })
                      : t('home.fees.overdue_none')
                  }
                />
              </StatRow>
            </Panel>
          )}
        </QueryState>

        <QueryState
          isLoading={invoices.isLoading}
          error={invoices.error}
          onRetry={() => void invoices.refetch()}
        >
          <Panel
            title={t('column.invoice')}
            meta={`${rows.length}`}
            action={
              <button
                type="button"
                onClick={() => setOverdueOnly((value) => !value)}
                aria-pressed={overdueOnly}
                className={`rounded-[3px] border px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] uppercase ${
                  overdueOnly
                    ? 'border-stamp bg-stamp/10 text-stamp'
                    : 'border-rule text-ink-70 hover:border-ink'
                }`}
              >
                {t('page.fees.overdue_total')}
              </button>
            }
          >
            {rows.length === 0 ? (
              <EmptyState message="page.fees.empty" />
            ) : (
              <DataTable
                columns={COLUMNS}
                label={t('page.fees.title')}
                head={
                  <>
                    <Th>{t('column.invoice')}</Th>
                    <Th>{t('column.name')}</Th>
                    <Th>{t('column.due')}</Th>
                    <Th numeric>{t('column.amount')}</Th>
                    <Th numeric>{t('column.paid')}</Th>
                    <Th numeric>{t('column.balance')}</Th>
                  </>
                }
              >
                {rows.map((invoice) => (
                  <Tr
                    key={invoice.id}
                    columns={COLUMNS}
                    tone={invoice.isOverdue ? 'stamp' : invoice.status === 'PAID' ? 'jade' : 'none'}
                  >
                    <Td mono>{invoice.number}</Td>
                    <Td>
                      <span className="block truncate">{invoice.studentName}</span>
                      <span className="block truncate font-mono text-[10.5px] text-ink-45">
                        {invoice.sectionName}
                      </span>
                    </Td>
                    <Td mono muted>
                      {formatDate(invoice.dueDate, locale)}
                      {invoice.isOverdue && (
                        <span className="block text-[10px] text-stamp">
                          {t('page.fees.days_overdue', { count: invoice.daysOverdue })}
                        </span>
                      )}
                    </Td>
                    <Td numeric>{money(invoice.total, locale)}</Td>
                    <Td numeric muted>
                      {money(invoice.paid, locale)}
                    </Td>
                    <Td numeric>
                      {isZeroMoney(invoice.balance) ? (
                        <StatusPill
                          label={t(`invoice.status.${invoice.status}` as MessageKey)}
                          tone="jade"
                        />
                      ) : (
                        <span className={invoice.isOverdue ? 'text-stamp' : ''}>
                          {money(invoice.balance, locale)}
                        </span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </DataTable>
            )}
          </Panel>
        </QueryState>
      </div>
    </>
  );
}
