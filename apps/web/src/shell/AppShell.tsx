import { Navigate, Outlet } from 'react-router-dom';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { Rail } from './Rail.js';
import { Topbar } from './Topbar.js';
import { BottomTabs } from './BottomTabs.js';

/**
 * The frame every signed-in screen sits in.
 *
 * Rail on the left at 236px, topbar at 56px, content capped at 1080px with 24px
 * of padding. Under 900px the rail becomes a bottom bar and the content runs to
 * the edge, so the phone layout is the same code rather than a second app.
 *
 * The skip link is first in the DOM and visible on focus. A class teacher
 * tabbing to the register should not have to walk the whole rail to get there,
 * and on these screens the rail is a dozen links long.
 */
export function AppShell() {
  const t = useT();
  const { user, isLoading } = useSession();

  if (isLoading) {
    return (
      <div
        role="status"
        className="flex min-h-full items-center justify-center font-mono text-[11px] tracking-[0.12em] text-ink-45 uppercase"
      >
        {t('shell.loading')}
      </div>
    );
  }

  if (!user) return <Navigate to="/sign-in" replace />;

  return (
    <div className="min-h-full">
      <a
        href="#main"
        className="sr-only rounded-[3px] bg-ink px-3 py-2 text-paper focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        {t('shell.skip_to_content')}
      </a>

      <Rail />

      <div className="lg:pl-[236px]">
        <Topbar />
        <main
          id="main"
          // The bottom padding clears the tab bar on a phone; on a laptop the
          // rail is on the left and there is nothing down there to clear.
          className="mx-auto w-full max-w-[1080px] px-4 pt-5 pb-24 sm:px-6 lg:pb-10"
        >
          <Outlet />
        </main>
      </div>

      <BottomTabs />
    </div>
  );
}
