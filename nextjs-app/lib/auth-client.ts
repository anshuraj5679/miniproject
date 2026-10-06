import type { CognitoAuthResult } from '@/lib/cognito'
import type { User, UserType } from '@/lib/types'

export interface LookupIdentityResponse {
  userId?: string
  username?: string
  email?: string
  phone?: string
  fullName?: string
  userType?: UserType
  customId?: string
  error?: string
}

export interface SignInWithCustomIdResult {
  token: string
  user: User
  userType: UserType
}

export async function signInWithCustomId(params: {
  customId: string
  password: string
  userType: UserType
}): Promise<SignInWithCustomIdResult> {
  const normalizedCustomId = params.customId.trim().toUpperCase()
  const lookupResponse = await fetch('/api/auth/lookup-id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customId: normalizedCustomId, userType: params.userType }),
  })
  const lookupData = (await lookupResponse.json().catch(() => null)) as LookupIdentityResponse | null

  if (!lookupResponse.ok || !lookupData?.username) {
    throw new Error(lookupData?.error || `No account found for this ${params.userType} ID.`)
  }

  const resolvedType = lookupData.userType === 'merchant' ? 'merchant' : 'consumer'
  const authResponse = await fetch('/api/auth/cognito/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: lookupData.username,
      password: params.password,
      userType: resolvedType,
      customId: lookupData.customId || normalizedCustomId,
      name: lookupData.fullName || '',
      email: lookupData.email,
      phone: lookupData.phone,
    }),
  })
  const authData = (await authResponse.json().catch(() => null)) as (CognitoAuthResult & { error?: string }) | null

  if (!authResponse.ok || !authData?.accessToken || !authData.user?.userId) {
    throw new Error(authData?.error || 'Login failed.')
  }

  const finalUserType = authData.user.userType === 'merchant' ? 'merchant' : resolvedType
  const sessionToken = String(authData.idToken || authData.accessToken || '').trim()
  if (!sessionToken) {
    throw new Error('Login succeeded but no session token was returned.')
  }
  return {
    token: sessionToken,
    userType: finalUserType,
    user: {
      userId: authData.user.userId,
      email: authData.user.email || lookupData.email,
      phone: authData.user.phone || lookupData.phone,
      loginId: authData.user.loginId || lookupData.username,
      userType: finalUserType,
      customId: authData.user.customId || lookupData.customId || normalizedCustomId,
      name: authData.user.name || lookupData.fullName || '',
      picture: authData.user.picture,
      provider: authData.user.provider,
    },
  }
}

export function persistClientAuthCookies(token: string, userType: UserType) {
  if (token) {
    document.cookie = `sb_access_token=${token}; path=/; max-age=${60 * 60 * 24 * 7}`
  }
  document.cookie = `sb_user_type=${userType}; path=/; max-age=${60 * 60 * 24 * 7}`
}
