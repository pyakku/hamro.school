import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from './lib/i18n.js';
import { SessionProvider, useSession } from './lib/session.js';
import SignIn from './routes/sign-in.js';
import SignedIn from './routes/signed-in.js';
import Signup from './routes/signup.js';
import Admin from './routes/admin.js';
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
          <Route path="/" element={<SignedIn />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </LocaleProvider>
  );
}
