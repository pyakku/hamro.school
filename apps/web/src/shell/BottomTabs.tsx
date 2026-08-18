import { NavLink } from 'react-router-dom';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { visibleNavItems } from '../lib/nav.js';

/**
 * Under 900px the rail becomes a bottom tab bar.
 *
 * Tap targets are 44px minimum and the bar sits inside the safe area, because
 * the phone is the primary device for a class teacher and a parent — not the
 * fallback. Five tabs at most: a sixth makes each one too narrow to hit, and the
 * rest of the navigation is reachable from Settings and the overview.
 */
export function BottomTabs() {
  const t = useT();
  const { scopeFor } = useSession();

  const items = visibleNavItems(scopeFor)
    .filter((item) => item.onTabBar)
    .slice(0, 5);

  if (items.length <= 1) return null;

  return (
    <nav
      aria-label={t('shell.main_nav')}
      className="fixed inset-x-0 bottom-0 z-20 border-t-[1.5px] border-ink bg-ink pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex">
        {items.map((item) => (
          <li key={item.path} className="flex-1">
            <NavLink
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                [
                  'flex min-h-[52px] flex-col items-center justify-center gap-0.5 border-t-[3px] px-1 text-center font-mono text-[10px] tracking-[0.06em] uppercase transition-colors',
                  isActive
                    ? 'border-marigold bg-white/8 text-paper'
                    : 'border-transparent text-paper/60',
                ].join(' ')
              }
            >
              <span className="truncate px-0.5">{t(item.label)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
