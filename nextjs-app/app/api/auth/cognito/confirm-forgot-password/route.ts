import { NextRequest, NextResponse } from 'next/server'

import { backendPublicApiFetch } from '@/lib/backend-api'
import { getServerCognitoConfig, normalizeAuthContact, parseSafeBillId } from '@/lib/cognito'
import { computeCognitoSecretHash } from '@/lib/cognito-server'
import type { UserType } from '@/lib/types'

export const runtime = 'nodejs'

interface ConfirmForgotPasswordBody {
  username?: string
  identifier?: string
  userType?: UserType
  code?: string
  newPassword?: string
}

function cognitoIdpEndpoint(region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/`
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as ConfirmForgotPasswordBody
    const rawIdentifier = String(body.username || body.identifier || '').trim()
    const code = String(body.code || '').trim()
    const newPassword = String(body.newPassword || '')
    const requestedUserType = body.userType === 'merchant' ? 'merchant' : 'consumer'

    if (!rawIdentifier || !code || !newPassword) {
      return NextResponse.json(
        { error: 'username, code, and newPassword are required' },
        { status: 400 }
      )
    }

    let username = rawIdentifier
    let userType: UserType = requestedUserType

    const safeBillId = parseSafeBillId(rawIdentifier)
    if (safeBillId) {
      const lookupPayload = await backendPublicApiFetch<{
        username: string
        userType?: UserType
      }>('/auth/lookup-id', {
        method: 'POST',
        body: JSON.stringify({
          customId: safeBillId.customId,
          userType: safeBillId.userType,
        }),
      })
      username = String(lookupPayload.username || '').trim()
      userType = lookupPayload.userType === 'merchant' ? 'merchant' : safeBillId.userType
    } else if (!body.username) {
      username = normalizeAuthContact(rawIdentifier).value
    }

    if (!username) {
      return NextResponse.json({ error: 'Unable to resolve your account.' }, { status: 400 })
    }

    const cfg = getServerCognitoConfig()
    const clientSecret = String(process.env.COGNITO_CLIENT_SECRET || '').trim()
    const payload: Record<string, unknown> = {
      ClientId: cfg.clientId,
      Username: username,
      ConfirmationCode: code,
      Password: newPassword,
    }
    if (clientSecret) {
      payload.SecretHash = computeCognitoSecretHash(username, cfg.clientId, clientSecret)
    }

    const response = await fetch(cognitoIdpEndpoint(cfg.region), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.ConfirmForgotPassword',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })

    const result = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      const message =
        String(result.message || result.error_description || result.error || '').trim() ||
        'Password reset confirmation failed'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json({ ok: true, username, userType })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Password reset confirmation failed'
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
