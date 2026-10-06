import { NextRequest, NextResponse } from 'next/server'
import { getServerCognitoConfig } from '@/lib/cognito'
import { computeCognitoSecretHash } from '@/lib/cognito-server'

export const runtime = 'nodejs'

interface ConfirmSignupBody {
  username?: string
  code?: string
}

function cognitoIdpEndpoint(region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/`
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as ConfirmSignupBody
    const username = String(body.username || '').trim()
    const code = String(body.code || '').trim()

    if (!username || !code) {
      return NextResponse.json({ error: 'username and code are required' }, { status: 400 })
    }

    const cfg = getServerCognitoConfig()
    const clientSecret = String(process.env.COGNITO_CLIENT_SECRET || '').trim()
    const payload: Record<string, unknown> = {
      ClientId: cfg.clientId,
      Username: username,
      ConfirmationCode: code,
    }
    if (clientSecret) {
      payload.SecretHash = computeCognitoSecretHash(username, cfg.clientId, clientSecret)
    }

    const response = await fetch(cognitoIdpEndpoint(cfg.region), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.ConfirmSignUp',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })

    const result = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      const message =
        String(result.message || result.error_description || result.error || '').trim() ||
        'Verification failed'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cognito confirmation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
