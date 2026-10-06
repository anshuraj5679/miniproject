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
    const includeRead = request.nextUrl.searchParams.get('includeRead') || undefined
    const limit = request.nextUrl.searchParams.get('limit') || undefined
    const offset = request.nextUrl.searchParams.get('offset') || undefined
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const path = withQuery('/notifications', {
      user_id: userId,
      include_read: includeRead,
      limit,
      offset,
    })
    const response = await backendApiFetch<{ notifications: unknown[] }>(path, { method: 'GET' }, undefined, authToken)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json(
        { error: error.payload || error.message },
        { status: error.status }
      )
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch notifications'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
