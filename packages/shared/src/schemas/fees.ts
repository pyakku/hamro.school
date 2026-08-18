import { z } from 'zod';
import { idSchema, localDateSchema, moneyWireSchema } from './common.js';

/**
 * The fee ledger.
 *
 * Every amount is a `MoneyWire` — a **string** of minor units with the currency
 * and its exponent (rule 4). Not a number: `JSON.stringify` throws on a bigint,
 * and the fix everybody reaches for — `Number(amountMinor)` — is exactly the
 * bug the whole money module exists to prevent. Nothing on this wire can be
 * added with `+`.
 *
 * `OVERDUE` is not an `InvoiceStatus` in the database. It is derived here from
 * the due date and what is paid, because a stored one needs a nightly job to
 * stay true and is wrong every morning until it runs.
 */

export const invoiceStatusSchema = z.enum([
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'VOID',
]);

export const paymentMethodSchema = z.enum(['CASH', 'CHEQUE', 'BANK_TRANSFER', 'OTHER']);

export const paymentStatusSchema = z.enum(['RECORDED', 'BOUNCED', 'REVERSED']);

export const invoiceRowSchema = z.object({
  id: idSchema,
  number: z.string(),
  studentName: z.string(),
  enrolmentId: idSchema,
  sectionName: z.string(),
  termName: z.string().nullable(),
  issueDate: localDateSchema,
  dueDate: localDateSchema,
  total: moneyWireSchema,
  paid: moneyWireSchema,
  balance: moneyWireSchema,
  status: invoiceStatusSchema,
  /** Derived, not stored. True when issued, unpaid and past the due date. */
  isOverdue: z.boolean(),
  daysOverdue: z.number().int(),
});

export type InvoiceRow = z.infer<typeof invoiceRowSchema>;

export const invoiceLineSchema = z.object({
  id: idSchema,
  description: z.string(),
  quantity: z.number().int(),
  unitAmount: moneyWireSchema,
  concession: moneyWireSchema,
  lineTotal: moneyWireSchema,
});

export const paymentRowSchema = z.object({
  id: idSchema,
  receiptNumber: z.string(),
  studentName: z.string(),
  amount: moneyWireSchema,
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  receivedOn: localDateSchema,
  status: paymentStatusSchema,
  /**
   * Set when this row reverses another. Money is never deleted — a correction
   * is a reversing entry, and both rows stay on the ledger (rule 10).
   */
  reversesPaymentId: idSchema.nullable(),
  recordedByName: z.string(),
});

export type PaymentRow = z.infer<typeof paymentRowSchema>;

export const feeSummarySchema = z.object({
  invoiced: moneyWireSchema,
  collected: moneyWireSchema,
  outstanding: moneyWireSchema,
  overdue: moneyWireSchema,
  overdueCount: z.number().int(),
  invoiceCount: z.number().int(),
});

export const invoiceQuerySchema = z.object({
  status: invoiceStatusSchema.optional(),
  /** Only what is issued, unpaid and past due. The office's working list. */
  overdueOnly: z.coerce.boolean().optional(),
  sectionId: idSchema.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
