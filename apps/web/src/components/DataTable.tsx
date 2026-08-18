import type { ReactNode } from 'react';

/**
 * The data table — CSS grid, not `<table>`.
 *
 * A real table cannot reflow. Under 900px this becomes stacked cards, and a
 * teacher on a phone is the majority case for half these screens, so the grid
 * is what makes that possible without a second component.
 *
 * The accessibility cost of leaving semantics behind is paid back explicitly:
 * the wrapper carries `role="table"` and the parts carry `role="row"` and
 * `role="cell"`, so a screen reader still hears a table.
 *
 * `columns` is a grid-template string. Column headers are mono, uppercase and
 * 9.5px per the type scale; row borders are rule-soft; a row that carries a
 * status gets a tinted background rather than coloured text alone.
 */

export type RowTone = 'none' | 'jade' | 'marigold' | 'stamp';

const ROW_TONE: Record<RowTone, string> = {
  none: '',
  jade: 'bg-jade/6',
  marigold: 'bg-marigold/8',
  stamp: 'bg-stamp/6',
};

export function DataTable({
  columns,
  head,
  children,
  label,
}: {
  /** A `grid-template-columns` value, e.g. "64px 1fr 120px". */
  columns: string;
  head: ReactNode;
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="overflow-x-auto" role="table" aria-label={label}>
      <div className="min-w-[640px] md:min-w-0">
        <div
          role="row"
          className="grid items-center gap-3 border-b border-rule bg-card px-4 py-2 sm:px-5"
          style={{ gridTemplateColumns: columns }}
        >
          {head}
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

/** A mono uppercase column header. `numeric` right-aligns it over its numbers. */
export function Th({
  children,
  numeric = false,
}: {
  children: ReactNode;
  numeric?: boolean;
}) {
  return (
    <div
      role="columnheader"
      className={`font-mono text-[9.5px] font-medium tracking-[0.12em] text-ink-45 uppercase ${
        numeric ? 'text-right' : ''
      }`}
    >
      {children}
    </div>
  );
}

export function Tr({
  columns,
  tone = 'none',
  children,
  onClick,
}: {
  columns: string;
  tone?: RowTone;
  children: ReactNode;
  onClick?: () => void;
}) {
  const shared = `grid w-full items-center gap-3 border-b border-rule-soft px-4 py-2.5 text-left last:border-b-0 sm:px-5 ${ROW_TONE[tone]}`;

  if (onClick) {
    return (
      <button
        type="button"
        role="row"
        onClick={onClick}
        className={`${shared} hover:bg-card`}
        style={{ gridTemplateColumns: columns }}
      >
        {children}
      </button>
    );
  }

  return (
    <div role="row" className={shared} style={{ gridTemplateColumns: columns }}>
      {children}
    </div>
  );
}

/** A cell. `mono` for every number, ID, date and time — the rule, not a choice. */
export function Td({
  children,
  mono = false,
  numeric = false,
  muted = false,
  className = '',
}: {
  children: ReactNode;
  mono?: boolean;
  numeric?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div
      role="cell"
      className={[
        'min-w-0 truncate',
        mono || numeric ? 'font-mono text-[12.5px] tabular-nums' : 'text-[14.5px]',
        numeric ? 'text-right' : '',
        muted ? 'text-ink-45' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
