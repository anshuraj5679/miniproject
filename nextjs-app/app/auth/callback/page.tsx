'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/store/auth-store'
import type { UserType } from '@/lib/types'

function generateCustomId(type: UserType): string {
  const prefix = type === 'consumer' ? 'CON' : 'MER'
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${prefix}-${timestamp}-${random}`
}

function stableIdSeed(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const unsigned = hash >>> 0
  return unsigned.toString(36).toUpperCase().padStart(7, '0').slice(0, 7)
}

function generateStableCustomId(type: UserType, email: string, userId: string): string {
  const prefix = type === 'consumer' ? 'CON' : 'MER'
  const normalizedEmail = email.trim().toLowerCase()
  const stable = stableIdSeed(`${type}:${normalizedEmail}:${userId}`)
  return `${prefix}-${stable}`
}

function fallbackName(email: string): string {
  const [local] = email.split('@')
  return local || 'SafeBill User'
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-indigo-500 border-t-transparent mb-4" />
        <p className="text-slate-600 dark:text-slate-400 font-medium">{message}</p>
      </div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  const router = useRouter()
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
      <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl max-w-md w-full">
        <div className="text-center">
          <div className="text-red-500 text-4xl mb-4">!</div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Sign-in failed</h1>
          <p className="text-slate-600 dark:text-slate-400 mb-6">{message}</p>
          <button
            onClick={() => router.push('/landing')}
            className="bg-indigo-500 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-600 transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    </div>
  )
}

function AuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setAuth } = useAuthStore()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isActive = true
    let unsubscribe: (() => void) | null = null

    const requestedUserType =
      (searchParams.get('user_type') || localStorage.getItem('login_user_type') || 'consumer') === 'merchant'
        ? 'merchant'
        : 'consumer'
    localStorage.removeItem('login_user_type')

    const finalizeSession = async (session: Session) => {
      const user = session.user
      const userEmail = (user.email || '').trim().toLowerCase()
      const defaultName = user.user_metadata?.full_name || user.user_metadata?.name || fallbackName(userEmail)
      const baseProfileQuery = 'id, user_id, email, custom_id, full_name, user_type, created_at'

      const { data: byUserId, error: byUserIdError } = await supabase
        .from('user_profiles')
        .select(baseProfileQuery)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (byUserIdError) {
        throw byUserIdError
      }

      let existingProfile = byUserId
      if (!existingProfile && userEmail) {
        const { data: byEmail, error: byEmailError } = await supabase
          .from('user_profiles')
          .select(baseProfileQuery)
          .eq('email', userEmail)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (byEmailError) {
          throw byEmailError
        }
        existingProfile = byEmail
      }

      const resolvedUserType = (existingProfile?.user_type || requestedUserType) as UserType
      const stableFallbackId = generateStableCustomId(resolvedUserType, userEmail, user.id)
      const resolvedCustomId =
        existingProfile?.custom_id ||
        user.user_metadata?.custom_id ||
        stableFallbackId ||
        generateCustomId(resolvedUserType)
      const resolvedName = existingProfile?.full_name || defaultName

      if (!existingProfile) {
        const { error: insertError } = await supabase.from('user_profiles').insert({
          user_id: user.id,
          custom_id: resolvedCustomId,
          email: userEmail,
          full_name: resolvedName,
          user_type: resolvedUserType,
        })
        if (insertError) {
          // Handle race/duplicate case: fetch existing profile by email and continue.
          const { data: retryProfile, error: retryError } = await supabase
            .from('user_profiles')
            .select(baseProfileQuery)
            .eq('email', userEmail)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()
          if (retryError || !retryProfile) {
            throw insertError
          }
          existingProfile = retryProfile
        }
      }

      if (existingProfile) {
        const profilePatch: Record<string, string> = {}
        if (!existingProfile.custom_id) {
          profilePatch.custom_id = resolvedCustomId
        }
        if (!existingProfile.full_name) {
          profilePatch.full_name = resolvedName
        }
        if (!existingProfile.user_type) {
          profilePatch.user_type = resolvedUserType
        }
        if (!existingProfile.user_id || existingProfile.user_id !== user.id) {
          profilePatch.user_id = user.id
        }
        if (!existingProfile.email || existingProfile.email.toLowerCase() !== userEmail) {
          profilePatch.email = userEmail
        }

        if (Object.keys(profilePatch).length > 0) {
          const { error: updateError } = await supabase
            .from('user_profiles')
            .update(profilePatch)
            .eq('id', existingProfile.id)
          if (updateError) {
            throw updateError
          }
        }
      }

      await supabase.auth.updateUser({
        data: {
          full_name: resolvedName,
          user_type: resolvedUserType,
          custom_id: resolvedCustomId,
        },
      })
      const { data: refreshedSessionData } = await supabase.auth.refreshSession()
      const activeSession = refreshedSessionData.session || session

      if (!isActive) return
      await setAuth(
        {
          userId: user.id,
          email: userEmail,
          name: resolvedName,
          userType: resolvedUserType,
          customId: resolvedCustomId,
        },
        activeSession.access_token
      )

      router.push(resolvedUserType === 'merchant' ? '/merchant-dashboard' : '/locker')
    }

    const handleCallback = async () => {
      try {
        const errorParam = searchParams.get('error')
        const errorDescription = searchParams.get('error_description')
        if (errorParam) {
          throw new Error(errorDescription || errorParam)
        }

        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) {
          throw sessionError
        }
        if (data?.session) {
          await finalizeSession(data.session)
          return
        }

        const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_IN' && session) {
            await finalizeSession(session)
          }
        })
        unsubscribe = () => listener.subscription.unsubscribe()
      } catch (callbackError) {
        if (!isActive) return
        setError(callbackError instanceof Error ? callbackError.message : 'Authentication failed')
      }
    }

    handleCallback()
    return () => {
      isActive = false
      if (unsubscribe) unsubscribe()
    }
  }, [router, searchParams, setAuth])

  if (error) {
    return <ErrorState message={error} />
  }
  return <LoadingState message="Completing sign in..." />
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingState message="Loading..." />}>
      <AuthCallbackContent />
    </Suspense>
  )
}
