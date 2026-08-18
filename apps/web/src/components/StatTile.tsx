import type { ReactNode } from 'react';

/**
 * A single number, said once and said clearly.
 *
 * Display 700 at 26px for the value, mono uppercase for the label — the type
 * pairing that makes this product read as a register rather than a dashboard.
 * The value is *always* mono or display, never body: it is a number, and rule
 * one of the type system is that every number is set in one of those.
 *
 * `tone` is semantic. Jade is paid or present, stamp is overdue or absent,
 * marigold is late or pending. A tile does not get a colour because the row
 * needed one.
 */
export type Tone = 'ink' | 'jade' | 'marigold' | 'stamp' | 'muted';

const VALUE_TONE: Record<Tone, string> = {
  ink: 'text-ink',
  jade: 'text-jade',
  marigold: 'text-marigold-deep',
  stamp: 'text-stamp',
  muted: 'text-ink-45',
};

export function StatTile({
  label,
  value,
  hint,
  tone = 'ink',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="px-4 py-3.5 sm:px-5">
      <div className="field-label">{label}</div>
      <div
        className={`mt-1 font-display text-[26px] leading-none font-bold tabular-nums ${VALUE_TONE[tone]}`}
      >
        {value}
      </div>
      {hint && <div className="mt-1.5 font-mono text-[11px] text-ink-45">{hint}</div>}
    </div>
  );
}

/**
 * A row of tiles inside a panel, divided by rules rather than gaps — the
 * ledger look. Collapses to two columns on a phone, where four across would
 * each be too narrow to read.
 */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-rule-soft sm:grid-cols-4 sm:divide-y-0">
      {children}
    </div>
  );
}
