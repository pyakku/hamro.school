import {
  format as formatMoney,
  formatLocalDate,
  formatLocalDateShort,
  fromWire,
  type AttendanceRun,
  type AttendanceTally,
  type LocalDate,
  type MoneyWire,
} from '@hamro/shared';

/**
 * Display formatting, in one place.
 *
 * Money arrives as a string of minor units and is turned into something a
 * person reads *here* and nowhere else. No component does arithmetic on an
 * amount: the moment one writes `Number(amountMinor) / 100` the ledger is
 * floating point, and rule 4 exists because that bug is undetectable until a
 * school reconciles against a bank statement and is out by a paisa.
 */

/** "₹9,42,000.00" — grouped the way the locale groups, from exact integers. */
export function money(wire: MoneyWire, locale = 'en'): string {
  return formatMoney(fromWire(wire), locale);
}

/** True when there is nothing owed. Compares the string as an integer, not a float. */
export function isZeroMoney(wire: MoneyWire): boolean {
  return BigInt(wire.amountMinor) === 0n;
}

export function isNegativeMoney(wire: MoneyWire): boolean {
  return BigInt(wire.amountMinor) < 0n;
}

export function date(value: LocalDate, locale = 'en'): string {
  return formatLocalDate(value, locale);
}

export function dateShort(value: LocalDate, locale = 'en'): string {
  return formatLocalDateShort(value, locale);
}

/** An instant, read in the school's timezone — a publication time, a login. */
export function instant(value: string, timezone: string, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

/** A plain count, grouped: "1,240". */
export function count(value: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * An attendance rate, worked out at read time and never stored.
 *
 * Present and late both count as *in school* — a child who arrived at 9:10 was
 * there, and counting them absent is the kind of number a parent disputes and
 * wins. Approved leave is out of the denominator entirely rather than counted
 * against the child, which is the whole reason the four statuses exist.
 *
 * Returns null when nothing has been recorded: a school with no register yet
 * has no rate, and rendering "0%" would say something false.
 */
export function attendanceRate(run: AttendanceRun | AttendanceTally): number | null {
  const counted =
    'schoolDays' in run
      ? run.schoolDays - run.absentApproved
      : run.total - run.absentApproved;
  if (counted <= 0) return null;
  return Math.round(((run.present + run.late) / counted) * 100);
}

/** "94%" or an em dash when there is nothing to divide. */
export function attendanceRateLabel(run: AttendanceRun | AttendanceTally): string {
  const rate = attendanceRate(run);
  return rate === null ? '—' : `${rate}%`;
}

/**
 * The semantic colour for an attendance rate.
 *
 * Jade, marigold and stamp are never decorative — a person reads status from
 * colour alone across the product, so these thresholds have to mean the same
 * thing on every screen that shows a rate.
 */
export function attendanceTone(rate: number | null): 'jade' | 'marigold' | 'stamp' | 'muted' {
  if (rate === null) return 'muted';
  if (rate >= 90) return 'jade';
  if (rate >= 75) return 'marigold';
  return 'stamp';
}

/** "Grade 6 A · Roll 14" and friends — a middot join that skips blanks. */
export function joinMeta(...parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(' · ');
}
