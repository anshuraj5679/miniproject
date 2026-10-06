'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, ShieldCheck, UserPlus } from 'lucide-react'
import { ThemeToggle } from './theme-toggle'
import { useAuthStore } from '@/lib/store/auth-store'
import { buildHostedUiAuthorizeUrl, type CognitoAuthResult } from '@/lib/cognito'
import { useGsapReveal } from '@/lib/gsap-helpers'

type UserType = 'consumer' | 'merchant'

function buildCustomId(type: UserType): string {
  const prefix = type === 'consumer' ? 'CON' : 'MER'
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix}-${rand}`
}

export function SignupScreen() {
  const router = useRouter()
  const { setAuth } = useAuthStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const [userType, setUserType] = useState<UserType>('consumer')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedId, setGeneratedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useGsapReveal(rootRef, [userType, generatedId, copied, error, loading])

  const handleSignup = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('All fields are required.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const normalizedEmail = email.trim().toLowerCase()
      const customId = buildCustomId(userType)

      const signupResponse = await fetch('/api/auth/cognito/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          name: name.trim(),
          userType,
          customId,
        }),
      })
      const signupPayload = (await signupResponse.json().catch(() => null)) as
        | { userSub?: string; userConfirmed?: boolean; error?: string }
        | null
      if (!signupResponse.ok) {
        throw new Error(signupPayload?.error || 'Signup failed.')
      }

      const loginResponse = await fetch('/api/auth/cognito/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          userType,
          customId,
          name: name.trim(),
        }),
      })
      const loginPayload = (await loginResponse.json().catch(() => null)) as (CognitoAuthResult & { error?: string }) | null

      if (loginResponse.ok && loginPayload?.accessToken && loginPayload.user?.userId) {
        await setAuth(
          {
            userId: loginPayload.user.userId,
            email: normalizedEmail,
            name: loginPayload.user.name || name.trim(),
            userType,
            customId,
            picture: loginPayload.user.picture,
            provider: loginPayload.user.provider,
          },
          loginPayload.accessToken
        )
      }

      setGeneratedId(customId)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signup failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignUp = async () => {
      setLoading(true)
      setError(null)
    try {
      localStorage.setItem('login_user_type', userType)
      const authorizeUrl = buildHostedUiAuthorizeUrl(userType)
      window.location.assign(authorizeUrl)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign-up failed.')
      setLoading(false)
    }
  }

  const copyId = () => {
    if (!generatedId) return
    navigator.clipboard.writeText(generatedId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (generatedId) {
    return (
      <div ref={rootRef} className="min-h-screen bg-base-200 flex items-center justify-center p-4">
        <div data-gsap="card" className="card bg-base-100 shadow-2xl w-full max-w-md border border-base-300">
          <div className="card-body items-center text-center gap-6">
            <div data-gsap="hero" className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-success/10">
              <Check className="w-10 h-10 text-success" />
            </div>
            <div data-gsap="hero">
              <h2 className="text-2xl font-bold">Account Created</h2>
              <p className="text-sm text-base-content/60 mt-2">
                Save your {userType === 'consumer' ? 'Consumer' : 'Merchant'} ID for login.
              </p>
            </div>

            <div className="w-full">
              <div data-gsap="card" className="flex items-center justify-center gap-3 p-4 bg-base-200 rounded-xl">
                <kbd className="kbd kbd-lg font-mono tracking-wider">{generatedId}</kbd>
                <button onClick={copyId} data-gsap-hover="lift" className="btn btn-ghost btn-sm btn-circle">
                  {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              {copied && <p className="text-success text-xs mt-2 font-medium">Copied to clipboard.</p>}
            </div>

            <button
              onClick={() => router.push(userType === 'merchant' ? '/merchant-dashboard' : '/locker')}
              data-gsap-hover="lift"
              className="btn btn-primary w-full"
            >
              Continue to {userType === 'merchant' ? 'Dashboard' : 'SafeBill'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="min-h-screen bg-base-200 flex flex-col">
      <div data-gsap="hero" className="navbar bg-base-100/80 backdrop-blur-md sticky top-0 z-50 border-b border-base-300">
        <div className="flex-1">
          <a className="btn btn-ghost text-xl gap-2 normal-case">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <span className="font-bold">SafeBill</span>
          </a>
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
                <UserPlus className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold">Create Account</h1>
              <p className="text-sm text-base-content/60 mt-1">Start protecting your warranties</p>
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
                  <span className="label-text font-medium">Full Name</span>
                </label>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input input-bordered w-full"
                />
              </div>

              <div data-gsap="card" className="form-control">
                <label className="label">
                  <span className="label-text font-medium">Email</span>
                </label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input input-bordered w-full"
                />
              </div>

              <div data-gsap="card" className="form-control">
                <label className="label">
                  <span className="label-text font-medium">Password</span>
                </label>
                <input
                  type="password"
                  placeholder="Min 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSignup()}
                  className="input input-bordered w-full"
                />
              </div>

              <button onClick={handleSignup} disabled={loading} data-gsap-hover="lift" className="btn btn-primary w-full">
                {loading ? <span className="loading loading-spinner loading-sm"></span> : 'Create Account'}
              </button>
            </div>

            <div className="divider text-xs text-base-content/40">OR</div>

            <button onClick={handleGoogleSignUp} disabled={loading} data-gsap-hover="lift" className="btn btn-outline w-full gap-2">
              Continue with Google
            </button>

            <p className="text-center text-sm text-base-content/60">
              Already have an account?{' '}
              <button onClick={() => router.push('/landing')} className="link link-primary font-semibold">
                Sign in
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
