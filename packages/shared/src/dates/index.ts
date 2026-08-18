/**
 * Local calendar dates, and the one place that converts them.
 *
 * Rule 5 splits the world in two. A school day — attendance, a due date, a
 * holiday, an exam — is a *local calendar date*: `@db.Date` in Postgres, a
 * `YYYY-MM-DD` string on the wire, and never an instant. An event — a login, a
 * publication, an audit entry — is an instant: `@db.Timestamptz(3)`.
 *
 * The bug this module exists to prevent: `new Date().toISOString().slice(0, 10)`
 * gives you the UTC date. At 08:00 in Kathmandu that is still yesterday, so a
 * morning register lands on the wrong day for every customer east of Greenwich
 * — and it looks right in London, which is why nobody catches it in review.
 *
 * Everything here is `Intl`. No date library: the whole job is "what day is it
 * in Asia/Kathmandu", and the platform already knows.
 */

/** A local calendar date, `YYYY-MM-DD`. Not an instant, and not a `Date`. */
export type LocalDate = string;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True for a real calendar date.
 *
 * The round-trip is the point. `Date.parse('2026-02-30T00:00:00Z')` does not
 * fail — it silently rolls over to 2 March — so a regex plus a parse accepts
 * dates that do not exist, and the day a school enters one it becomes an
 * attendance record on a day nobody worked.
 */
export function isLocalDate(value: string): value is LocalDate {
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day)
  );
}

/**
 * A `@db.Date` column as it comes back from Prisma — UTC midnight — as
 * `YYYY-MM-DD`.
 *
 * Reads the UTC parts deliberately. Postgres hands a `date` back as midnight
 * UTC, so the UTC parts *are* the calendar date; using the local getters would
 * shift it a day backwards for anyone running west of Greenwich.
 */
export function toLocalDate(value: Date): LocalDate {
  const year = value.getUTCFullYear().toString().padStart(4, '0');
  const month = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = value.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * A `YYYY-MM-DD` string as the `Date` Prisma wants for a `@db.Date` column:
 * midnight UTC, carrying no timezone meaning of its own.
 */
export function fromLocalDate(value: LocalDate): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * What day it is at the school.
 *
 * `en-CA` because it formats as `YYYY-MM-DD`, which is the shape we want and
 * is stable across every ICU build. The alternative — assembling it from
 * `formatToParts` — is more code for the same answer.
 */
export function todayInTimezone(timezone: string, now: Date = new Date()): LocalDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The wall-clock time at the school, `HH:MM`, for a topbar or a timestamp. */
export function timeInTimezone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

/**
 * Day of the week as Postgres and our timetable count it: 1 = Monday …
 * 7 = Sunday (ISO 8601).
 *
 * Not `Date.getDay()`, which makes Sunday 0 and would put every timetable off
 * by one for the schools whose week starts on Sunday.
 */
export function weekdayOf(value: LocalDate): number {
  const day = fromLocalDate(value).getUTCDay();
  return day === 0 ? 7 : day;
}

/** `value` shifted by whole days, staying a calendar date throughout. */
export function addDays(value: LocalDate, days: number): LocalDate {
  const date = fromLocalDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toLocalDate(date);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  const ms = fromLocalDate(to).getTime() - fromLocalDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** True when `value` falls in `[start, end]`. String compare is safe on ISO dates. */
export function isWithin(value: LocalDate, start: LocalDate, end: LocalDate): boolean {
  return value >= start && value <= end;
}

/**
 * The locale to format dates and times under.
 *
 * Bare `en` is US English to ICU, which prints "Aug 17, 2026". Every market
 * this product sells into — Nepal, India, the Gulf — writes the day first, and
 * the message catalogue is already international English ("Forgotten your
 * password?"). So `en` resolves to `en-GB` here, and any more specific tag the
 * school sets is passed through untouched.
 */
function dateLocale(locale: string): string {
  return locale === 'en' ? 'en-GB' : locale;
}

/**
 * A date for a person to read: "17 Aug 2026".
 *
 * `timeZone: 'UTC'` is not a mistake. The value is already a calendar date with
 * no instant behind it; formatting it in the school's zone would re-interpret
 * midnight UTC and could print the day before.
 */
export function formatLocalDate(
  value: LocalDate,
  locale = 'en',
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  return new Intl.DateTimeFormat(dateLocale(locale), { ...options, timeZone: 'UTC' }).format(
    fromLocalDate(value),
  );
}

/** "Mon 17 Aug" — the topbar form, where the year is noise. */
export function formatLocalDateShort(value: LocalDate, locale = 'en'): string {
  return formatLocalDate(value, locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * An instant for a person to read, in the school's zone — an audit entry, a
 * publication time, a login. This one *does* take the timezone, because a
 * timestamptz is a real moment and the school reads it in local time.
 */
export function formatInstant(value: Date | string, timezone: string, locale = 'en'): string {
  return new Intl.DateTimeFormat(dateLocale(locale), {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(typeof value === 'string' ? new Date(value) : value);
}
