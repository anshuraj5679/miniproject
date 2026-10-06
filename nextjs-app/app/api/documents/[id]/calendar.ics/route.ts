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
    const path = withQuery(`/documents/${context.params.id}/calendar.ics`, {
      user_id: userId,
      merchant_user_id: merchantUserId,
    })
    const ics = await backendApiFetch<string>(path, { method: 'GET' }, undefined, authToken)
    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="warranty-${context.params.id}.ics"`,
      },
    })
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.payload || error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to download ICS file'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
