import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken, withQuery } from '@/lib/backend-api'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const authToken = resolveRequestAuthToken(request)
    if (!authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const merchantUserId = request.nextUrl.searchParams.get('merchantUserId') || undefined
    const limit = request.nextUrl.searchParams.get('limit') || undefined
    if (!merchantUserId) {
      return NextResponse.json({ error: 'merchantUserId is required' }, { status: 400 })
    }

    const path = withQuery('/merchant/activity', {
      merchant_user_id: merchantUserId,
      limit,
    })
    const response = await backendApiFetch<{ activities: unknown[] }>(path, { method: 'GET' }, undefined, authToken)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json(
        { error: error.payload || error.message },
        { status: error.status }
      )
    }
    const message = error instanceof Error ? error.message : 'Failed to load merchant activity'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
