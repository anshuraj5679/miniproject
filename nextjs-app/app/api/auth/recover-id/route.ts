import { NextRequest, NextResponse } from 'next/server'

import { backendPublicApiFetch } from '@/lib/backend-api'
import { normalizeEmailAddress } from '@/lib/cognito'

export const runtime = 'nodejs'

interface RecoverIdBody {
  email?: string
  identifier?: string
  userType?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as RecoverIdBody
    const email = normalizeEmailAddress(String(body.email || body.identifier || ''))
    const userType = String(body.userType || '').trim().toLowerCase()

    if (!email || !email.includes('@') || !['consumer', 'merchant'].includes(userType)) {
      return NextResponse.json({ error: 'email and valid userType are required' }, { status: 400 })
    }

    const payload = await backendPublicApiFetch<{
      ok: boolean
      deliveryDestination?: string
      deliveryMedium?: string
      message?: string
    }>('/auth/recover-id', {
      method: 'POST',
      body: JSON.stringify({ email, userType }),
    })

    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ID recovery failed'
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
