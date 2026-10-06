'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react'

import type { UserType } from '@/lib/types'

interface RecoverIdResponse {
  ok?: boolean
  message?: string
  deliveryDestination?: string
  error?: string
}

function initialUserType(value: string | null): UserType {
  return value === 'merchant' ? 'merchant' : 'consumer'
}

export default function RecoverIdPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [userType, setUserType] = useState<UserType>(initialUserType(searchParams.get('userType')))
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError('Enter your registered email address.')
      return
    }

    setLoading(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const response = await fetch('/api/auth/recover-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          userType,
        }),
      })
      const payload = (await response.json().catch(() => null)) as RecoverIdResponse | null
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Could not recover your SafeBill ID.')
      }

      setSuccessMessage(
        payload.message ||
          `If a matching ${userType} account exists, we emailed the SafeBill ID to ${payload.deliveryDestination || email.trim()}.`
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not recover your SafeBill ID.')
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
                <Mail className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold">
                Recover {userType === 'merchant' ? 'Merchant ID' : 'Consumer ID'}
              </h1>
              <p className="text-sm text-base-content/60 mt-1">
                We will send the SafeBill ID to the registered email address.
              </p>
            </div>

            <div className="tabs tabs-boxed bg-base-200 p-1">
              <button
                className={`tab flex-1 ${userType === 'consumer' ? 'tab-active font-semibold' : ''}`}
                onClick={() => {
                  setUserType('consumer')
                  setError(null)
                  setSuccessMessage(null)
                }}
              >
                Consumer
              </button>
              <button
                className={`tab flex-1 ${userType === 'merchant' ? 'tab-active font-semibold' : ''}`}
                onClick={() => {
                  setUserType('merchant')
                  setError(null)
                  setSuccessMessage(null)
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

            {successMessage ? (
              <div className="alert alert-success text-sm py-2 rounded-lg">
                <span>{successMessage}</span>
              </div>
            ) : null}

            <div className="space-y-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium text-base-content/80">Registered email</span>
                </label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleSubmit()}
                  className="input input-bordered w-full focus:input-primary bg-base-50"
                />
              </div>

              <button onClick={handleSubmit} disabled={loading} className="btn btn-primary w-full">
                {loading ? <span className="loading loading-spinner loading-sm"></span> : 'Email my SafeBill ID'}
              </button>
            </div>

            <div className="rounded-xl bg-base-200 px-4 py-3 text-sm text-base-content/70">
              Email-based ID recovery works for accounts that have a registered email address.
            </div>

            <p className="text-center text-sm text-base-content/60 inline-flex items-center justify-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              Need to reset the password too?
              <button
                onClick={() => router.push(`/auth/forgot-password?userType=${userType}`)}
                className="link link-primary font-semibold"
              >
                Continue here
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
