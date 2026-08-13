import { Navigate } from 'react-router-dom';
import type { MessageKey } from '@hamro/shared';
import { useSession } from '../lib/session.js';
import { useT } from '../lib/i18n.js';

/**
 * Deliberately almost nothing.
 *
 * This session builds the foundation, not features — no register, no fee
 * ledger, no timetable. What is here proves the parts underneath work: the
 * session survives a reload, the school came back with its own timezone and
 * currency, and the permissions the server granted are the ones the client
 * sees. The nav in the design prototype arrives with the screens it points at.
 */
export default function SignedIn() {
  const t = useT();
  const { user, signOut } = useSession();

  if (!user) return <Navigate to="/sign-in" replace />;

  return (
    <main className="mx-auto w-full max-w-[640px] px-6 py-12">
      <div className="mb-6 flex items-baseline gap-px">
        <span className="font-display text-[22px] font-bold tracking-[-0.03em]">hamro</span>
        <span className="font-mono text-[14px] text-marigold-deep">.school</span>
      </div>

      <div className="rounded-[3px] border border-ink bg-white">
        <div className="flex items-center gap-3 border-b-[1.5px] border-ink bg-card px-5 py-3">
          <h1 className="text-[15px]">{user.school.name}</h1>
          <span className="ml-auto font-mono text-[11px] text-ink-45">{user.school.timezone}</span>
        </div>

        <dl className="px-5 py-4">
          <Row label={t('auth.signed_in_as')} value={`${user.firstName} ${user.lastName}`} />
          <Row label={t('auth.sign_in.email')} value={user.email} mono />
          <Row
            label="Roles"
            value={user.roles.map((role) => t(`role.${role}` as MessageKey)).join(' · ')}
          />
          <Row label="Permissions" value={`${user.permissions.length} granted`} mono />
          <Row label="Currency" value={user.school.currency} mono />
        </dl>

        <div className="border-t border-rule px-5 py-3">
          <button
            type="button"
            className="font-display text-[14px] font-semibold text-ink-70 underline underline-offset-4 hover:text-ink"
            onClick={() => void signOut()}
          >
            {t('auth.sign_out')}
          </button>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-4 border-b border-rule-soft py-2 last:border-b-0">
      <dt className="field-label w-[110px] shrink-0">{label}</dt>
      <dd className={mono ? 'font-mono text-[13px]' : 'text-[14.5px]'}>{value}</dd>
    </div>
  );
}
