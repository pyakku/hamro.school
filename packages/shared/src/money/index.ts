/**
 * Money. Integers in minor units, always.
 *
 * There is no `number` anywhere in this file's arithmetic. A JS number cannot
 * hold 0.1 + 0.2, and a fee ledger that is out by a cent is a fee ledger a
 * school will not trust. Amounts are `bigint` counts of the currency's minor
 * unit (paise, cents, fils) and the exponent comes from the school.
 *
 * Over the wire, an amount is a *string*: `JSON.stringify` throws on bigint,
 * and turning it into a number to get it across is exactly the bug this module
 * exists to prevent.
 */

/** ISO 4217 code plus its exponent — 2 for INR, 0 for JPY, 3 for KWD. */
export interface Currency {
  readonly code: string;
  readonly minorUnits: number;
}

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: Currency;
}

/** JSON shape. `amountMinor` is a decimal string, never a number. */
export interface MoneyWire {
  readonly amountMinor: string;
  readonly currency: string;
  readonly minorUnits: number;
}

export class MoneyError extends Error {}

export function currency(code: string, minorUnits = 2): Currency {
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new MoneyError(`Currency code must be three uppercase letters: ${code}`);
  }
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 4) {
    throw new MoneyError(`Unsupported currency exponent: ${minorUnits}`);
  }
  return { code, minorUnits };
}

export function money(amountMinor: bigint | number | string, c: Currency): Money {
  if (typeof amountMinor === 'number' && !Number.isInteger(amountMinor)) {
    throw new MoneyError('Minor-unit amounts must be integers; got a fraction.');
  }
  return { amountMinor: BigInt(amountMinor), currency: c };
}

export function zero(c: Currency): Money {
  return { amountMinor: 0n, currency: c };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency.code !== b.currency.code) {
    throw new MoneyError(`Cannot combine ${a.currency.code} with ${b.currency.code}.`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function sum(amounts: readonly Money[], c: Currency): Money {
  return amounts.reduce<Money>((acc, m) => add(acc, m), zero(c));
}

export function multiply(m: Money, factor: number): Money {
  if (!Number.isInteger(factor)) {
    throw new MoneyError('Use applyBasisPoints for fractional multiplication.');
  }
  return { amountMinor: m.amountMinor * BigInt(factor), currency: m.currency };
}

export function negate(m: Money): Money {
  return { amountMinor: -m.amountMinor, currency: m.currency };
}

export function isZero(m: Money): boolean {
  return m.amountMinor === 0n;
}

export function isNegative(m: Money): boolean {
  return m.amountMinor < 0n;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

/**
 * A percentage of an amount, expressed in basis points (2500 = 25%).
 *
 * Percentages are integers for the same reason amounts are: a 33% sibling
 * discount computed through a float lands on a different cent depending on the
 * order of operations. Rounds half away from zero, which is what a bursar
 * does by hand.
 */
export function applyBasisPoints(m: Money, bps: number): Money {
  if (!Number.isInteger(bps)) {
    throw new MoneyError('Basis points must be an integer.');
  }
  const scaled = m.amountMinor * BigInt(bps);
  return { amountMinor: divideRoundHalfAwayFromZero(scaled, 10_000n), currency: m.currency };
}

function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const absN = numerator < 0n ? -numerator : numerator;
  const absD = denominator < 0n ? -denominator : denominator;
  const quotient = absN / absD;
  const remainder = absN % absD;
  const rounded = remainder * 2n >= absD ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Splits an amount into `parts` shares that add back up to the original.
 * The remainder goes to the earliest shares, so nothing evaporates — the
 * classic bug in instalment plans.
 */
export function allocate(m: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new MoneyError('Cannot allocate into a non-positive number of parts.');
  }
  const n = BigInt(parts);
  const base = m.amountMinor / n;
  const remainder = m.amountMinor - base * n;
  const step = remainder < 0n ? -1n : 1n;
  let left = remainder < 0n ? -remainder : remainder;

  return Array.from({ length: parts }, () => {
    const extra = left > 0n ? step : 0n;
    if (left > 0n) left -= 1n;
    return { amountMinor: base + extra, currency: m.currency };
  });
}

/** Exact decimal string in major units: 480000n at exponent 2 → "4800.00". */
export function toDecimalString(m: Money): string {
  const { minorUnits } = m.currency;
  const negative = m.amountMinor < 0n;
  const digits = (negative ? -m.amountMinor : m.amountMinor).toString().padStart(minorUnits + 1, '0');
  const whole = digits.slice(0, digits.length - minorUnits);
  const fraction = minorUnits === 0 ? '' : `.${digits.slice(digits.length - minorUnits)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/**
 * Parses what a person typed into the office: "48,000.50", "48000.5", "-100".
 * Rejects anything with more precision than the currency has, rather than
 * silently rounding money the user meant.
 */
export function parseDecimalString(input: string, c: Currency): Money {
  const cleaned = input.trim().replace(/[\s,_]/g, '');
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) {
    throw new MoneyError(`Not a valid amount: "${input}"`);
  }
  const [, sign, whole = '0', fraction = ''] = match;
  if (fraction.length > c.minorUnits) {
    throw new MoneyError(
      `${c.code} has ${c.minorUnits} decimal places; "${input}" has ${fraction.length}.`,
    );
  }
  const padded = fraction.padEnd(c.minorUnits, '0');
  const amountMinor = BigInt(`${whole}${padded}`);
  return { amountMinor: sign === '-' ? -amountMinor : amountMinor, currency: c };
}

/**
 * Display string for a locale. `Intl.NumberFormat` takes an exact decimal
 * string, so the value never passes through a float on its way to the screen.
 */
export function format(m: Money, locale = 'en'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency.code,
    minimumFractionDigits: m.currency.minorUnits,
    maximumFractionDigits: m.currency.minorUnits,
    // @ts-expect-error Intl v3 accepts an exact decimal string; the DOM lib
    // types still say `number | bigint`. Passing a number would defeat the
    // whole module.
  }).format(toDecimalString(m));
}

export function toWire(m: Money): MoneyWire {
  return {
    amountMinor: m.amountMinor.toString(),
    currency: m.currency.code,
    minorUnits: m.currency.minorUnits,
  };
}

export function fromWire(w: MoneyWire): Money {
  return money(BigInt(w.amountMinor), currency(w.currency, w.minorUnits));
}
