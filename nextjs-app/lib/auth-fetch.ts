import { refreshAccessToken } from '@/lib/auth-client'
import { useAuthStore } from '@/lib/store/auth-store'

function withAuthHeader(init: RequestInit, token: string | null): RequestInit {
  if (!token) return init
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return { ...init, headers }
}

/**
 * fetch() for the app's own /api routes. On a 401 (usually an expired Supabase
 * access token) it refreshes the session once and retries with the new token.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const requestInit: RequestInit = { credentials: 'include', ...init }
  const response = await fetch(input, requestInit)
  if (response.status !== 401 || typeof window === 'undefined') return response

  const freshToken = await refreshAccessToken().catch(() => null)
  if (!freshToken) return response
  await useAuthStore.getState().setToken(freshToken)
  return fetch(input, withAuthHeader(requestInit, freshToken))
}
