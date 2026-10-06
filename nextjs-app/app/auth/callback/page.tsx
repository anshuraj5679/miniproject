'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

import { getSupabaseBrowserClient } from '@/lib/supabase'
import { loadOrClaimProfile, persistClientAuthCookies } from '@/lib/auth-client'
import { useAuthStore } from '@/lib/store/auth-store'
import type { UserType } from '@/lib/types'

export default function AuthCallbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setAuth } = useAuthStore()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const supabase = getSupabaseBrowserClient()
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()

        if (sessionError || !session?.user) {
          throw new Error(sessionError?.message || 'Authentication failed.')
        }

        const userType = (searchParams.get('userType') as UserType) || 'consumer'
        const user = session.user

        // Profile + role are created server-side; a first Google sign-in claims one here.
        const profile = await loadOrClaimProfile(user.id, userType)
        const customId = profile?.custom_id || undefined
        const resolvedUserType = (profile?.user_type as UserType) || userType

        // The role lives in app_metadata; refresh so the access token carries it.
        const { data: refreshed } = await supabase.auth.refreshSession()
        const accessToken = refreshed.session?.access_token || session.access_token

        await setAuth(
          {
            userId: user.id,
            email: user.email,
            name: profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || 'User',
            userType: resolvedUserType,
            customId,
            picture: user.user_metadata?.avatar_url,
            provider: user.app_metadata?.provider || 'google',
          },
          accessToken
        )

        persistClientAuthCookies(accessToken, resolvedUserType)
        router.push(resolvedUserType === 'merchant' ? '/merchant-dashboard' : '/locker')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Authentication failed.')
      }
    }

    handleCallback()
  }, [router, searchParams, setAuth])

  if (error) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="card bg-base-100 shadow-xl border border-error max-w-md w-full">
          <div className="card-body text-center">
            <h2 className="text-xl font-bold text-error">Authentication Failed</h2>
            <p className="text-base-content/60 text-sm mt-2">{error}</p>
            <button onClick={() => router.push('/login')} className="btn btn-primary mt-4">
              Back to Login
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        <p className="text-base-content/60 mt-4">Completing sign in...</p>
      </div>
    </div>
  )
}
