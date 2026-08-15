/**
 * English message catalogue — the source of truth for message *keys*.
 *
 * No user-facing string appears anywhere else in this codebase. Not in a route
 * handler, not in a React component, not in a toast. Retrofitting i18n means
 * finding every string a person can see, and by then you never find them all;
 * a school in Doha and a school in Kathmandu both buy this product.
 *
 * The API sends keys, not sentences: `{ error: { key: 'error.auth.invalid_credentials' } }`.
 * The client resolves them. That also keeps server logs stable when the wording
 * changes.
 *
 * School-authored text — subject names, notice bodies, grade band labels — is
 * data, not copy. It is stored and shown verbatim and never appears here.
 */
export const en = {
  // ── Errors ────────────────────────────────────────────────────────────────
  'error.generic': 'Something went wrong. Try again.',
  'error.network': "Couldn't reach the server. Check your connection.",
  'error.validation': 'Check the highlighted fields.',
  'error.not_found': "That doesn't exist, or you don't have access to it.",
  'error.forbidden': "You don't have access to that.",
  'error.unauthenticated': 'Sign in to continue.',
  'error.rate_limited': 'Too many attempts. Wait a minute and try again.',
  'error.auth.invalid_credentials': "That email and password don't match.",
  'error.auth.account_inactive': 'This account has been deactivated. Ask your school office.',
  'error.auth.no_roles': 'This account has no role at the school yet. Ask your school office.',
  'error.auth.school_not_found': "We couldn't find that school.",
  'error.auth.session_expired': 'Your session has expired. Sign in again.',

  // ── Auth ──────────────────────────────────────────────────────────────────
  'auth.sign_in.title': 'Sign in',
  'auth.sign_in.subtitle': 'Your school account.',
  'auth.sign_in.school': 'School',
  'auth.sign_in.identifier': 'Username',
  'auth.sign_in.identifier_help': 'For example sunita@modelschool',
  'auth.sign_in.identifier_help_school': 'Your username at {school}',
  'auth.sign_in.school_placeholder': 'greenhill',
  'auth.sign_in.school_help': 'The name in your school’s web address.',
  'auth.sign_in.email': 'Email',
  'auth.sign_in.password': 'Password',
  'auth.sign_in.submit': 'Sign in',
  'auth.sign_in.submitting': 'Signing in…',
  'auth.sign_in.forgot': 'Forgotten your password?',
  'auth.sign_out': 'Sign out',
  'auth.signed_in_as': 'Signed in as',

  // ── Signup ────────────────────────────────────────────────────────────────
  'signup.title': 'Start your school',
  'signup.subtitle': 'Free while we are in beta.',
  'signup.school_name': 'School name',
  'signup.address': 'Web address',
  'signup.address_help': 'This is where your staff and parents will sign in.',
  'signup.address_checking': 'Checking…',
  'signup.address_available': 'Available.',
  'signup.timezone': 'Timezone',
  'signup.currency': 'Currency',
  'signup.admin_heading': 'Your account',
  'signup.first_name': 'First name',
  'signup.username': 'Username',
  'signup.username_help': 'You will sign in as {identifier}',
  'signup.contact_email': 'Contact email (optional)',
  'signup.contact_email_help': 'Where we send password resets. Not your login.',
  'signup.last_name': 'Last name',
  'signup.submit': 'Create school',
  'signup.submitting': 'Creating…',
  'signup.done.title': 'Your school is ready',
  'signup.done.body': 'Sign in at {url}. Bookmark it — that is your school\'s address from now on.',
  'signup.have_account': 'Already have an account?',
  'error.signup.closed': 'Signups are closed at the moment.',
  'error.signup.slug_taken': 'That address is already taken.',
  'error.signup.email_taken': 'An account with that email already exists at this school.',
  'validation.slug_unavailable': 'Use 2–40 letters, numbers or hyphens. Some names are reserved.',

  // ── Platform console ──────────────────────────────────────────────────────
  'admin.sign_in.title': 'Platform sign in',
  'admin.signups.title': 'Beta signups',
  'admin.signups.open': 'Open — any school can sign itself up.',
  'admin.signups.closed': 'Closed — new signups are refused.',
  'admin.signups.help': 'Existing schools are unaffected either way.',
  'admin.signups.close': 'Close signups',
  'admin.signups.open_action': 'Open signups',
  'admin.schools.title': 'Schools',
  'admin.schools.school': 'School',
  'admin.schools.plan': 'Plan',
  'admin.schools.users': 'Users',
  'admin.schools.students': 'Students',
  'admin.schools.status': 'Status',
  'admin.schools.active': 'Active',
  'admin.schools.suspended': 'Suspended',
  'admin.schools.empty': 'No schools yet. The first signup will appear here.',
  'admin.users.title': 'Users',
  'admin.users.all_schools': 'All schools',

  // ── Validation ────────────────────────────────────────────────────────────
  'validation.required': 'This is required.',
  'validation.email': 'Enter a valid email address.',
  'validation.password.too_short': 'Use at least 12 characters.',
  'validation.username': 'Use letters, numbers, dots, hyphens or underscores.',
  'validation.school_slug': 'Use lowercase letters, numbers and hyphens.',

  // ── Shell ─────────────────────────────────────────────────────────────────
  'app.name': 'hamro.school',
  'nav.group.today': 'Today',
  'nav.group.accounts': 'Accounts',
  'nav.group.school': 'School',
  'nav.attendance': 'Attendance',
  'nav.homework': 'Homework',
  'nav.timetable': 'Timetable',
  'nav.notices': 'Notices',
  'nav.fees': 'Fees & dues',
  'nav.students': 'Students',
  'nav.staff': 'Staff',
  'nav.exams': 'Exams',
  'nav.settings': 'Settings',

  // ── Roles. Shown wherever a person's role is named. ────────────────────────
  'role.SCHOOL_ADMIN': 'School admin',
  'role.ACCOUNTS': 'Accounts',
  'role.TEACHER': 'Teacher',
  'role.PARENT': 'Parent',
  'role.STUDENT': 'Student',
  'role.DRIVER': 'Driver',

  // ── Attendance vocabulary. Used by web and, later, the Flutter app. ────────
  'attendance.status.PRESENT': 'Present',
  'attendance.status.ABSENT_UNEXPLAINED': 'Absent',
  'attendance.status.ABSENT_APPROVED': 'Absent — approved',
  'attendance.status.LATE': 'Late',
  'attendance.status.PRESENT.short': 'P',
  'attendance.status.ABSENT_UNEXPLAINED.short': 'A',
  'attendance.status.ABSENT_APPROVED.short': 'L',
  'attendance.status.LATE.short': 'T',

  // ── Nothing-here states. Invitations, not dead ends. ───────────────────────
  'empty.generic': 'Nothing here yet.',
} as const;

export type MessageKey = keyof typeof en;
export type Catalogue = Record<MessageKey, string>;
