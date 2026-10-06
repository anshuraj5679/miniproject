import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken, withQuery } from '@/lib/backend-api'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const authToken = resolveRequestAuthToken(request)
    if (!authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as { limit?: number }
    const limit = body.limit
    const path = withQuery('/notifications/process-due', {
      limit: typeof limit === 'number' ? String(limit) : undefined,
    })
    const response = await backendApiFetch<unknown>(path, { method: 'POST' }, undefined, authToken)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json(
        { error: error.payload || error.message },
        { status: error.status }
      )
    }
    const message = error instanceof Error ? error.message : 'Failed to process due notifications'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
