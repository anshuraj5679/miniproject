import { NextRequest, NextResponse } from 'next/server'
import { backendPublicApiFetch } from '@/lib/backend-api'
import { decodeJwtPayload, extractAuthUserFromClaims, getServerCognitoConfig } from '@/lib/cognito'
import { normalizeEmailAddress, normalizePhoneNumber } from '@/lib/cognito'
import type { UserType } from '@/lib/types'
import { computeCognitoSecretHash } from '@/lib/cognito-server'

export const runtime = 'nodejs'

interface LoginBody {
  username?: string
  email?: string
  phone?: string
  password?: string
  customId?: string
  name?: string
  userType?: UserType
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as LoginBody
    const username =
      String(body.username || '').trim() ||
      (String(body.email || '').trim() ? normalizeEmailAddress(String(body.email || '')) : '') ||
      (String(body.phone || '').trim() ? normalizePhoneNumber(String(body.phone || '')) : '')
    const password = String(body.password || '')
    const fallbackCustomId = String(body.customId || '').trim() || undefined
    const fallbackName = String(body.name || '').trim() || undefined
    const fallbackEmail = String(body.email || '').trim() ? normalizeEmailAddress(String(body.email || '')) : undefined
    const fallbackPhone = String(body.phone || '').trim() ? normalizePhoneNumber(String(body.phone || '')) : undefined
    const fallbackUserType =
      body.userType === 'merchant'
        ? 'merchant'
        : fallbackCustomId?.toUpperCase().startsWith('MER-')
          ? 'merchant'
          : fallbackCustomId?.toUpperCase().startsWith('CON-')
            ? 'consumer'
            : undefined

    if (!username || !password) {
      return NextResponse.json({ error: 'username and password are required' }, { status: 400 })
    }

    const cfg = getServerCognitoConfig()
    const clientSecret = String(process.env.COGNITO_CLIENT_SECRET || '').trim()
    const secretHash = clientSecret
      ? computeCognitoSecretHash(username, cfg.clientId, clientSecret)
      : undefined
    const payload = await backendPublicApiFetch<{
      accessToken?: string | null
      idToken?: string | null
      refreshToken?: string | null
      expiresIn?: number | null
      challengeName?: string | null
      session?: string | null
    }>('/auth/cognito/login', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        secretHash,
      }),
    })

    if (payload.challengeName) {
      return NextResponse.json(
        { error: `Unsupported Cognito challenge: ${payload.challengeName}` },
        { status: 400 }
      )
    }

    const accessToken = String(payload.accessToken || '').trim()
    const idToken = String(payload.idToken || '').trim()
    const refreshToken = String(payload.refreshToken || '').trim() || undefined
    const expiresIn = Number(payload.expiresIn || 0) || undefined

    if (!accessToken || !idToken) {
      return NextResponse.json({ error: 'Cognito did not return tokens' }, { status: 502 })
    }

    const claims = decodeJwtPayload(idToken)
    const user = extractAuthUserFromClaims(claims, {
      customId: fallbackCustomId,
      name: fallbackName,
      email: fallbackEmail,
      phone: fallbackPhone,
      loginId: username,
      userType: fallbackUserType,
    })

    return NextResponse.json({
      accessToken,
      idToken,
      refreshToken,
      expiresIn,
      user,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cognito login failed'
    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof (error as { status: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
