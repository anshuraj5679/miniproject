import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken, withQuery } from '@/lib/backend-api'

export const runtime = 'nodejs'

interface RouteContext {
  params: { id: string }
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authToken = resolveRequestAuthToken(request)
    if (!authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = request.nextUrl.searchParams.get('userId') || undefined
    const merchantUserId = request.nextUrl.searchParams.get('merchantUserId') || undefined
    const path = withQuery(`/documents/${context.params.id}/calendar-links`, {
      user_id: userId,
      merchant_user_id: merchantUserId,
    })
    const response = await backendApiFetch<unknown>(path, { method: 'GET' }, undefined, authToken)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.payload || error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch calendar links'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
