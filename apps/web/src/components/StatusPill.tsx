import type { AttendanceStatusWire, MessageKey } from '@hamro/shared';
import { useT } from '../lib/i18n.js';
import type { Tone } from './StatTile.js';

/**
 * A status, said in colour *and* in words.
 *
 * The accessibility floor is explicit about this: state is never conveyed by
 * colour alone. Every pill carries its label, so the eight percent of men with
 * a colour vision deficiency read the same register as everyone else — and so
 * does anyone printing it in black and white, which schools do constantly.
 */

const TONE: Record<Tone, string> = {
  ink: 'border-ink/25 bg-ink/8 text-ink',
  jade: 'border-jade/35 bg-jade/10 text-jade',
  marigold: 'border-marigold-deep/35 bg-marigold/15 text-marigold-deep',
  stamp: 'border-stamp/35 bg-stamp/8 text-stamp',
  muted: 'border-rule bg-card text-ink-45',
};

export function StatusPill({ label, tone = 'ink' }: { label: string; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-px font-mono text-[10px] tracking-[0.08em] uppercase ${TONE[tone]}`}
    >
      {label}
    </span>
  );
}

/**
 * Attendance's own mapping, kept in one place so that jade always means present
 * and stamp always means absent on every screen that shows a register.
 */
const ATTENDANCE_TONE: Record<AttendanceStatusWire, Tone> = {
  PRESENT: 'jade',
  LATE: 'marigold',
  ABSENT_UNEXPLAINED: 'stamp',
  // Approved leave is not a failing — it is the school's own decision, and it
  // must never read like unexplained absence.
  ABSENT_APPROVED: 'muted',
};

export function AttendancePill({ status }: { status: AttendanceStatusWire }) {
  const t = useT();
  return (
    <StatusPill
      label={t(`attendance.status.${status}` as MessageKey)}
      tone={ATTENDANCE_TONE[status]}
    />
  );
}
