'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn, ShieldCheck } from 'lucide-react'
import { ThemeToggle } from './theme-toggle'
import { useAuthStore } from '@/lib/store/auth-store'
import { useGsapReveal } from '@/lib/gsap-helpers'
import { supabase } from '@/lib/supabase'

type UserType = 'consumer' | 'merchant'

interface LookupApiResponse {
  userId?: string
  email?: string
  fullName?: string
  userType?: UserType
  customId?: string
  error?: string
}

export function LandingScreen() {
  const router = useRouter()
  const { setAuth } = useAuthStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const [userType, setUserType] = useState<UserType>('consumer')
  const [customId, setCustomId] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useGsapReveal(rootRef, [userType, loading, error])

  const handleLogin = async () => {
    if (!customId.trim() || !password.trim()) {
      setError('Please enter your ID and password.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const normalizedCustomId = customId.trim().toUpperCase()
      let resolvedEmail = ''
      let resolvedType: UserType = userType
      let resolvedCustomId = normalizedCustomId
      let resolvedName = ''

      const lookupResponse = await fetch('/api/auth/lookup-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customId: normalizedCustomId, userType }),
      })
      const lookupData = (await lookupResponse.json().catch(() => null)) as LookupApiResponse | null

      if (lookupResponse.ok && lookupData?.email) {
        resolvedEmail = lookupData.email
        resolvedType = (lookupData.userType || userType) as UserType
        resolvedCustomId = lookupData.customId || normalizedCustomId
        resolvedName = lookupData.fullName || ''
      } else {
        const idField = userType === 'consumer' ? 'consumer_id' : 'merchant_id'
        const { data: legacyProfile, error: legacyLookupError } = await supabase
          .from('profiles')
          .select('id, email, name, user_type, consumer_id, merchant_id')
          .eq(idField, normalizedCustomId)
          .single()

        if (legacyLookupError || !legacyProfile?.email) {
          throw new Error(`No account found for this ${userType} ID.`)
        }

        resolvedEmail = String(legacyProfile.email)
        resolvedType = ((legacyProfile.user_type as UserType | null) || userType) as UserType
        resolvedCustomId =
          String(legacyProfile.consumer_id || legacyProfile.merchant_id || '').trim() || normalizedCustomId
        resolvedName = String(legacyProfile.name || '').trim()
      }

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: resolvedEmail,
        password,
      })
      if (authError) throw authError

      const userId = authData.user?.id
      if (!userId) throw new Error('Login failed.')
      const sessionToken = authData.session?.access_token || ''

      const { data: currentProfile } = await supabase
        .from('user_profiles')
        .select('custom_id, full_name, user_type')
        .eq('user_id', userId)
        .maybeSingle()

      if (currentProfile) {
        resolvedType = (currentProfile.user_type as UserType | null) || resolvedType
        resolvedCustomId = currentProfile.custom_id || resolvedCustomId
        resolvedName = currentProfile.full_name || resolvedName
      } else {
        try {
          await supabase.from('user_profiles').insert({
            user_id: userId,
            custom_id: resolvedCustomId,
            email: resolvedEmail,
            full_name: resolvedName || authData.user?.user_metadata?.name || resolvedEmail.split('@')[0] || 'User',
            user_type: resolvedType,
          })
        } catch {
          // Ignore profile repair failures; session is already valid.
        }
      }

      await setAuth(
        {
          userId,
          email: authData.user?.email || resolvedEmail,
          userType: resolvedType,
          customId: resolvedCustomId || undefined,
          name: resolvedName || authData.user?.user_metadata?.name || '',
        },
        sessionToken
      )

      if (sessionToken) {
        document.cookie = `sb_access_token=${sessionToken}; path=/; max-age=${60 * 60 * 24 * 7}`
      }
      document.cookie = `sb_user_type=${resolvedType}; path=/; max-age=${60 * 60 * 24 * 7}`

      router.push(resolvedType === 'merchant' ? '/merchant-dashboard' : '/locker')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError(null)
    try {
      localStorage.setItem('login_user_type', userType)
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback?user_type=${userType}` },
      })
      if (oauthError) throw oauthError
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
      setLoading(false)
    }
  }

  return (
    <div ref={rootRef} className="min-h-screen bg-base-200 flex flex-col">
      <div data-gsap="hero" className="navbar bg-base-100/80 backdrop-blur-md sticky top-0 z-50 border-b border-base-300">
        <div className="flex-1">
          <button onClick={() => router.push('/')} className="btn btn-ghost text-xl gap-2 normal-case">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <span className="font-bold">SafeBill</span>
          </button>
        </div>
        <div className="flex-none">
          <ThemeToggle />
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div data-gsap="card" className="card bg-base-100 shadow-2xl w-full max-w-md border border-base-300">
          <div className="card-body gap-6">
            <div data-gsap="hero" className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <LogIn className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold">Welcome back</h1>
              <p className="text-sm text-base-content/60 mt-1">Sign in to manage your warranties</p>
            </div>

            <div data-gsap="card" className="tabs tabs-boxed bg-base-200 p-1">
              <button
                className={`tab flex-1 ${userType === 'consumer' ? 'tab-active' : ''}`}
                onClick={() => {
                  setUserType('consumer')
                  setError(null)
                }}
              >
                Consumer
              </button>
              <button
                className={`tab flex-1 ${userType === 'merchant' ? 'tab-active' : ''}`}
                onClick={() => {
                  setUserType('merchant')
                  setError(null)
                }}
              >
                Merchant
              </button>
            </div>

            {error && (
              <div className="alert alert-error text-sm">
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-4">
              <div data-gsap="card" className="form-control">
                <label className="label">
                  <span className="label-text font-medium">
                    {userType === 'consumer' ? 'Consumer ID' : 'Merchant ID'}
                  </span>
                </label>
                <input
                  type="text"
                  placeholder={userType === 'consumer' ? 'e.g. CON-XXXXXX' : 'e.g. MER-XXXXXX'}
                  value={customId}
                  onChange={(e) => setCustomId(e.target.value)}
                  className="input input-bordered w-full"
                />
              </div>

              <div data-gsap="card" className="form-control">
                <label className="label">
                  <span className="label-text font-medium">Password</span>
                </label>
                <input
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  className="input input-bordered w-full"
                />
              </div>

              <button
                onClick={handleLogin}
                disabled={loading}
                data-gsap-hover="lift"
                className="btn btn-primary w-full"
              >
                {loading ? <span className="loading loading-spinner loading-sm"></span> : 'Sign In'}
              </button>
            </div>

            <div className="divider text-xs text-base-content/40">OR</div>

            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              data-gsap-hover="lift"
              className="btn btn-outline w-full gap-2"
            >
              Continue with Google
            </button>

            <p className="text-center text-sm text-base-content/60">
              Don&apos;t have an account?{' '}
              <button
                onClick={() => router.push('/signup')}
                className="link link-primary font-semibold"
              >
                Create one
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
