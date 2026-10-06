import { randomBytes } from 'crypto'

import { NextRequest, NextResponse } from 'next/server'
import type { UserType } from '@/lib/types'
import { BackendApiError, backendPublicApiFetch } from '@/lib/backend-api'
import { getServerCognitoConfig, normalizeAuthContact } from '@/lib/cognito'
import { computeCognitoSecretHash } from '@/lib/cognito-server'

export const runtime = 'nodejs'

interface SignupBody {
  identifier?: string
  email?: string
  phone?: string
  password?: string
  name?: string
  userType?: UserType
}

function cognitoIdpEndpoint(region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/`
}

function buildCustomIdCandidate(userType: UserType): string {
  const prefix = userType === 'merchant' ? 'MER' : 'CON'
  return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`
}

async function allocateUniqueCustomId(userType: UserType): Promise<string> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = buildCustomIdCandidate(userType)
    try {
      await backendPublicApiFetch('/auth/lookup-id', {
        method: 'POST',
        body: JSON.stringify({ customId: candidate, userType }),
      })
    } catch (error) {
      if (error instanceof BackendApiError && error.status === 404) {
        return candidate
      }
      throw error
    }
  }

  throw new Error('Failed to generate a unique SafeBill ID. Please try again.')
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as SignupBody
    const rawIdentifier = String(body.identifier || body.email || body.phone || '').trim()
    const password = String(body.password || '')
    const name = String(body.name || '').trim()
    const userType = body.userType === 'merchant' ? 'merchant' : 'consumer'

    if (!rawIdentifier || !password || !name) {
      return NextResponse.json({ error: 'identifier, password, and name are required' }, { status: 400 })
    }

    const contact = normalizeAuthContact(rawIdentifier)
    const username = contact.value
    const customId = await allocateUniqueCustomId(userType)

    const cfg = getServerCognitoConfig()
    const clientSecret = String(process.env.COGNITO_CLIENT_SECRET || '').trim()
    const userAttributes = [
      { Name: 'name', Value: name },
      { Name: 'preferred_username', Value: customId },
    ]
    if (contact.email) {
      userAttributes.push({ Name: 'email', Value: contact.email })
    }
    if (contact.phone) {
      userAttributes.push({ Name: 'phone_number', Value: contact.phone })
    }

    const signupPayload: Record<string, unknown> = {
      ClientId: cfg.clientId,
      Username: username,
      Password: password,
      UserAttributes: userAttributes,
    }
    if (clientSecret) {
      signupPayload.SecretHash = computeCognitoSecretHash(username, cfg.clientId, clientSecret)
    }

    const response = await fetch(cognitoIdpEndpoint(cfg.region), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.SignUp',
      },
      body: JSON.stringify(signupPayload),
      cache: 'no-store',
    })

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      const message =
        String(payload.message || payload.error_description || payload.error || '').trim() ||
        'Signup failed'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const userSub = String(payload.UserSub || '').trim()
    const userConfirmed = Boolean(payload.UserConfirmed)
    const delivery = (payload.CodeDeliveryDetails || {}) as Record<string, unknown>

    return NextResponse.json({
      userSub,
      userConfirmed,
      nextStep: userConfirmed ? 'SIGNED_UP' : 'CONFIRM_SIGNUP',
      customId,
      username,
      email: contact.email,
      phone: contact.phone,
      deliveryDestination: String(delivery.Destination || '').trim() || undefined,
      deliveryMedium: String(delivery.DeliveryMedium || '').trim() || undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cognito signup failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

