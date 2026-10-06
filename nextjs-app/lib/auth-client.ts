import {
  normalizeAuthContact,
  parseSafeBillId,
  type CognitoAuthResult,
} from '@/lib/cognito'
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

async function authenticateWithResolvedIdentity(params: {
  username: string
  password: string
  userType: UserType
  customId?: string
  fullName?: string
  email?: string
  phone?: string
}): Promise<SignInWithCustomIdResult> {
  const authResponse = await fetch('/api/auth/cognito/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: params.username,
      password: params.password,
      userType: params.userType,
      customId: params.customId,
      name: params.fullName || '',
      email: params.email,
      phone: params.phone,
    }),
  })
  const authData = (await authResponse.json().catch(() => null)) as (CognitoAuthResult & { error?: string }) | null

  if (!authResponse.ok || !authData?.accessToken || !authData.user?.userId) {
    throw new Error(authData?.error || 'Login failed.')
  }

  const finalUserType = authData.user.userType === 'merchant' ? 'merchant' : params.userType
  const sessionToken = String(authData.idToken || authData.accessToken || '').trim()
  if (!sessionToken) {
    throw new Error('Login succeeded but no session token was returned.')
  }

  return {
    token: sessionToken,
    userType: finalUserType,
    user: {
      userId: authData.user.userId,
      email: authData.user.email || params.email,
      phone: authData.user.phone || params.phone,
      loginId: authData.user.loginId || params.username,
      userType: finalUserType,
      customId: authData.user.customId || params.customId,
      name: authData.user.name || params.fullName || '',
      picture: authData.user.picture,
      provider: authData.user.provider,
    },
  }
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
  return authenticateWithResolvedIdentity({
    username: lookupData.username,
    password: params.password,
    userType: resolvedType,
    customId: lookupData.customId || normalizedCustomId,
    fullName: lookupData.fullName || '',
    email: lookupData.email,
    phone: lookupData.phone,
  })
}

export async function signInWithIdentifier(params: {
  identifier: string
  password: string
  userType: UserType
}): Promise<SignInWithCustomIdResult> {
  const safeBillId = parseSafeBillId(params.identifier)
  if (safeBillId) {
    return signInWithCustomId({
      customId: safeBillId.customId,
      password: params.password,
      userType: safeBillId.userType,
    })
  }

  const contact = normalizeAuthContact(params.identifier)
  return authenticateWithResolvedIdentity({
    username: contact.value,
    password: params.password,
    userType: params.userType,
    email: contact.email,
    phone: contact.phone,
  })
}

export function persistClientAuthCookies(token: string, userType: UserType) {
  if (token) {
    document.cookie = `sb_access_token=${token}; path=/; max-age=${60 * 60 * 24 * 7}`
  }
  document.cookie = `sb_user_type=${userType}; path=/; max-age=${60 * 60 * 24 * 7}`
}
