import type { ApiError, LoginRequest, LoginResponse, SessionUser } from '@hamro/shared';

declare const __API_URL__: string;

/**
 * The API client.
 *
 * The access token lives in a module variable — in memory, gone on refresh.
 * Not localStorage: anything a script can read, an injected script can read,
 * and this token opens a school's records. The long-lived refresh token is an
 * httpOnly cookie the browser sends on its own and no script ever sees.
 *
 * That means a page reload has no session until `/auth/refresh` returns one,
 * which is what `restoreSession` below is for.
 */

let accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    /** i18n key. The API never sends a sentence. */
    readonly key: string,
    readonly code: string,
    readonly fields?: Record<string, string>,
  ) {
    super(`${code} (${status})`);
    this.name = 'ApiRequestError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Internal: stops a refresh loop when the refresh call itself 401s. */
  retryOnUnauthorised?: boolean;
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, retryOnUnauthorised = true } = options;

  let response: Response;
  try {
    response = await fetch(`${__API_URL__}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      // Sends the refresh cookie. The API allows this origin explicitly.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, 'error.network', 'NETWORK');
  }

  // An expired access token is ordinary: refresh once, quietly, and retry. The
  // user should never see a 15-minute token expiring.
  if (
    response.status === 401 &&
    retryOnUnauthorised &&
    path !== '/auth/refresh' &&
    // The platform console holds no refresh cookie: a 401 there is a real
    // expiry, and retrying would clear the school session for no reason.
    !path.startsWith('/platform')
  ) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return rawRequest<T>(path, { ...options, retryOnUnauthorised: false });
    }
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as ApiError | null)?.error;
    throw new ApiRequestError(
      response.status,
      error?.key ?? 'error.generic',
      error?.code ?? 'UNKNOWN',
      error?.fields,
    );
  }

  return payload as T;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const result = await rawRequest<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      retryOnUnauthorised: false,
    });
    setAccessToken(result.accessToken);
    return true;
  } catch {
    setAccessToken(null);
    return false;
  }
}

export const api = {
  get: <T>(path: string) => rawRequest<T>(path),
  post: <T>(path: string, body?: unknown) => rawRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => rawRequest<T>(path, { method: 'PATCH', body }),
};

export async function login(credentials: LoginRequest): Promise<LoginResponse> {
  const result = await api.post<LoginResponse>('/auth/login', credentials);
  setAccessToken(result.accessToken);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    setAccessToken(null);
  }
}

/**
 * Called once at start-up. Trades the refresh cookie for an access token so a
 * reload does not look like a sign-out. Returns null when there is no session,
 * which is not an error — it is most visits.
 */
export async function restoreSession(): Promise<SessionUser | null> {
  const refreshed = await tryRefresh();
  if (!refreshed) return null;
  try {
    const { user } = await api.get<{ user: SessionUser }>('/auth/me');
    return user;
  } catch {
    setAccessToken(null);
    return null;
  }
}
