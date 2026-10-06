import { NextRequest, NextResponse } from 'next/server'
import { decodeJwtPayload, extractAuthUserFromClaims, getServerCognitoConfig } from '@/lib/cognito'
import type { UserType } from '@/lib/types'

export const runtime = 'nodejs'

interface ExchangeBody {
  code?: string
  userType?: UserType
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as ExchangeBody
    const code = String(body.code || '').trim()
    if (!code) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }

    const cfg = getServerCognitoConfig()
    const tokenUrl = new URL('/oauth2/token', cfg.domain)
    const clientSecret = String(process.env.COGNITO_CLIENT_SECRET || '').trim()

    const form = new URLSearchParams()
    form.set('grant_type', 'authorization_code')
    form.set('client_id', cfg.clientId)
    form.set('code', code)
    form.set('redirect_uri', cfg.redirectUri)

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    if (clientSecret) {
      const basic = Buffer.from(`${cfg.clientId}:${clientSecret}`, 'utf-8').toString('base64')
      headers.Authorization = `Basic ${basic}`
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)
    const response = await fetch(tokenUrl.toString(), {
      method: 'POST',
      headers,
      body: form.toString(),
      cache: 'no-store',
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      const message =
        String(payload.error_description || payload.error || '').trim() || 'Code exchange failed'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const accessToken = String(payload.access_token || '').trim()
    const idToken = String(payload.id_token || '').trim()
    const refreshToken = String(payload.refresh_token || '').trim() || undefined
    const expiresIn = Number(payload.expires_in || 0) || undefined

    if (!accessToken || !idToken) {
      return NextResponse.json({ error: 'Cognito token response is incomplete' }, { status: 502 })
    }

    const claims = decodeJwtPayload(idToken)
    const user = extractAuthUserFromClaims(claims)

    return NextResponse.json({
      accessToken,
      idToken,
      refreshToken,
      expiresIn,
      user,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Cognito token exchange timed out. Please login again.' }, { status: 504 })
    }
    const message = error instanceof Error ? error.message : 'Cognito exchange failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
