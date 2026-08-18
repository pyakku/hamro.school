import type { ReactNode } from 'react';
import type { MessageKey } from '@hamro/shared';
import { ApiRequestError } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { Panel } from './Panel.js';
import { EmptyState } from './EmptyState.js';

/**
 * Loading, failed, or forbidden — said once, the same way, on every page.
 *
 * The forbidden case is deliberately a plain sentence rather than an apology or
 * a stack trace. The rail does not show a link a user cannot use, so arriving
 * here means they typed the path or followed an old bookmark; the server said
 * no, and the honest thing is to say so and move on.
 */
export function QueryState({
  isLoading,
  error,
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const t = useT();

  if (isLoading) return <LoadingPanel />;

  if (error) {
    const key: MessageKey =
      error instanceof ApiRequestError && error.status === 403
        ? 'error.forbidden'
        : error instanceof ApiRequestError && error.status === 404
          ? 'error.not_found'
          : error instanceof ApiRequestError && error.key === 'error.network'
            ? 'error.network'
            : 'error.generic';

    const canRetry = !(error instanceof ApiRequestError && error.status === 403);

    return (
      <Panel>
        <EmptyState
          message={key}
          action={
            canRetry && onRetry ? (
              <button type="button" className="btn-primary" onClick={onRetry}>
                {t('action.retry')}
              </button>
            ) : undefined
          }
        />
      </Panel>
    );
  }

  return <>{children}</>;
}

export function LoadingPanel({ rows = 6 }: { rows?: number }) {
  const t = useT();
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-[3px] border border-ink bg-white"
    >
      <span className="sr-only">{t('shell.loading')}</span>
      <div className="h-10 border-b-[1.5px] border-ink bg-card" />
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 border-b border-rule-soft px-5 py-3">
          <div className="h-2.5 w-8 rounded-full bg-rule" />
          <div className="h-2.5 flex-1 max-w-[220px] rounded-full bg-rule-soft" />
          <div className="ml-auto h-2.5 w-16 rounded-full bg-rule-soft" />
        </div>
      ))}
    </div>
  );
}
