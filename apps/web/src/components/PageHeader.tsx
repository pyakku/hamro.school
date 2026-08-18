import type { ReactNode } from 'react';

/**
 * The page title block. Display 700 at 26px, per the type scale, with an
 * optional line of prose under it and actions on the right.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div>
        <h1 className="font-display text-[26px] leading-tight font-bold [font-variation-settings:'wdth'_94]">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-[14px] text-ink-45">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
