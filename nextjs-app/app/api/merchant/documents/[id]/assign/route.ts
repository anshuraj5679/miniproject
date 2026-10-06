import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken } from '@/lib/backend-api'

export const runtime = 'nodejs'

interface RouteContext {
  params: { id: string }
}

interface AssignRequestBody {
  merchantUserId?: string
  merchantName?: string
  merchantCustomId?: string
  consumerUserId?: string
  consumerCustomId?: string
  consumerName?: string
  consumerEmail?: string
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authToken = resolveRequestAuthToken(request)
    if (!authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as AssignRequestBody
    if (!body.merchantUserId || !body.consumerUserId) {
      return NextResponse.json(
        { error: 'merchantUserId and consumerUserId are required' },
        { status: 400 }
      )
    }

    const backendPayload = {
      merchant_user_id: body.merchantUserId,
      merchant_name: body.merchantName,
      merchant_custom_id: body.merchantCustomId,
      consumer_user_id: body.consumerUserId,
      consumer_custom_id: body.consumerCustomId,
      consumer_name: body.consumerName,
      consumer_email: body.consumerEmail,
    }

    const response = await backendApiFetch<unknown>(
      `/merchant/documents/${context.params.id}/assign`,
      {
        method: 'POST',
        body: JSON.stringify(backendPayload),
      },
      undefined,
      authToken
    )
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json(
        { error: error.payload || error.message },
        { status: error.status }
      )
    }
    const message = error instanceof Error ? error.message : 'Failed to assign document'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
