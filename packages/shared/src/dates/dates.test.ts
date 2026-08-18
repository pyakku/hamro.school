import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatLocalDate,
  fromLocalDate,
  isLocalDate,
  isWithin,
  timeInTimezone,
  toLocalDate,
  todayInTimezone,
  weekdayOf,
} from './index.js';

/**
 * The tests that matter here are the timezone ones. Everything else is
 * arithmetic; the timezone cases are where the plausible-looking
 * implementation is wrong for half the customers.
 */

describe('toLocalDate', () => {
  it('reads the calendar date out of a @db.Date, which Postgres returns as UTC midnight', () => {
    expect(toLocalDate(new Date('2026-08-17T00:00:00.000Z'))).toBe('2026-08-17');
  });

  it('does not shift the day for a process running west of Greenwich', () => {
    // The trap: getFullYear()/getDate() on this value in America/New_York
    // gives the 16th. The calendar date is the 17th in every timezone,
    // because a @db.Date has no instant behind it.
    const date = new Date('2026-08-17T00:00:00.000Z');
    expect(toLocalDate(date)).toBe('2026-08-17');
  });

  it('round-trips through fromLocalDate', () => {
    expect(toLocalDate(fromLocalDate('2027-03-31'))).toBe('2027-03-31');
  });

  it('pads single-digit months and days', () => {
    expect(toLocalDate(new Date('2026-01-05T00:00:00.000Z'))).toBe('2026-01-05');
  });
});

describe('todayInTimezone', () => {
  it('is already tomorrow in Kathmandu when it is still yesterday in UTC', () => {
    // 18:30 UTC is 00:15 the next day in Kathmandu (UTC+5:45). A register
    // taken at 08:00 local must not land on the previous day.
    const instant = new Date('2026-08-17T18:30:00.000Z');
    expect(todayInTimezone('Asia/Kathmandu', instant)).toBe('2026-08-18');
    expect(todayInTimezone('UTC', instant)).toBe('2026-08-17');
  });

  it('is still the previous day in New York when UTC has rolled over', () => {
    const instant = new Date('2026-08-18T03:00:00.000Z');
    expect(todayInTimezone('America/New_York', instant)).toBe('2026-08-17');
  });

  it('handles the 45-minute offset without rounding it to an hour', () => {
    // Midnight in Kathmandu is 18:15 UTC, not 18:00 and not 19:00. Ten
    // minutes before it, the school day is still the 17th; five minutes
    // after, it is the 18th.
    expect(todayInTimezone('Asia/Kathmandu', new Date('2026-08-17T18:05:00.000Z'))).toBe(
      '2026-08-17',
    );
    expect(todayInTimezone('Asia/Kathmandu', new Date('2026-08-17T18:20:00.000Z'))).toBe(
      '2026-08-18',
    );
  });
});

describe('timeInTimezone', () => {
  it('gives the school wall clock in 24-hour form', () => {
    expect(timeInTimezone('Asia/Kolkata', new Date('2026-08-17T04:00:00.000Z'))).toBe('09:30');
  });
});

describe('weekdayOf', () => {
  it('counts Monday as 1 and Sunday as 7', () => {
    expect(weekdayOf('2026-08-17')).toBe(1); // a Monday
    expect(weekdayOf('2026-08-23')).toBe(7); // the Sunday after
  });
});

describe('arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('adds days across a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('subtracts with a negative count', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('crosses a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('counts whole days between dates, signed', () => {
    expect(daysBetween('2026-08-01', '2026-08-17')).toBe(16);
    expect(daysBetween('2026-08-17', '2026-08-01')).toBe(-16);
    expect(daysBetween('2026-08-17', '2026-08-17')).toBe(0);
  });

  it('is not thrown off by a daylight-saving transition', () => {
    // These are calendar dates, so March in Europe is 31 days either way.
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });
});

describe('isWithin', () => {
  it('includes both ends of a term', () => {
    expect(isWithin('2026-04-01', '2026-04-01', '2026-08-31')).toBe(true);
    expect(isWithin('2026-08-31', '2026-04-01', '2026-08-31')).toBe(true);
    expect(isWithin('2026-09-01', '2026-04-01', '2026-08-31')).toBe(false);
  });
});

describe('isLocalDate', () => {
  it('accepts a calendar date and rejects everything else', () => {
    expect(isLocalDate('2026-08-17')).toBe(true);
    expect(isLocalDate('2026-8-17')).toBe(false);
    expect(isLocalDate('2026-08-17T00:00:00Z')).toBe(false);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('')).toBe(false);
  });
});

describe('formatLocalDate', () => {
  it('prints the date it was given, not the day before', () => {
    expect(formatLocalDate('2026-08-17')).toBe('17 Aug 2026');
  });

  it('writes the day first for the product\'s English, not the US order', () => {
    // Bare `en` is US English to ICU. Every market this sells into writes the
    // day first, so `en` resolves to en-GB.
    expect(formatLocalDate('2026-08-17', 'en')).toBe('17 Aug 2026');
  });

  it('passes a more specific locale straight through', () => {
    expect(formatLocalDate('2026-08-17', 'en-US')).toBe('Aug 17, 2026');
  });
});
