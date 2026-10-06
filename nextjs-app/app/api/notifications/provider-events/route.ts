import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken } from '@/lib/backend-api'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const authToken = resolveRequestAuthToken(request)
    if (!authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const payload = await request.json().catch(() => ({}))
    const response = await backendApiFetch<unknown>(
      '/notifications/provider-events',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      undefined,
      authToken
    )
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.payload || error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to ingest provider event'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
