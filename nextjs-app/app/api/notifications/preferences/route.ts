import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken, withQuery } from '@/lib/backend-api'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const authToken = resolveRequestAuthToken(request)
    if (!authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = request.nextUrl.searchParams.get('userId') || undefined
    const path = withQuery('/notifications/preferences', {
      user_id: userId,
    })
    const response = await backendApiFetch<unknown>(path, { method: 'GET' }, undefined, authToken)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json(
        { error: error.payload || error.message },
        { status: error.status }
      )
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch notification preferences'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authToken = resolveRequestAuthToken(request)
    if (!authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const userId = typeof payload.userId === 'string' ? payload.userId.trim() : ''
    const updatePayload = { ...payload }
    delete (updatePayload as { userId?: unknown }).userId

    const path = withQuery('/notifications/preferences', {
      user_id: userId || undefined,
    })
    const response = await backendApiFetch<unknown>(
      path,
      {
        method: 'PUT',
        body: JSON.stringify(updatePayload),
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
    const message = error instanceof Error ? error.message : 'Failed to update notification preferences'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
