import {
  daysBetween,
  fromLocalDate,
  type InvoiceRow,
  type LocalDate,
  type PaymentRow,
} from '@hamro/shared';
import type { TenantClient } from '../db/tenant.js';
import type { Actor } from '../policy/guard.js';
import { assertPermission, resolveOwnChildEnrolmentIds } from '../policy/guard.js';
import type { CurrentYear } from '../school/service.js';
import { dateWire, fullName, moneyWire, type SchoolMoneyConfig } from '../lib/wire.js';

/**
 * The fee ledger, read side.
 *
 * Every amount stays a `BigInt` until the moment it becomes a wire string. No
 * intermediate is ever a `number`: a balance is `total - paid` in minor units,
 * and the subtraction happens in bigint arithmetic (rule 4).
 *
 * OVERDUE is computed here rather than stored. An invoice is overdue when it is
 * issued, has a balance, and its due date has passed — three facts that are all
 * already in the row, so a persisted status would only ever be a stale copy of
 * them that is wrong until the nightly job runs.
 */

/** The enrolments this reader may see invoices for, or null for all of them. */
async function invoiceScope(
  db: TenantClient,
  actor: Actor,
  academicYearId: string,
): Promise<string[] | null> {
  const scope = assertPermission(actor, 'invoice:read');
  if (scope === 'ALL') return null;
  // Only guardians hold a narrower scope in the matrix; a student has no
  // invoice permission at all, because a school bills the guardian.
  return [...(await resolveOwnChildEnrolmentIds(db, actor.userId, academicYearId))];
}

export async function listInvoices(
  db: TenantClient,
  actor: Actor,
  school: SchoolMoneyConfig,
  year: CurrentYear,
  today: LocalDate,
  options: { overdueOnly?: boolean; status?: string; sectionId?: string; search?: string; limit?: number } = {},
): Promise<InvoiceRow[]> {
  const allowed = await invoiceScope(db, actor, year.id);
  if (allowed !== null && allowed.length === 0) return [];

  const search = options.search?.trim();

  const invoices = await db.invoice.findMany({
    where: {
      academicYearId: year.id,
      ...(allowed ? { enrolmentId: { in: allowed } } : {}),
      ...(options.status ? { status: options.status as never } : {}),
      ...(options.overdueOnly
        ? {
            status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
            dueDate: { lt: fromLocalDate(today) },
          }
        : {}),
      ...(options.sectionId ? { enrolment: { sectionId: options.sectionId } } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' as const } },
              {
                enrolment: {
                  student: {
                    OR: [
                      { firstName: { contains: search, mode: 'insensitive' as const } },
                      { lastName: { contains: search, mode: 'insensitive' as const } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
    take: options.limit ?? 100,
    select: {
      id: true,
      number: true,
      enrolmentId: true,
      issueDate: true,
      dueDate: true,
      totalMinor: true,
      paidMinor: true,
      status: true,
      term: { select: { name: true } },
      enrolment: {
        select: {
          student: { select: { firstName: true, middleName: true, lastName: true } },
          section: { select: { name: true } },
          gradeLevel: { select: { name: true } },
        },
      },
    },
  });

  return invoices
    .map((invoice) => {
      const balance = invoice.totalMinor - invoice.paidMinor;
      const dueDate = dateWire(invoice.dueDate) ?? today;
      const unpaid = balance > 0n;
      const isOverdue =
        unpaid &&
        (invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID') &&
        dueDate < today;

      return {
        id: invoice.id,
        number: invoice.number,
        studentName: fullName(invoice.enrolment.student),
        enrolmentId: invoice.enrolmentId,
        sectionName: `${invoice.enrolment.gradeLevel.name} ${invoice.enrolment.section.name}`,
        termName: invoice.term?.name ?? null,
        issueDate: dateWire(invoice.issueDate) ?? today,
        dueDate,
        total: moneyWire(invoice.totalMinor, school),
        paid: moneyWire(invoice.paidMinor, school),
        balance: moneyWire(balance, school),
        status: invoice.status,
        isOverdue,
        daysOverdue: isOverdue ? daysBetween(dueDate, today) : 0,
      };
    })
    // Most overdue first: that is the order the office works the list in.
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate));
}

/**
 * Receipts.
 *
 * Reversed payments stay in the list, marked. Money is never soft-deleted — a
 * correction is a reversing row, and hiding either half of the pair is how a
 * ledger stops reconciling against a bank statement (rule 10).
 */
export async function listPayments(
  db: TenantClient,
  actor: Actor,
  school: SchoolMoneyConfig,
  year: CurrentYear,
  limit = 100,
): Promise<PaymentRow[]> {
  const scope = assertPermission(actor, 'payment:read');

  /**
   * `Payment.enrolmentId` is a plain column with no Prisma relation behind it,
   * so the student's name and the year filter cannot be joined in the query.
   * The enrolments for the year are fetched first and used for both — which is
   * two round trips rather than one, and correct, where a relation filter would
   * simply not compile.
   */
  const enrolments = await db.enrolment.findMany({
    where: {
      academicYearId: year.id,
      ...(scope === 'ALL'
        ? {}
        : { id: { in: [...(await resolveOwnChildEnrolmentIds(db, actor.userId, year.id))] } }),
    },
    select: {
      id: true,
      student: { select: { firstName: true, middleName: true, lastName: true } },
    },
  });
  if (enrolments.length === 0) return [];

  const studentOf = new Map(enrolments.map((row) => [row.id, fullName(row.student)]));

  const payments = await db.payment.findMany({
    where: { enrolmentId: { in: [...studentOf.keys()] } },
    orderBy: [{ receivedOn: 'desc' }, { receiptNumber: 'desc' }],
    take: limit,
    select: {
      id: true,
      receiptNumber: true,
      enrolmentId: true,
      amountMinor: true,
      method: true,
      reference: true,
      receivedOn: true,
      status: true,
      reversesPaymentId: true,
      recordedBy: { select: { firstName: true, lastName: true } },
    },
  });

  return payments.map((payment) => ({
    id: payment.id,
    receiptNumber: payment.receiptNumber,
    studentName: studentOf.get(payment.enrolmentId) ?? '',
    amount: moneyWire(payment.amountMinor, school),
    method: payment.method,
    reference: payment.reference,
    receivedOn: dateWire(payment.receivedOn) ?? '1970-01-01',
    status: payment.status,
    reversesPaymentId: payment.reversesPaymentId,
    recordedByName: fullName(payment.recordedBy),
  }));
}

/** The four totals, for whichever slice of the ledger this reader may see. */
export async function feeSummary(
  db: TenantClient,
  actor: Actor,
  school: SchoolMoneyConfig,
  year: CurrentYear,
  today: LocalDate,
) {
  const allowed = await invoiceScope(db, actor, year.id);

  const rows =
    allowed !== null && allowed.length === 0
      ? []
      : await db.invoice.findMany({
          where: {
            academicYearId: year.id,
            status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
            ...(allowed ? { enrolmentId: { in: allowed } } : {}),
          },
          select: { totalMinor: true, paidMinor: true, dueDate: true, status: true },
        });

  let invoiced = 0n;
  let collected = 0n;
  let overdue = 0n;
  let overdueCount = 0;

  for (const row of rows) {
    invoiced += row.totalMinor;
    collected += row.paidMinor;

    const balance = row.totalMinor - row.paidMinor;
    const dueDate = dateWire(row.dueDate) ?? today;
    if (balance > 0n && row.status !== 'PAID' && dueDate < today) {
      overdue += balance;
      overdueCount += 1;
    }
  }

  return {
    invoiced: moneyWire(invoiced, school),
    collected: moneyWire(collected, school),
    outstanding: moneyWire(invoiced - collected, school),
    overdue: moneyWire(overdue, school),
    overdueCount,
    invoiceCount: rows.length,
  };
}
