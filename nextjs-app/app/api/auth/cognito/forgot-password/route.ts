import { NextRequest, NextResponse } from 'next/server'

import { backendPublicApiFetch } from '@/lib/backend-api'
import { getServerCognitoConfig, normalizeAuthContact, parseSafeBillId } from '@/lib/cognito'
import { computeCognitoSecretHash } from '@/lib/cognito-server'
import type { UserType } from '@/lib/types'

export const runtime = 'nodejs'

interface ForgotPasswordBody {
  identifier?: string
  userType?: UserType
}

function cognitoIdpEndpoint(region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/`
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as ForgotPasswordBody
    const rawIdentifier = String(body.identifier || '').trim()
    const requestedUserType = body.userType === 'merchant' ? 'merchant' : 'consumer'

    if (!rawIdentifier) {
      return NextResponse.json({ error: 'identifier is required' }, { status: 400 })
    }

    let username = ''
    let userType: UserType = requestedUserType
    let customId: string | undefined
    let email: string | undefined
    let phone: string | undefined

    const safeBillId = parseSafeBillId(rawIdentifier)
    if (safeBillId) {
      const lookupPayload = await backendPublicApiFetch<{
        username: string
        email?: string
        phone?: string
        userType?: UserType
        customId?: string
      }>('/auth/lookup-id', {
        method: 'POST',
        body: JSON.stringify({
          customId: safeBillId.customId,
          userType: safeBillId.userType,
        }),
      })

      username = String(lookupPayload.username || '').trim()
      customId = String(lookupPayload.customId || safeBillId.customId).trim() || undefined
      email = String(lookupPayload.email || '').trim() || undefined
      phone = String(lookupPayload.phone || '').trim() || undefined
      userType = lookupPayload.userType === 'merchant' ? 'merchant' : safeBillId.userType
    } else {
      const contact = normalizeAuthContact(rawIdentifier)
      username = contact.value
      email = contact.email
      phone = contact.phone
    }

    if (!username) {
      return NextResponse.json({ error: 'Unable to resolve your account.' }, { status: 400 })
    }

    const cfg = getServerCognitoConfig()
    const clientSecret = String(process.env.COGNITO_CLIENT_SECRET || '').trim()
    const payload: Record<string, unknown> = {
      ClientId: cfg.clientId,
      Username: username,
    }
    if (clientSecret) {
      payload.SecretHash = computeCognitoSecretHash(username, cfg.clientId, clientSecret)
    }

    const response = await fetch(cognitoIdpEndpoint(cfg.region), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.ForgotPassword',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })

    const result = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      const message =
        String(result.message || result.error_description || result.error || '').trim() ||
        'Password reset failed'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const delivery = (result.CodeDeliveryDetails || {}) as Record<string, unknown>
    return NextResponse.json({
      ok: true,
      username,
      userType,
      customId,
      email,
      phone,
      deliveryDestination: String(delivery.Destination || '').trim() || undefined,
      deliveryMedium: String(delivery.DeliveryMedium || '').trim() || undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Password reset failed'
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
