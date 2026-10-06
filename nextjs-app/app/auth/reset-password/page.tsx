'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, KeyRound } from 'lucide-react'

import type { UserType } from '@/lib/types'

interface ResetPasswordResponse {
  ok?: boolean
  error?: string
}

function initialUserType(value: string | null): UserType {
  return value === 'merchant' ? 'merchant' : 'consumer'
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const resolvedUsername = searchParams.get('username') || ''
  const resolvedCustomId = searchParams.get('customId') || ''
  const deliveryDestination = searchParams.get('deliveryDestination') || ''
  const deliveryMedium = searchParams.get('deliveryMedium') || ''

  const [userType] = useState<UserType>(initialUserType(searchParams.get('userType')))
  const [accountIdentifier, setAccountIdentifier] = useState(resolvedCustomId || resolvedUsername)
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async () => {
    if (!accountIdentifier.trim()) {
      setError('Enter your account identifier.')
      return
    }
    if (!code.trim() || !newPassword) {
      setError('Enter the confirmation code and a new password.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/cognito/confirm-forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: resolvedUsername || undefined,
          identifier: accountIdentifier.trim(),
          userType,
          code: code.trim(),
          newPassword,
        }),
      })
      const payload = (await response.json().catch(() => null)) as ResetPasswordResponse | null
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Could not reset your password.')
      }

      setSuccess(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not reset your password.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="card bg-base-100 shadow-2xl border border-base-300 w-full max-w-md">
          <div className="card-body items-center text-center gap-5">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success/10 ring-1 ring-success/20">
              <CheckCircle2 className="w-8 h-8 text-success" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Password updated</h1>
              <p className="text-sm text-base-content/60 mt-1">
                Your {userType === 'merchant' ? 'merchant' : 'consumer'} account password has been reset.
              </p>
            </div>
            <button onClick={() => router.push('/login')} className="btn btn-primary w-full">
              Return to login
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <button
          onClick={() => router.push(`/auth/forgot-password?userType=${userType}`)}
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-base-content/70 transition hover:text-primary"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to forgot password
        </button>

        <div className="card bg-base-100 shadow-2xl border border-base-300">
          <div className="card-body gap-6">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4 ring-1 ring-primary/20">
                <KeyRound className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold">Reset password</h1>
              <p className="text-sm text-base-content/60 mt-1">
                Enter the confirmation code and choose a new password.
              </p>
            </div>

            {deliveryDestination ? (
              <div className="rounded-xl bg-base-200 px-4 py-3 text-sm text-base-content/70">
                Code sent via {deliveryMedium || 'the recovery channel'} to {deliveryDestination}.
              </div>
            ) : null}

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
                  value={accountIdentifier}
                  onChange={(event) => setAccountIdentifier(event.target.value)}
                  className="input input-bordered w-full focus:input-primary bg-base-50"
                  disabled={Boolean(resolvedUsername)}
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium text-base-content/80">Confirmation code</span>
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="input input-bordered w-full focus:input-primary bg-base-50"
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium text-base-content/80">New password</span>
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="input input-bordered w-full focus:input-primary bg-base-50"
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium text-base-content/80">Confirm new password</span>
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleSubmit()}
                  className="input input-bordered w-full focus:input-primary bg-base-50"
                />
              </div>

              <button onClick={handleSubmit} disabled={loading} className="btn btn-primary w-full">
                {loading ? <span className="loading loading-spinner loading-sm"></span> : 'Update password'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
