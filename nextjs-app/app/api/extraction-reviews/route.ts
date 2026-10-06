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
    const status = request.nextUrl.searchParams.get('status') || undefined
    const limit = request.nextUrl.searchParams.get('limit') || undefined
    const path = withQuery('/extraction-reviews', {
      user_id: userId,
      status,
      limit,
    })
    const response = await backendApiFetch<unknown>(path, { method: 'GET' }, undefined, authToken)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.payload || error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch extraction reviews'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
