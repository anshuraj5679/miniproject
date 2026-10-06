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

    const rawUserId = request.nextUrl.searchParams.get('userId') || undefined
    const userId =
      rawUserId && rawUserId.trim().toLowerCase() !== 'anonymous'
        ? rawUserId.trim()
        : undefined
    const merchantUserId = request.nextUrl.searchParams.get('merchantUserId') || undefined
    const expiresIn = request.nextUrl.searchParams.get('expiresIn') || undefined
    const path = withQuery(`/documents/${context.params.id}/product-image-url`, {
      user_id: userId,
      merchant_user_id: merchantUserId,
      expires_in: expiresIn,
    })
    const response = await backendApiFetch<{ url: string }>(path, { method: 'GET' }, undefined, authToken)
    return NextResponse.redirect(response.url, { status: 307 })
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.payload || error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch product image'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
