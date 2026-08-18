import type { MessageKey, Permission, Scope } from '@hamro/shared';

/**
 * The navigation, as data.
 *
 * Grouped by *when you would use it* — Today, Accounts, School — rather than by
 * data model, per the design system. A class teacher opening this at 8:55am
 * wants the register, not a menu organised the way our tables are.
 *
 * Every item names the permission behind it, and the rail renders an item only
 * if the signed-in user holds it. That is a **courtesy, not a control**: it
 * saves a driver from a Fees link that would 403, and it is worth nothing as
 * security. Every one of these routes is checked again on the server, per
 * request, per resource — anyone who opens the network tab can see straight
 * through this file.
 *
 * `scopes` narrows an item further, for the two cases where the same permission
 * means a different screen. `student:read` at OWN_CHILDREN is a parent looking
 * at their own children; at ALL or OWN_SECTIONS it is a roster. Those are
 * different pages, so they are different items.
 */

export type NavGroup = 'today' | 'accounts' | 'school';

export interface NavItem {
  readonly path: string;
  readonly label: MessageKey;
  readonly permission: Permission;
  /** If given, the user's scope for `permission` must be one of these. */
  readonly scopes?: readonly Scope[];
  readonly group: NavGroup;
  /** Shown in the mobile tab bar. Only a handful fit; the rest live behind More. */
  readonly onTabBar?: boolean;
}

export const NAV_GROUPS: readonly { id: NavGroup; label: MessageKey }[] = [
  { id: 'today', label: 'nav.group.today' },
  { id: 'accounts', label: 'nav.group.accounts' },
  { id: 'school', label: 'nav.group.school' },
];

export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: '/',
    label: 'nav.overview',
    permission: 'school:read',
    group: 'today',
    onTabBar: true,
  },
  {
    path: '/children',
    label: 'nav.children',
    permission: 'student:read',
    scopes: ['OWN_CHILDREN'],
    group: 'today',
    onTabBar: true,
  },
  {
    path: '/attendance',
    label: 'nav.attendance',
    permission: 'attendance:read',
    group: 'today',
    onTabBar: true,
  },
  {
    path: '/homework',
    label: 'nav.homework',
    permission: 'homework:read',
    group: 'today',
    onTabBar: true,
  },
  {
    path: '/timetable',
    label: 'nav.timetable',
    permission: 'timetable:read',
    group: 'today',
  },
  {
    path: '/notices',
    label: 'nav.notices',
    permission: 'notice:read',
    group: 'today',
    onTabBar: true,
  },

  {
    path: '/fees',
    label: 'nav.fees',
    permission: 'invoice:read',
    group: 'accounts',
    onTabBar: true,
  },
  {
    path: '/payments',
    label: 'nav.payments',
    permission: 'payment:read',
    group: 'accounts',
  },

  {
    path: '/students',
    label: 'nav.students',
    permission: 'student:read',
    scopes: ['ALL', 'OWN_SECTIONS'],
    group: 'school',
  },
  {
    path: '/staff',
    label: 'nav.staff',
    permission: 'staff:read',
    group: 'school',
  },
  {
    /**
     * Read is the office at ALL and a teacher at SELF, so this appears for
     * both — but they are different screens behind it: the staff room, or a
     * single row. The page reads what the server sent rather than the role.
     */
    path: '/staff-attendance',
    label: 'nav.staff_attendance',
    permission: 'staff_attendance:read',
    group: 'school',
  },
  {
    /**
     * `exam:read`, not `mark:read` — the permission the page's first request
     * actually needs. A guardian holds `mark:read` for their own children but
     * no `exam:read`, so keying this on marks put an Exams link in a parent's
     * rail that 403s the moment they touch it. An item must name the permission
     * behind the screen, not the one behind the subject.
     *
     * The consequence is deliberate and worth stating: guardians and students
     * currently have no route to marks. That is the report card's job, and it
     * arrives with the grading scale engine.
     */
    path: '/exams',
    label: 'nav.exams',
    permission: 'exam:read',
    group: 'school',
  },
  {
    path: '/settings',
    label: 'nav.settings',
    permission: 'school:read',
    group: 'school',
  },
];

/** The items this user has any use for, in order. */
export function visibleNavItems(
  scopeFor: (permission: Permission) => Scope | null,
): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    const scope = scopeFor(item.permission);
    if (scope === null) return false;
    return item.scopes ? item.scopes.includes(scope) : true;
  });
}

/** Grouped for the rail, with empty groups dropped rather than left as headings. */
export function navByGroup(
  scopeFor: (permission: Permission) => Scope | null,
): { id: NavGroup; label: MessageKey; items: NavItem[] }[] {
  const visible = visibleNavItems(scopeFor);
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: visible.filter((item) => item.group === group.id),
  })).filter((group) => group.items.length > 0);
}

/**
 * Which nav item a path belongs to, for `aria-current` and the breadcrumb.
 * Longest match wins, so `/students/abc` is still Students while `/` only
 * matches itself.
 */
export function activeNavItem(pathname: string, items: readonly NavItem[]): NavItem | null {
  let best: NavItem | null = null;
  for (const item of items) {
    const matches = item.path === '/' ? pathname === '/' : pathname.startsWith(item.path);
    if (!matches) continue;
    if (!best || item.path.length > best.path.length) best = item;
  }
  return best;
}
