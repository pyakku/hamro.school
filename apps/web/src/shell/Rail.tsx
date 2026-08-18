import { NavLink } from 'react-router-dom';
import type { MessageKey } from '@hamro/shared';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { navByGroup } from '../lib/nav.js';

/**
 * The left rail: 236px, ink, sticky, with a 3px stamp-red right border.
 *
 * That border is the marketing site's red margin line, moved and given a job.
 * On the site it was decoration; here it separates navigation from work, which
 * is the one thing a rail has to do.
 *
 * Hidden under 900px, where the bottom tab bar takes over — teachers will use
 * this on a phone more than a laptop.
 */
export function Rail() {
  const t = useT();
  const { user, scopeFor, signOut } = useSession();
  const groups = navByGroup(scopeFor);

  return (
    <nav
      aria-label={t('shell.main_nav')}
      className="fixed inset-y-0 left-0 z-20 hidden w-[236px] flex-col border-r-[3px] border-stamp bg-ink lg:flex"
    >
      <div className="flex items-baseline gap-px px-5 pt-5 pb-6">
        <span className="font-display text-[19px] font-bold tracking-[-0.03em] text-paper">
          hamro
        </span>
        <span className="font-mono text-[12px] text-marigold">.school</span>
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
        {groups.map((group) => (
          <div key={group.id} className="mb-5">
            <div className="px-5 pb-1.5 font-mono text-[9.5px] tracking-[0.14em] text-paper/40 uppercase">
              {t(group.label)}
            </div>
            <ul>
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      [
                        'block border-l-[3px] py-[7px] pr-4 pl-[17px] text-[14px] transition-colors',
                        isActive
                          ? // Marigold means active, here as everywhere else.
                            'border-marigold bg-white/8 font-medium text-paper'
                          : 'border-transparent text-paper/65 hover:bg-white/5 hover:text-paper',
                      ].join(' ')
                    }
                  >
                    {t(item.label)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {user && (
        <div className="border-t border-white/12 px-5 py-3.5">
          <div className="truncate text-[13.5px] text-paper">
            {user.firstName} {user.lastName}
          </div>
          <div className="truncate font-mono text-[10.5px] text-paper/45">
            {user.roles.map((role) => t(`role.${role}` as MessageKey)).join(' · ')}
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-2 font-mono text-[10.5px] tracking-[0.1em] text-paper/55 uppercase underline underline-offset-4 hover:text-marigold"
          >
            {t('auth.sign_out')}
          </button>
        </div>
      )}
    </nav>
  );
}
