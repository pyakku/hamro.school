import type { ReactNode } from 'react';

/**
 * The panel — white body, 1px ink border, 3px radius, header and footer in
 * card. This is the register, and it is the workhorse of the whole product.
 *
 * No shadow. Hard offset shadows are reserved for primary buttons; on every
 * panel they would be clutter, which is the departure from the marketing site
 * the design system calls out by name.
 */
export function Panel({
  title,
  meta,
  action,
  footer,
  children,
  className = '',
}: {
  title?: ReactNode;
  /** Mono metadata on the right of the header — a count, a date, a total. */
  meta?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[3px] border border-ink bg-white ${className}`}>
      {(title || meta || action) && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b-[1.5px] border-ink bg-card px-4 py-2.5 sm:px-5">
          {title && <h2 className="font-display text-[15px] font-bold">{title}</h2>}
          {meta && <span className="font-mono text-[11px] text-ink-45">{meta}</span>}
          {action && <div className="ml-auto">{action}</div>}
        </header>
      )}

      {children}

      {footer && (
        <footer className="border-t border-rule bg-card px-4 py-2.5 sm:px-5">{footer}</footer>
      )}
    </section>
  );
}

/** Body padding, for panels whose content is prose rather than a table. */
export function PanelBody({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-4 sm:px-5 ${className}`}>{children}</div>;
}
