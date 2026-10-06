import type { UserType } from '@/lib/types'

export interface CognitoConfig {
  domain: string
  clientId: string
  redirectUri: string
  logoutUri: string
  region: string
  responseType: 'code'
  scope: string
}

export interface CognitoAuthUser {
  userId: string
  email: string
  name: string
  userType: UserType
  customId?: string
  picture?: string
  provider?: string
}

export interface CognitoAuthResult {
  accessToken: string
  idToken: string
  refreshToken?: string
  expiresIn?: number
  user: CognitoAuthUser
}

function requireValue(value: string | undefined, key: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) {
    throw new Error(`${key} is not configured`)
  }
  return trimmed
}

function normalizedDomain(raw: string): string {
  const value = raw.trim()
  if (!value) return value
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value.replace(/\/+$/, '')
  }
  return `https://${value.replace(/\/+$/, '')}`
}

export function getClientCognitoConfig(): CognitoConfig {
  return {
    domain: normalizedDomain(requireValue(process.env.NEXT_PUBLIC_COGNITO_DOMAIN, 'NEXT_PUBLIC_COGNITO_DOMAIN')),
    clientId: requireValue(process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID, 'NEXT_PUBLIC_COGNITO_CLIENT_ID'),
    redirectUri: requireValue(process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI, 'NEXT_PUBLIC_COGNITO_REDIRECT_URI'),
    logoutUri: requireValue(process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI, 'NEXT_PUBLIC_COGNITO_LOGOUT_URI'),
    region: requireValue(process.env.NEXT_PUBLIC_COGNITO_REGION, 'NEXT_PUBLIC_COGNITO_REGION'),
    responseType: 'code',
    scope: (process.env.NEXT_PUBLIC_COGNITO_SCOPE || 'openid email profile').trim(),
  }
}

export function getServerCognitoConfig(): CognitoConfig {
  const domain = process.env.COGNITO_DOMAIN || process.env.NEXT_PUBLIC_COGNITO_DOMAIN
  const clientId = process.env.COGNITO_CLIENT_ID || process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID
  const redirectUri = process.env.COGNITO_REDIRECT_URI || process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI
  const logoutUri = process.env.COGNITO_LOGOUT_URI || process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI || ''
  const region = process.env.COGNITO_REGION || process.env.NEXT_PUBLIC_COGNITO_REGION
  const scope = process.env.COGNITO_SCOPE || process.env.NEXT_PUBLIC_COGNITO_SCOPE || 'openid email profile'

  return {
    domain: normalizedDomain(requireValue(domain, 'COGNITO_DOMAIN')),
    clientId: requireValue(clientId, 'COGNITO_CLIENT_ID'),
    redirectUri: requireValue(redirectUri, 'COGNITO_REDIRECT_URI'),
    logoutUri: String(logoutUri || '').trim(),
    region: requireValue(region, 'COGNITO_REGION'),
    responseType: 'code',
    scope: scope.trim(),
  }
}

export function buildHostedUiAuthorizeUrl(userType: UserType): string {
  const cfg = getClientCognitoConfig()
  const statePayload = JSON.stringify({ userType, t: Date.now() })
  const state = toBase64Url(statePayload)

  const url = new URL('/oauth2/authorize', cfg.domain)
  url.searchParams.set('identity_provider', 'Google')
  url.searchParams.set('redirect_uri', cfg.redirectUri)
  url.searchParams.set('response_type', cfg.responseType)
  url.searchParams.set('client_id', cfg.clientId)
  url.searchParams.set('scope', cfg.scope)
  url.searchParams.set('state', state)
  return url.toString()
}

function toBase64Url(input: string): string {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    const encoded = window.btoa(unescape(encodeURIComponent(input)))
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }
  return Buffer.from(input, 'utf-8').toString('base64url')
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    return decodeURIComponent(escape(window.atob(normalized + padding)))
  }
  return Buffer.from(normalized + padding, 'base64').toString('utf-8')
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length < 2) throw new Error('Invalid JWT')
  const decoded = decodeBase64Url(parts[1] || '')
  const payload = JSON.parse(decoded)
  if (!payload || typeof payload !== 'object') throw new Error('Invalid JWT payload')
  return payload as Record<string, unknown>
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function extractUserTypeFromClaims(claims: Record<string, unknown>): UserType {
  const claimCandidates = [
    safeString(claims['custom:user_type']),
    safeString(claims['user_type']),
  ]
  for (const candidate of claimCandidates) {
    const normalized = candidate.toLowerCase()
    if (normalized === 'merchant') return 'merchant'
    if (normalized === 'consumer') return 'consumer'
  }

  const groups = claims['cognito:groups']
  if (Array.isArray(groups)) {
    const normalizedGroups = groups.map((group) => safeString(group).toLowerCase())
    if (normalizedGroups.includes('merchant')) return 'merchant'
    if (normalizedGroups.includes('consumer')) return 'consumer'
  }

  return 'consumer'
}

export function extractAuthUserFromClaims(
  claims: Record<string, unknown>,
  fallback: { userType?: UserType; customId?: string; name?: string; email?: string } = {}
): CognitoAuthUser {
  const email = safeString(claims.email) || safeString(fallback.email)
  const userId = safeString(claims.sub)
  const name =
    safeString(claims.name) ||
    safeString(claims.given_name) ||
    safeString(fallback.name) ||
    (email.includes('@') ? email.split('@')[0] || 'User' : 'User')
  const customId = safeString(claims['custom:custom_id']) || safeString(fallback.customId) || undefined
  const picture = safeString(claims.picture) || undefined
  const provider = safeString(claims.identities) || safeString(claims['cognito:username']) || undefined
  const userType = extractUserTypeFromClaims(claims)

  if (!userId) {
    throw new Error('Missing user id in Cognito token')
  }
  if (!email) {
    throw new Error('Missing email in Cognito token')
  }

  return {
    userId,
    email,
    name,
    userType,
    customId,
    picture,
    provider,
  }
}
