export class ApiError extends Error {
  status: number
  /** Machine-readable hint from the backend, e.g. 'EMAIL_NOT_VERIFIED'. */
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Single place that decides which API version the whole frontend talks to.
 * Callers pass version-agnostic paths ('/auth/login'), never '/api/...'.
 * In dev, Vite proxies /api -> localhost:8081; in production,
 * frontend/vercel.json rewrites /api/* to the backend deployment. Both pass the
 * rest of the path through unchanged, so the version segment survives.
 */
export const API_BASE = '/api/v1'

/** Endpoints that must never trigger the refresh-and-retry cycle. */
const NO_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/me']

/**
 * Access tokens are short-lived, so any authenticated request can fail with a
 * 401 simply because the token aged out. Rather than bouncing the user to the
 * login screen, we transparently refresh once and replay the request.
 *
 * A single shared promise de-duplicates concurrent refreshes: if three requests
 * 401 at the same moment, only one /auth/refresh call is made and all three wait
 * on it. Without this, parallel refreshes would rotate the token repeatedly and
 * the backend's reuse detection would (correctly) kill the session.
 */
let refreshInFlight: Promise<boolean> | null = null

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

async function rawRequest(path: string, options: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await rawRequest(path, options)

  if (res.status === 401 && !NO_REFRESH_PATHS.includes(path)) {
    const refreshed = await refreshSession()
    if (refreshed) {
      res = await rawRequest(path, options)
    }
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.code)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  /** Attempts a session refresh directly; used on app start to restore a session. */
  tryRefresh: refreshSession,
}
