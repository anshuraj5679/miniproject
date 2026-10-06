'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '@/lib/store/auth-store'
import { buildHostedUiAuthorizeUrl, type CognitoAuthResult } from '@/lib/cognito'

type UserType = 'consumer' | 'merchant'

interface LookupApiResponse {
    userId?: string
    email?: string
    fullName?: string
    userType?: UserType
    customId?: string
    error?: string
}

export default function LoginPage() {
    const router = useRouter()
    const { setAuth } = useAuthStore()
    const [userType, setUserType] = useState<UserType>('consumer')
    const [customId, setCustomId] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

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

            if (!lookupResponse.ok || !lookupData?.email) {
                throw new Error(`No account found for this ${userType} ID.`)
            }
            resolvedEmail = lookupData.email
            resolvedType = (lookupData.userType || userType) as UserType
            resolvedCustomId = lookupData.customId || normalizedCustomId
            resolvedName = lookupData.fullName || ''

            const authResponse = await fetch('/api/auth/cognito/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: resolvedEmail,
                    password,
                    userType: resolvedType,
                    customId: resolvedCustomId,
                    name: resolvedName,
                }),
            })
            const authData = (await authResponse.json().catch(() => null)) as (CognitoAuthResult & { error?: string }) | null

            if (!authResponse.ok || !authData?.accessToken || !authData.user?.userId) {
                throw new Error(authData?.error || 'Login failed.')
            }
            const userId = authData.user.userId
            if (!userId) throw new Error('Login failed.')
            const sessionToken = authData.accessToken || ''
            resolvedType = authData.user.userType || resolvedType
            resolvedCustomId = authData.user.customId || resolvedCustomId
            resolvedName = authData.user.name || resolvedName

            await setAuth(
                {
                    userId,
                    email: authData.user.email || resolvedEmail,
                    userType: resolvedType,
                    customId: resolvedCustomId || undefined,
                    name: resolvedName || '',
                    picture: authData.user.picture,
                    provider: authData.user.provider,
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
            const authorizeUrl = buildHostedUiAuthorizeUrl(userType)
            window.location.assign(authorizeUrl)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Google sign-in failed.')
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-base-100 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <a href="/" className="inline-flex items-center gap-2 mb-6">
                        <ShieldCheck className="w-8 h-8 text-primary" />
                        <span className="text-xl font-extrabold tracking-tight text-base-content">SafeBill</span>
                    </a>
                </div>

                <div className="card bg-base-100 shadow-2xl border border-base-300">
                    <div className="card-body gap-6">
                        <div className="text-center">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4 ring-1 ring-primary/20">
                                <LogIn className="w-8 h-8 text-primary" />
                            </div>
                            <h2 className="text-2xl font-bold">Welcome back</h2>
                            <p className="text-sm text-base-content/60 mt-1">Sign in to your account</p>
                        </div>

                        <div className="tabs tabs-boxed bg-base-200 p-1">
                            <button
                                className={`tab flex-1 transition-all duration-200 ${userType === 'consumer' ? 'tab-active font-semibold shadow-sm' : ''}`}
                                onClick={() => { setUserType('consumer'); setError(null) }}
                            >
                                Consumer
                            </button>
                            <button
                                className={`tab flex-1 transition-all duration-200 ${userType === 'merchant' ? 'tab-active font-semibold shadow-sm' : ''}`}
                                onClick={() => { setUserType('merchant'); setError(null) }}
                            >
                                Merchant
                            </button>
                        </div>

                        {error && (
                            <div className="alert alert-error text-sm py-2 rounded-lg shadow-sm">
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div className="form-control">
                                <label className="label">
                                    <span className="label-text font-medium text-base-content/80">
                                        {userType === 'consumer' ? 'Consumer ID' : 'Merchant ID'}
                                    </span>
                                </label>
                                <input
                                    type="text"
                                    placeholder={userType === 'consumer' ? 'e.g. CON-XXXXXX' : 'e.g. MER-XXXXXX'}
                                    value={customId}
                                    onChange={(e) => setCustomId(e.target.value)}
                                    className="input input-bordered w-full focus:input-primary bg-base-50"
                                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                                />
                            </div>

                            <div className="form-control">
                                <label className="label">
                                    <span className="label-text font-medium text-base-content/80">Password</span>
                                </label>
                                <input
                                    type="password"
                                    placeholder="Enter your password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                                    className="input input-bordered w-full focus:input-primary bg-base-50"
                                />
                            </div>

                            <button
                                onClick={handleLogin}
                                disabled={loading}
                                className="btn btn-primary w-full shadow-lg shadow-primary/20"
                            >
                                {loading ? <span className="loading loading-spinner loading-sm"></span> : 'Sign In'}
                            </button>
                        </div>

                        <div className="divider text-xs text-base-content/40 font-medium">OR</div>

                        <button
                            onClick={handleGoogleSignIn}
                            disabled={loading}
                            className="btn btn-outline w-full gap-2 border-base-300 hover:bg-base-200 hover:border-base-400"
                        >
                            Continue with Google
                        </button>

                        <p className="text-center text-sm text-base-content/60">
                            Don&apos;t have an account?{' '}
                            <button
                                onClick={() => router.push('/signup')}
                                className="link link-primary font-semibold hover:underline"
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
