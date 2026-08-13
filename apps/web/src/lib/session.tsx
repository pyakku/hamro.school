import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginRequest, Permission, Scope, SessionUser } from '@hamro/shared';
import { login as apiLogin, logout as apiLogout, restoreSession } from './api.js';

/**
 * Who is signed in.
 *
 * `can()` exists so the shell can leave out a nav item the user has no use
 * for. It is a courtesy, not a control — every one of these permissions is
 * checked again on the server, per request, per resource. Nothing here is
 * load-bearing for security, and no code should ever treat it as though it is.
 */

interface SessionValue {
  user: SessionUser | null;
  isLoading: boolean;
  signIn: (credentials: LoginRequest) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: Permission) => boolean;
  scopeFor: (permission: Permission) => Scope | null;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: restoreSession,
    // The session comes from an httpOnly cookie the app cannot see, so there
    // is nothing to poll for and no point refetching on window focus.
    staleTime: Infinity,
    retry: false,
  });

  const signInMutation = useMutation({
    mutationFn: apiLogin,
    onSuccess: (result) => queryClient.setQueryData(['session'], result.user),
  });

  const signOutMutation = useMutation({
    mutationFn: apiLogout,
    onSettled: () => {
      queryClient.setQueryData(['session'], null);
      // Nothing from the previous session should survive into the next one,
      // least of all on a shared office computer.
      void queryClient.clear();
    },
  });

  const signIn = useCallback(
    async (credentials: LoginRequest) => {
      await signInMutation.mutateAsync(credentials);
    },
    [signInMutation],
  );

  const signOut = useCallback(async () => {
    await signOutMutation.mutateAsync();
  }, [signOutMutation]);

  const value = useMemo<SessionValue>(() => {
    const grants = user?.permissions ?? [];
    return {
      user: user ?? null,
      isLoading,
      signIn,
      signOut,
      can: (permission) => grants.some((grant) => grant.permission === permission),
      scopeFor: (permission) =>
        grants.find((grant) => grant.permission === permission)?.scope ?? null,
    };
  }, [user, isLoading, signIn, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider.');
  return value;
}
