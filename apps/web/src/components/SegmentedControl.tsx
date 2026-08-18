import type { AttendanceStatusWire, MessageKey } from '@hamro/shared';
import { useT } from '../lib/i18n.js';

/**
 * The attendance primitive: P / A / L / T.
 *
 * 32px tall on a desktop, 44px on touch, filled with the semantic colour when
 * selected — jade for present, stamp for absent, marigold for late, and muted
 * for approved leave, which is the school's own decision and must never read
 * like a failing.
 *
 * The letters are catalogue keys, not literals. "P" is not universal, and a
 * school reading this in Arabic needs its own initials.
 *
 * Real buttons with `aria-pressed`, so the register is usable from a keyboard
 * and audible to a screen reader — a teacher tabbing down a class of 45 is a
 * genuine case, not a hypothetical one.
 */

const ORDER: AttendanceStatusWire[] = [
  'PRESENT',
  'ABSENT_UNEXPLAINED',
  'ABSENT_APPROVED',
  'LATE',
];

const SELECTED: Record<AttendanceStatusWire, string> = {
  PRESENT: 'bg-jade text-white border-jade',
  ABSENT_UNEXPLAINED: 'bg-stamp text-white border-stamp',
  ABSENT_APPROVED: 'bg-ink-45 text-white border-ink-45',
  LATE: 'bg-marigold text-ink border-marigold-deep',
};

export function AttendanceSegmented({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: AttendanceStatusWire;
  onChange: (next: AttendanceStatusWire) => void;
  disabled?: boolean;
  /** Names the row for a screen reader: "Status for Anika Andersen". */
  label: string;
}) {
  const t = useT();

  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-[3px] border border-rule"
    >
      {ORDER.map((status, index) => {
        const isSelected = status === value;
        return (
          <button
            key={status}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            title={t(`attendance.status.${status}` as MessageKey)}
            onClick={() => onChange(status)}
            className={[
              'flex h-11 w-11 items-center justify-center font-mono text-[13px] transition-colors sm:h-8 sm:w-8 sm:text-[12px]',
              index > 0 ? 'border-l border-rule' : '',
              isSelected ? SELECTED[status] : 'bg-white text-ink-45 hover:bg-card hover:text-ink',
              disabled ? 'cursor-not-allowed opacity-55' : '',
            ].join(' ')}
          >
            {t(`attendance.status.${status}.short` as MessageKey)}
            <span className="sr-only">{t(`attendance.status.${status}` as MessageKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
