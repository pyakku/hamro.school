import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from './lib/i18n.js';
import { SessionProvider, useSession } from './lib/session.js';
import SignIn from './routes/sign-in.js';
import Signup from './routes/signup.js';
import Admin from './routes/admin.js';
import { AppShell } from './shell/AppShell.js';
import Overview from './routes/overview.js';
import Attendance from './routes/attendance.js';
import Homework from './routes/homework.js';
import Notices from './routes/notices.js';
import Timetable from './routes/timetable.js';
import Students from './routes/students.js';
import Children from './routes/children.js';
import Staff from './routes/staff.js';
import StaffAttendance from './routes/staff-attendance.js';
import Exams from './routes/exams.js';
import Fees from './routes/fees.js';
import Payments from './routes/payments.js';
import Settings from './routes/settings.js';
import Setup from './routes/setup.js';
import { isPlatformConsole } from './lib/tenant.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A school's data changes on human timescales. Refetching a register
      // every time someone alt-tabs is noise, and on a phone it is battery.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  // admin.<domain> is a different application with a different identity system.
  // It deliberately does not mount SessionProvider: there is no school session
  // here to widen, and nothing to accidentally inherit.
  if (isPlatformConsole) {
    return (
      <QueryClientProvider client={queryClient}>
        <LocaleProvider locale="en">
          <Admin />
        </LocaleProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <LocalisedRoutes />
      </SessionProvider>
    </QueryClientProvider>
  );
}

/**
 * The locale follows the signed-in user, falling back to their school's
 * default and then to English. Sits inside SessionProvider because it needs
 * to know who is here.
 */
function LocalisedRoutes() {
  const { user, isLoading } = useSession();

  if (isLoading) {
    return (
      <div
        className="flex min-h-full items-center justify-center font-mono text-[11px] tracking-[0.12em] text-ink-45 uppercase"
        role="status"
      >
        …
      </div>
    );
  }

  return (
    <LocaleProvider locale={user?.locale ?? 'en'}>
      <BrowserRouter>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/signup" element={<Signup />} />

          {/*
            Everything behind the shell. The routes exist for every role; what
            a person may actually load is decided by the server, per request.
            The rail hides links a user has no use for, which is a courtesy —
            typing the path directly gets the same 403 either way.
          */}
          <Route element={<AppShell />}>
            <Route path="/" element={<Overview />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/homework" element={<Homework />} />
            <Route path="/notices" element={<Notices />} />
            <Route path="/timetable" element={<Timetable />} />
            <Route path="/children" element={<Children />} />
            <Route path="/students" element={<Students />} />
            <Route path="/staff" element={<Staff />} />
            <Route path="/staff-attendance" element={<StaffAttendance />} />
            <Route path="/exams" element={<Exams />} />
            <Route path="/fees" element={<Fees />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </LocaleProvider>
  );
}
