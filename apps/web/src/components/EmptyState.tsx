import type { ReactNode } from 'react';
import type { MessageKey } from '@hamro/shared';
import { useT } from '../lib/i18n.js';

/**
 * Nothing here yet — said as an invitation, never as "No data found".
 *
 * The design system is firm about this and it is not decoration: an empty
 * register on a teacher's first morning is the moment they decide whether this
 * product is going to help them. "No homework posted this week. Post the first
 * one." tells them what happened *and* what to do next.
 *
 * The message is a key, because a school in Doha reads this in Arabic.
 */
export function EmptyState({
  message,
  values,
  action,
  compact = false,
}: {
  message: MessageKey;
  /** Interpolated into the message — a search term, a date, a class name. */
  values?: Record<string, string | number>;
  action?: ReactNode;
  compact?: boolean;
}) {
  const t = useT();
  return (
    <div className={`px-5 text-center ${compact ? 'py-7' : 'py-12'}`}>
      <p className="mx-auto max-w-[42ch] text-[14.5px] text-ink-45">{t(message, values)}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
