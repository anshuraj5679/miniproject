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

    const params = request.nextUrl.searchParams
    const path = withQuery(`/documents/${context.params.id}/service-centers`, {
      user_id: params.get('userId') || undefined,
      merchant_user_id: params.get('merchantUserId') || undefined,
      user_latitude: params.get('userLatitude') || undefined,
      user_longitude: params.get('userLongitude') || undefined,
      user_location_text: params.get('userLocationText') || undefined,
      radius_km: params.get('radiusKm') || undefined,
      limit: params.get('limit') || undefined,
    })
    const response = await backendApiFetch<unknown>(path, { method: 'GET' }, 12000, authToken)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.payload || error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch service centers'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
