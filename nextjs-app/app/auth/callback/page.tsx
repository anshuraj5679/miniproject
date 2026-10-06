'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/lib/store/auth-store'
import type { UserType } from '@/lib/types'
import type { CognitoAuthResult } from '@/lib/cognito'
import { useRef } from 'react'

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

function decodeStateUserType(encoded: string | null): UserType | null {
  if (!encoded) return null
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const decoded = typeof window !== 'undefined' ? atob(padded) : ''
    const parsed = JSON.parse(decoded) as { userType?: string }
    return parsed.userType === 'merchant' ? 'merchant' : parsed.userType === 'consumer' ? 'consumer' : null
  } catch {
    return null
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const found = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  if (!found) return null
  return found.substring(name.length + 1) || null
}

function readPersistedUserType(): UserType {
  const cookieType = readCookie('sb_user_type')
  if (cookieType === 'merchant') return 'merchant'
  if (typeof window === 'undefined') return 'consumer'
  try {
    const raw = localStorage.getItem('auth-storage')
    if (!raw) return 'consumer'
    const parsed = JSON.parse(raw) as { state?: { user?: { userType?: string } } }
    return parsed?.state?.user?.userType === 'merchant' ? 'merchant' : 'consumer'
  } catch {
    return 'consumer'
  }
}

function hasSessionToken(): boolean {
  if (readCookie('sb_access_token')) return true
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem('auth-storage')
    if (!raw) return false
    const parsed = JSON.parse(raw) as { state?: { token?: string | null } }
    return Boolean(String(parsed?.state?.token || '').trim())
  } catch {
    return false
  }
}

function AuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setAuth } = useAuthStore()
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)
  const goToPostLogin = useCallback((type: UserType) => {
    const target = type === 'merchant' ? '/merchant-dashboard' : '/locker'
    router.replace(target)
  }, [router])

  useEffect(() => {
    let isMounted = true

    const handleCallback = async () => {
      try {
        if (startedRef.current) return
        startedRef.current = true

        const errorParam = searchParams.get('error')
        const errorDescription = searchParams.get('error_description')
        if (errorParam) {
          throw new Error(errorDescription || errorParam)
        }

        const code = String(searchParams.get('code') || '').trim()
        if (!code) {
          throw new Error('Authorization code missing in callback URL.')
        }

        const lockKey = `sb_cognito_exchange_state_${code}`
        if (typeof window !== 'undefined') {
          const existingState = sessionStorage.getItem(lockKey)
          if (existingState === 'done') {
            if (hasSessionToken()) {
              goToPostLogin(readPersistedUserType())
              return
            }
          }
          if (existingState === 'inflight') {
            const waitStart = Date.now()
            while (Date.now() - waitStart < 4000) {
              await new Promise((resolve) => setTimeout(resolve, 200))
              if (hasSessionToken()) {
                goToPostLogin(readPersistedUserType())
                return
              }
            }
            sessionStorage.removeItem(lockKey)
          }
          sessionStorage.setItem(lockKey, 'inflight')
        }

        const stateType = decodeStateUserType(searchParams.get('state'))
        const localType = localStorage.getItem('login_user_type')
        const requestedUserType: UserType =
          stateType || (localType === 'merchant' ? 'merchant' : 'consumer')
        localStorage.removeItem('login_user_type')

        const exchangeResponse = await fetch('/api/auth/cognito/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            userType: requestedUserType,
          }),
          signal: AbortSignal.timeout(15000),
        }).catch((fetchError) => {
          if (fetchError instanceof Error && fetchError.name === 'TimeoutError') {
            throw new Error('Sign-in request timed out. Please try login again.')
          }
          throw fetchError
        })
        const exchangeData = (await exchangeResponse.json().catch(() => null)) as (CognitoAuthResult & { error?: string }) | null
        const sessionToken = String(exchangeData?.idToken || exchangeData?.accessToken || '').trim()
        if (!exchangeResponse.ok || !sessionToken || !exchangeData?.user?.userId) {
          const exchangeError = String(exchangeData?.error || 'Authentication failed').trim()
          if (hasSessionToken()) {
            sessionStorage.setItem(lockKey, 'done')
            goToPostLogin(readPersistedUserType())
            return
          }
          if (typeof window !== 'undefined') sessionStorage.removeItem(lockKey)
          throw new Error(exchangeError)
        }

        await setAuth(
          {
            userId: exchangeData.user.userId,
            email: exchangeData.user.email,
            phone: exchangeData.user.phone,
            loginId: exchangeData.user.loginId,
            name: exchangeData.user.name,
            userType: exchangeData.user.userType,
            customId: exchangeData.user.customId,
            picture: exchangeData.user.picture,
            provider: exchangeData.user.provider,
          },
          sessionToken
        )

        document.cookie = `sb_access_token=${sessionToken}; path=/; max-age=${60 * 60 * 24 * 7}`
        document.cookie = `sb_user_type=${exchangeData.user.userType}; path=/; max-age=${60 * 60 * 24 * 7}`
        if (typeof window !== 'undefined') sessionStorage.setItem(lockKey, 'done')

        goToPostLogin(exchangeData.user.userType === 'merchant' ? 'merchant' : 'consumer')
      } catch (callbackError) {
        if (!isMounted) return
        setError(callbackError instanceof Error ? callbackError.message : 'Authentication failed')
      }
    }

    handleCallback()
    return () => {
      isMounted = false
    }
  }, [goToPostLogin, searchParams, setAuth])

  if (error) return <ErrorState message={error} />
  return <LoadingState message="Completing sign in..." />
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingState message="Loading..." />}>
      <AuthCallbackContent />
    </Suspense>
  )
}
