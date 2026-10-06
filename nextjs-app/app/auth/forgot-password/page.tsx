'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react'

import type { UserType } from '@/lib/types'

interface ForgotPasswordResponse {
  ok?: boolean
  username?: string
  userType?: UserType
  customId?: string
  deliveryDestination?: string
  deliveryMedium?: string
  error?: string
}

function initialUserType(value: string | null): UserType {
  return value === 'merchant' ? 'merchant' : 'consumer'
}

export default function ForgotPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [userType, setUserType] = useState<UserType>(initialUserType(searchParams.get('userType')))
  const [identifier, setIdentifier] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!identifier.trim()) {
      setError('Enter your SafeBill ID, email, or phone number.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/cognito/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier.trim(),
          userType,
        }),
      })
      const payload = (await response.json().catch(() => null)) as ForgotPasswordResponse | null
      if (!response.ok || !payload?.username) {
        throw new Error(payload?.error || 'Could not start password reset.')
      }

      const params = new URLSearchParams({
        username: payload.username,
        userType: payload.userType === 'merchant' ? 'merchant' : 'consumer',
      })
      if (payload.customId) params.set('customId', payload.customId)
      if (payload.deliveryDestination) params.set('deliveryDestination', payload.deliveryDestination)
      if (payload.deliveryMedium) params.set('deliveryMedium', payload.deliveryMedium)

      router.push(`/auth/reset-password?${params.toString()}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not start password reset.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <button
          onClick={() => router.push('/login')}
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-base-content/70 transition hover:text-primary"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to login
        </button>

        <div className="card bg-base-100 shadow-2xl border border-base-300">
          <div className="card-body gap-6">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4 ring-1 ring-primary/20">
                <KeyRound className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold">Forgot password</h1>
              <p className="text-sm text-base-content/60 mt-1">
                Use your SafeBill ID, email, or phone to receive a reset code.
              </p>
            </div>

            <div className="tabs tabs-boxed bg-base-200 p-1">
              <button
                className={`tab flex-1 ${userType === 'consumer' ? 'tab-active font-semibold' : ''}`}
                onClick={() => {
                  setUserType('consumer')
                  setError(null)
                }}
              >
                Consumer
              </button>
              <button
                className={`tab flex-1 ${userType === 'merchant' ? 'tab-active font-semibold' : ''}`}
                onClick={() => {
                  setUserType('merchant')
                  setError(null)
                }}
              >
                Merchant
              </button>
            </div>

            {error ? (
              <div className="alert alert-error text-sm py-2 rounded-lg">
                <span>{error}</span>
              </div>
            ) : null}

            <div className="space-y-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium text-base-content/80">
                    {userType === 'merchant' ? 'Merchant account' : 'Consumer account'}
                  </span>
                </label>
                <input
                  type="text"
                  placeholder={
                    userType === 'merchant'
                      ? 'MER-XXXXXX, merchant@email.com, or +91XXXXXXXXXX'
                      : 'CON-XXXXXX, consumer@email.com, or +91XXXXXXXXXX'
                  }
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleSubmit()}
                  className="input input-bordered w-full focus:input-primary bg-base-50"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={loading}
                className="btn btn-primary w-full shadow-lg shadow-primary/20"
              >
                {loading ? <span className="loading loading-spinner loading-sm"></span> : 'Send reset code'}
              </button>
            </div>

            <div className="rounded-xl bg-base-200 px-4 py-3 text-sm text-base-content/70">
              Password reset codes are sent by Cognito to the verified email or phone on the account.
            </div>

            <div className="text-center text-sm text-base-content/60 space-y-2">
              <p>
                Forgot your {userType === 'merchant' ? 'Merchant ID' : 'Consumer ID'}?{' '}
                <button
                  onClick={() => router.push(`/auth/recover-id?userType=${userType}`)}
                  className="link link-primary font-semibold"
                >
                  Recover it by email
                </button>
              </p>
              <p className="inline-flex items-center justify-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                SafeBill keeps your login recovery inside the same account flow.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
