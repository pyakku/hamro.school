import { currency as makeCurrency, money, toWire, type MoneyWire } from '@hamro/shared';
import { toLocalDate, type LocalDate } from '@hamro/shared';

/**
 * Turning database values into wire values, in one place.
 *
 * Three conversions the rest of the API is not allowed to improvise, because
 * each has an obvious wrong version that works on the developer's machine:
 *
 *   · money — a `BigInt` of minor units becomes a *string*. `JSON.stringify`
 *     throws on a bigint, and the reflex fix, `Number(...)`, silently turns a
 *     ledger into floating point (rule 4).
 *   · a `@db.Date` becomes `YYYY-MM-DD` read in UTC, never the server's local
 *     day (rule 5).
 *   · a `@db.Time` becomes `HH:MM`, also read in UTC — Prisma hands a time
 *     back as an instant on 1 January 1970, and the local getters shift it.
 */

export interface SchoolMoneyConfig {
  readonly currency: string;
  readonly currencyMinorUnits: number;
}

/** A minor-unit amount from Postgres, as the wire's string form. */
export function moneyWire(amountMinor: bigint, school: SchoolMoneyConfig): MoneyWire {
  return toWire(money(amountMinor, makeCurrency(school.currency, school.currencyMinorUnits)));
}

/** Sums minor units as integers. Never `reduce((a, b) => a + b)` over numbers. */
export function sumMinor(amounts: readonly bigint[]): bigint {
  return amounts.reduce((total, amount) => total + amount, 0n);
}

/** A `@db.Date` column as `YYYY-MM-DD`, or null. */
export function dateWire(value: Date | null | undefined): LocalDate | null {
  return value ? toLocalDate(value) : null;
}

/** A `@db.Timestamptz` as an ISO instant, or null. Instants stay instants. */
export function instantWire(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * A `@db.Time` column as `HH:MM`.
 *
 * Prisma represents a bare time as a `Date` on 1970-01-01 in UTC. Reading the
 * local hours would move a 09:00 period by the server's offset — which is
 * invisible in a UTC container and wrong on a laptop.
 */
export function timeWire(value: Date): string {
  const hours = value.getUTCHours().toString().padStart(2, '0');
  const minutes = value.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** A `Decimal(7,2)` as a string, so no mark ever becomes a float. */
export function decimalWire(value: { toString(): string } | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

/** "Meera Joshi" from the parts a table stores separately. */
export function fullName(parts: {
  firstName: string;
  middleName?: string | null;
  lastName: string;
}): string {
  return [parts.firstName, parts.middleName, parts.lastName].filter(Boolean).join(' ');
}
