import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken, withQuery } from '@/lib/backend-api'

export const runtime = 'nodejs'

interface RouteContext {
  params: { id: string }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authToken = resolveRequestAuthToken(request)
    if (!authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as { userId?: string }
    const userId = String(body.userId || '').trim()
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const path = withQuery(`/notifications/${context.params.id}/read`, { user_id: userId })
    const response = await backendApiFetch<unknown>(path, { method: 'POST' }, undefined, authToken)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json(
        { error: error.payload || error.message },
        { status: error.status }
      )
    }
    const message = error instanceof Error ? error.message : 'Failed to mark notification as read'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
