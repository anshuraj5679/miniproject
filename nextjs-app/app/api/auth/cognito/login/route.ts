import { NextRequest, NextResponse } from 'next/server'
import { decodeJwtPayload, extractAuthUserFromClaims, getServerCognitoConfig } from '@/lib/cognito'

export const runtime = 'nodejs'

interface LoginBody {
  email?: string
  password?: string
  customId?: string
  name?: string
}

function cognitoIdpEndpoint(region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/`
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as LoginBody
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const fallbackCustomId = String(body.customId || '').trim() || undefined
    const fallbackName = String(body.name || '').trim() || undefined

    if (!email || !password) {
      return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
    }

    const cfg = getServerCognitoConfig()
    const response = await fetch(cognitoIdpEndpoint(cfg.region), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
      },
      body: JSON.stringify({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: cfg.clientId,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      }),
      cache: 'no-store',
    })

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      const message =
        String(payload.message || payload.error_description || payload.error || '').trim() ||
        'Login failed'
      return NextResponse.json({ error: message }, { status: 401 })
    }

    const authResult = (payload.AuthenticationResult || {}) as Record<string, unknown>
    const accessToken = String(authResult.AccessToken || '').trim()
    const idToken = String(authResult.IdToken || '').trim()
    const refreshToken = String(authResult.RefreshToken || '').trim() || undefined
    const expiresIn = Number(authResult.ExpiresIn || 0) || undefined

    if (!accessToken || !idToken) {
      return NextResponse.json({ error: 'Cognito did not return tokens' }, { status: 502 })
    }

    const claims = decodeJwtPayload(idToken)
    const user = extractAuthUserFromClaims(claims, {
      customId: fallbackCustomId,
      name: fallbackName,
      email,
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
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
