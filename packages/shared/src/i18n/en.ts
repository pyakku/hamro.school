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
  'auth.sign_in.school_placeholder': 'greenhill',
  'auth.sign_in.school_help': 'The name in your school’s web address.',
  'auth.sign_in.email': 'Email',
  'auth.sign_in.password': 'Password',
  'auth.sign_in.submit': 'Sign in',
  'auth.sign_in.submitting': 'Signing in…',
  'auth.sign_in.forgot': 'Forgotten your password?',
  'auth.sign_out': 'Sign out',
  'auth.signed_in_as': 'Signed in as',

  // ── Validation ────────────────────────────────────────────────────────────
  'validation.required': 'This is required.',
  'validation.email': 'Enter a valid email address.',
  'validation.password.too_short': 'Use at least 12 characters.',
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
