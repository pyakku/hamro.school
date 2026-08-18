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
  'error.setup.end_before_start': 'The end date cannot be before the start date.',
  'error.setup.name_taken': 'Something with that name already exists.',
  'error.setup.in_use':
    'That is in use and cannot be removed. Rename it, or remove what uses it first.',
  'error.attendance.closed_day':
    'The school was closed that day, so there is no register to take. Nobody is marked absent.',
  'error.attendance.incomplete': 'Mark every student before saving.',
  'error.attendance.locked': 'That day is locked. Ask the office to amend it.',
  'error.attendance.amend_reason': 'Say why you are changing a locked day.',
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
  'shell.skip_to_content': 'Skip to content',
  'shell.main_nav': 'Main navigation',
  'shell.open_menu': 'Menu',
  'shell.close_menu': 'Close',
  'shell.account': 'Your account',
  'shell.loading': 'Loading',

  // The topbar. The date is always on screen — half of school work is
  // date-dependent, and "which day am I looking at" should never be a guess.
  'shell.term': 'Term',
  'shell.between_terms': 'Between terms',
  'shell.no_year': 'No academic year set up',

  'nav.group.today': 'Today',
  'nav.group.accounts': 'Accounts',
  'nav.group.school': 'School',
  'nav.overview': 'Overview',
  'nav.attendance': 'Attendance',
  'nav.homework': 'Homework',
  'nav.timetable': 'Timetable',
  'nav.notices': 'Notices',
  'nav.fees': 'Fees & dues',
  'nav.payments': 'Payments',
  'nav.children': 'My children',
  'nav.students': 'Students',
  'nav.staff': 'Staff',
  'nav.exams': 'Exams & marks',
  'nav.report_cards': 'Report cards',
  'nav.settings': 'Settings',

  // ── The overview. What each role sees on landing. ─────────────────────────
  'home.greeting': 'Good morning, {name}',
  'home.greeting_afternoon': 'Good afternoon, {name}',
  'home.greeting_evening': 'Good evening, {name}',

  'home.school.title': 'The school today',
  'home.school.students': 'Students enrolled',
  'home.school.sections': 'Sections',
  'home.school.staff': 'Staff',
  'home.school.grade_levels': 'Grade levels',

  'home.registers.title': 'Registers',
  'home.registers.taken': 'Taken',
  'home.registers.outstanding': 'Still owed',
  'home.registers.expected': 'of {count} expected',
  'home.registers.all_in': 'Every register is in. Nothing outstanding today.',
  'home.registers.none_expected':
    'No registers today — the school is closed. Nothing counts against attendance.',
  'home.registers.present': 'Present',
  'home.registers.absent': 'Absent',
  'home.registers.late': 'Late',
  'home.registers.approved': 'On approved leave',

  'home.my_sections.title': 'Your classes',
  'home.my_sections.register_taken': 'Register in',
  'home.my_sections.register_due': 'Register due',
  'home.my_sections.take': 'Take the register',
  'home.my_sections.students': '{count} students',
  'home.my_sections.students.one': 'One student',
  'home.my_sections.empty':
    'You have no classes this year yet. The office assigns them — ask them to add yours.',

  'home.children.title': 'Your children',
  'home.children.today': 'Today',
  'home.children.term_attendance': 'This term',
  'home.children.dues': 'Due',
  'home.children.no_register': 'Register not taken yet',
  'home.children.empty':
    'No children are linked to your account yet. The school office can link them.',

  'home.timetable.title': "Today's periods",
  'home.timetable.empty': 'No periods today.',
  'home.timetable.free': 'Free',

  'home.attendance.title': 'Your attendance',
  'home.attendance.present_days': 'Days present',
  'home.attendance.of_days': 'of {count} school days',

  'home.fees.title': 'Fees',
  'home.fees.invoiced': 'Invoiced',
  'home.fees.collected': 'Collected',
  'home.fees.outstanding': 'Outstanding',
  'home.fees.overdue_count': '{count} invoices overdue',
  'home.fees.overdue_count.one': 'One invoice overdue',
  'home.fees.overdue_none': 'Nothing overdue.',
  'home.fees.my_outstanding': 'Your balance',
  'home.fees.settled': 'Nothing due. Thank you.',

  'home.notices.title': 'Notices',
  'home.notices.empty': 'No notices yet. The school posts them here.',
  'home.notices.view_all': 'All notices',

  'home.driver.title': 'Your day',
  'home.driver.body':
    'Route and bus tracking are not switched on for this school. Notices from the office appear below.',

  // ── Pages ─────────────────────────────────────────────────────────────────
  'page.attendance.title': 'Attendance',
  'page.attendance.subtitle': 'Registers by section and day.',
  'page.attendance.pick_section': 'Choose a class to see its register.',
  'page.attendance.not_taken':
    'No register for this day. Nothing is marked absent — a day without a register does not count.',
  'page.attendance.closed': 'The school was closed on this day: {reason}',
  'page.attendance.summary': '{present} present · {absent} absent · {late} late',
  'page.attendance.rate': 'Attendance',
  'page.attendance.empty': 'No registers yet this term.',

  // Taking the register. Buttons name the action; the same word runs through
  // the whole flow — "Save attendance" produces "Attendance saved".
  'attendance.take': 'Take the register',
  'attendance.save': 'Save attendance',
  'attendance.saving': 'Saving…',
  'attendance.saved': 'Attendance saved',
  'attendance.saved_detail': '{present} present · {absent} absent · {late} late',
  'attendance.saved_notify': '{count} guardians would be notified of an absence.',
  'attendance.saved_notify.one': 'One guardian would be notified of an absence.',
  'attendance.unsaved': 'Unsaved',
  'attendance.all_present': 'Everyone present',
  'attendance.reset': 'Start again',
  'attendance.amend_title': 'This day is locked',
  'attendance.amend_reason': 'Why are you changing it?',
  'attendance.amend_placeholder': 'Corrected after checking the paper register',
  'attendance.locked_note': 'Locked on {date}. Amending is recorded.',
  'attendance.tap_hint': 'Everyone starts present. Tap only the ones who are not.',

  'page.homework.title': 'Homework',
  'page.homework.subtitle': 'What has been set, and when it is due.',
  'page.homework.due': 'Due {date}',
  'page.homework.set_on': 'Set {date}',
  'page.homework.empty': 'No homework set this week. Post the first one.',
  'page.homework.empty_parent': 'No homework set this week.',

  'page.notices.title': 'Notices',
  'page.notices.subtitle': 'From the school office.',
  'page.notices.audience_school': 'Whole school',
  'page.notices.audience_grade': 'Grade {name}',
  'page.notices.audience_section': '{name}',
  'page.notices.pinned': 'Pinned',
  'page.notices.empty': 'No notices yet. Post the first one.',
  'page.notices.empty_reader': 'No notices yet.',

  'page.timetable.title': 'Timetable',
  'page.timetable.subtitle': 'The week as it is scheduled.',
  'page.timetable.empty': 'No timetable set up for this year yet.',

  'page.students.title': 'Students',
  'page.students.subtitle': 'Everyone enrolled this year.',
  'page.students.count': '{count} enrolled',
  'page.students.search': 'Search by name or roll number',
  'page.students.empty': 'No students yet. Import a spreadsheet to bring a year group in.',
  'page.students.no_match': 'No student matches “{query}”.',

  'nav.staff_attendance': 'Staff attendance',
  'page.staff_attendance.title': 'Staff attendance',
  'page.staff_attendance.subtitle': 'Who was in, and who was not.',
  'page.staff_attendance.empty': 'No staff on the roll yet.',
  'page.staff_attendance.not_taken': 'No return for this day yet.',
  'page.staff_attendance.save': 'Save the return',
  'page.staff_attendance.saved': 'Staff attendance saved',
  'page.staff_attendance.on_leave': 'On approved leave',
  'page.staff_attendance.leave_locked':
    'The office approved leave for this day, so it cannot be changed here.',
  'page.staff_attendance.mine': 'Your attendance',
  'page.staff_attendance.mine_empty': 'Nothing recorded for you today.',

  'page.staff.title': 'Staff',
  'page.staff.subtitle': 'Teachers and office staff.',
  'page.staff.empty': 'No staff added yet. Add the first one.',

  'page.exams.title': 'Exams & marks',
  'page.exams.subtitle': 'Raw marks as entered. Grades are worked out when a report card is run.',
  'page.exams.marks_entered': '{entered} of {total} entered',
  'page.exams.out_of': 'out of {max}',
  'page.exams.not_entered': 'Not entered',
  'page.exams.empty': 'No exams scheduled this term.',
  'page.exams.no_marks': 'No marks entered for this exam yet.',

  // Marks. Note what is missing: no grade, band or percentage appears anywhere
  // in the catalogue, because none of them is ever stored (rule 3).
  'mark.locked': 'Locked',
  'mark.published': 'Published',
  'mark.exempt': 'Exempt',
  'mark.absent': 'Absent',

  'page.fees.title': 'Fees & dues',
  'page.fees.subtitle': 'Invoices, receipts and what is still owed.',
  'page.fees.outstanding_total': 'Outstanding',
  'page.fees.overdue_total': 'Overdue',
  'page.fees.collected_term': 'Collected this term',
  'page.fees.empty': 'No invoices raised yet.',
  'page.fees.my_invoices': 'Your invoices',
  'page.fees.receipt': 'Receipt {number}',
  'page.fees.days_overdue': '{count} days overdue',
  'page.fees.days_overdue.one': 'One day overdue',
  'page.fees.due_on': 'Due {date}',
  'page.fees.paid_on': 'Paid {date}',

  // ── School setup ──────────────────────────────────────────────────────────
  'nav.setup': 'School setup',
  'page.setup.title': 'School setup',
  'page.setup.subtitle': 'Grades, classes, subjects and the calendar.',
  'page.setup.grades': 'Grade levels',
  'page.setup.sections': 'Classes',
  'page.setup.subjects': 'Subjects',
  'page.setup.holidays': 'Holidays & closures',

  'page.setup.grades.empty': 'No grade levels yet. Add the first one.',
  'page.setup.grades.add': 'Add a grade level',
  'page.setup.grades.name': 'Name',
  'page.setup.grades.name_help': 'Whatever the school calls it — Class VI, Year 7, UKG.',
  'page.setup.grades.level': 'Order',
  'page.setup.grades.level_help': 'Lowest first. This is the order children are promoted in.',
  'page.setup.grades.stage': 'Stage',

  'page.setup.sections.empty': 'No classes yet. Add one to a grade level.',
  'page.setup.sections.add': 'Add a class',
  'page.setup.sections.name': 'Name',
  'page.setup.sections.name_help': 'A, Blue, Alpha — whatever goes after the grade.',
  'page.setup.sections.grade': 'Grade level',
  'page.setup.sections.teacher': 'Class teacher',
  'page.setup.sections.no_teacher': 'Not assigned',
  'page.setup.sections.room': 'Room',
  'page.setup.sections.capacity': 'Capacity',
  'page.setup.sections.per_year':
    'Classes belong to this year. Next year gets its own, with its own register.',

  'page.setup.subjects.empty': 'No subjects yet. Add the first one.',
  'page.setup.subjects.add': 'Add a subject',
  'page.setup.subjects.code': 'Code',
  'page.setup.subjects.name': 'Name',
  'page.setup.subjects.examinable': 'Examinable',
  'page.setup.subjects.not_examinable': 'Not examined',
  'page.setup.subjects.offered_to': 'Offered to',
  'page.setup.subjects.offered_none': 'Not offered yet',

  'page.setup.holidays.empty': 'No holidays yet. A day with no register does not count against anyone.',
  'page.setup.holidays.add': 'Add a holiday',
  'page.setup.holidays.name': 'Name',
  'page.setup.holidays.from': 'From',
  'page.setup.holidays.to': 'To',
  'page.setup.holidays.days': '{count} days',
  'page.setup.holidays.days.one': 'One day',
  'page.setup.holidays.note':
    'No attendance is taken on these days, and they leave every percentage rather than counting as absence.',

  'action.add': 'Add',
  'action.adding': 'Adding…',
  'action.cancel': 'Cancel',
  'action.remove': 'Remove',
  'action.save': 'Save',
  'action.saving': 'Saving…',
  'action.edit': 'Edit',
  'setup.removed': 'Removed',
  'setup.added': 'Added',
  'setup.saved': 'Saved',
  'setup.in_use_hint': 'In use — {count} students',

  'page.settings.title': 'Settings',
  'page.settings.subtitle': 'How this school is set up.',
  'page.settings.school': 'School',
  'page.settings.year': 'Academic year',
  'page.settings.terms': 'Terms',
  'page.settings.timezone': 'Timezone',
  'page.settings.currency': 'Currency',
  'page.settings.address': 'Web address',
  'page.settings.your_account': 'Your account',
  'page.settings.roles': 'Roles',
  'page.settings.contact_email': 'Contact email',
  'page.settings.no_contact_email': 'None recorded',

  // ── Column headers. Mono, uppercase, set by the stylesheet. ───────────────
  'column.roll': 'Roll',
  'column.name': 'Name',
  'column.section': 'Class',
  'column.grade': 'Grade',
  'column.status': 'Status',
  'column.date': 'Date',
  'column.due': 'Due',
  'column.amount': 'Amount',
  'column.paid': 'Paid',
  'column.balance': 'Balance',
  'column.invoice': 'Invoice',
  'column.receipt': 'Receipt',
  'column.method': 'Method',
  'column.subject': 'Subject',
  'column.marks': 'Marks',
  'column.period': 'Period',
  'column.time': 'Time',
  'column.teacher': 'Teacher',
  'column.role': 'Role',
  'column.attendance': 'Attendance',
  'column.students': 'Students',
  'column.guardian': 'Guardian',
  'column.contact': 'Contact',

  // ── Status vocabulary ─────────────────────────────────────────────────────
  'invoice.status.DRAFT': 'Draft',
  'invoice.status.ISSUED': 'Issued',
  'invoice.status.PARTIALLY_PAID': 'Part paid',
  'invoice.status.PAID': 'Paid',
  'invoice.status.VOID': 'Void',
  'invoice.status.OVERDUE': 'Overdue',

  'payment.status.RECORDED': 'Recorded',
  'payment.status.BOUNCED': 'Bounced',
  'payment.status.REVERSED': 'Reversed',
  'payment.method.CASH': 'Cash',
  'payment.method.CHEQUE': 'Cheque',
  'payment.method.BANK_TRANSFER': 'Bank transfer',
  'payment.method.OTHER': 'Other',

  'enrolment.status.ACTIVE': 'Enrolled',
  'enrolment.status.COMPLETED': 'Completed',
  'enrolment.status.WITHDRAWN': 'Withdrawn',
  'enrolment.status.TRANSFERRED_OUT': 'Transferred out',

  'staff.status.ACTIVE': 'Active',
  'staff.status.ON_LEAVE': 'On leave',
  'staff.status.RESIGNED': 'Resigned',
  'staff.status.TERMINATED': 'Left',

  'guardian.relation.FATHER': 'Father',
  'guardian.relation.MOTHER': 'Mother',
  'guardian.relation.GUARDIAN': 'Guardian',
  'guardian.relation.OTHER': 'Guardian',

  'weekday.1': 'Monday',
  'weekday.2': 'Tuesday',
  'weekday.3': 'Wednesday',
  'weekday.4': 'Thursday',
  'weekday.5': 'Friday',
  'weekday.6': 'Saturday',
  'weekday.7': 'Sunday',

  // ── Actions ───────────────────────────────────────────────────────────────
  'action.retry': 'Try again',
  'action.view': 'View',
  'action.back': 'Back',
  'action.today': 'Today',
  'action.previous_day': 'Previous day',
  'action.next_day': 'Next day',

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
