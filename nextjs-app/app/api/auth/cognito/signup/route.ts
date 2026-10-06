import { NextRequest, NextResponse } from 'next/server'
import type { UserType } from '@/lib/types'
import { getServerCognitoConfig } from '@/lib/cognito'

export const runtime = 'nodejs'

interface SignupBody {
  email?: string
  password?: string
  name?: string
  userType?: UserType
  customId?: string
}

function cognitoIdpEndpoint(region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/`
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as SignupBody
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const name = String(body.name || '').trim()
    const userType = body.userType === 'merchant' ? 'merchant' : 'consumer'
    const customId = String(body.customId || '').trim()

    if (!email || !password || !name || !customId) {
      return NextResponse.json({ error: 'email, password, name, and customId are required' }, { status: 400 })
    }

    const cfg = getServerCognitoConfig()
    const response = await fetch(cognitoIdpEndpoint(cfg.region), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.SignUp',
      },
      body: JSON.stringify({
        ClientId: cfg.clientId,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'name', Value: name },
          { Name: 'custom:user_type', Value: userType },
          { Name: 'custom:custom_id', Value: customId },
        ],
      }),
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

    return NextResponse.json({
      userSub,
      userConfirmed,
      nextStep: userConfirmed ? 'SIGNED_UP' : 'CONFIRM_SIGNUP',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cognito signup failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

