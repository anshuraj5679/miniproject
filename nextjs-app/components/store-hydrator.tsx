'use client'

import { useEffect } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { refreshAccessToken } from '@/lib/auth-client'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { useAuthStore } from '@/lib/store/auth-store'

// Supabase access tokens expire after ~1 hour. supabase-js refreshes its own session;
// mirror each new token into the store, localStorage and the sb_access_token cookie
// that the /api/* proxy routes forward to the backend.
function syncToken(token: string | null | undefined) {
  const { user, token: current, setToken } = useAuthStore.getState()
  if (!user || !token || token === current) return
  void setToken(token)
}

export function StoreHydrator() {
  useEffect(() => {
    void Promise.resolve(useAuthStore.persist.rehydrate())
      .then(() => (useAuthStore.getState().user ? refreshAccessToken() : null))
      .then(syncToken)
      .catch(() => undefined)

    const supabase = getSupabaseBrowserClient()
    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session) {
        syncToken(session.access_token)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  return null
}
