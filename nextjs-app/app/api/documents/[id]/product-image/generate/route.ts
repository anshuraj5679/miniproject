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

    const body = await request.json().catch(() => ({}))
    const rawUserId = request.nextUrl.searchParams.get('userId') || undefined
    const userId =
      rawUserId && rawUserId.trim().toLowerCase() !== 'anonymous'
        ? rawUserId.trim()
        : undefined
    const merchantUserId = request.nextUrl.searchParams.get('merchantUserId') || undefined
    const path = withQuery(`/documents/${context.params.id}/product-image/generate`, {
      user_id: userId,
      merchant_user_id: merchantUserId,
    })
    const response = await backendApiFetch<Record<string, unknown>>(
      path,
      {
        method: 'POST',
        body: JSON.stringify(body || {}),
      },
      undefined,
      authToken
    )
    return NextResponse.json({
      ...response,
      imageUrl: `/api/documents/${context.params.id}/product-image`,
    })
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.payload || error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to generate product image'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
