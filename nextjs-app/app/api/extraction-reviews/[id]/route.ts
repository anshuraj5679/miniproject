import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken } from '@/lib/backend-api'

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
    const response = await backendApiFetch<unknown>(
      `/extraction-reviews/${context.params.id}`,
      { method: 'GET' },
      undefined,
      authToken
    )
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.payload || error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch extraction review'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const authToken = resolveRequestAuthToken(request)
    if (!authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const payload = await request.json().catch(() => ({}))
    const response = await backendApiFetch<unknown>(
      `/extraction-reviews/${context.params.id}`,
      {
        method: 'PUT',
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
    const message = error instanceof Error ? error.message : 'Failed to update extraction review'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
