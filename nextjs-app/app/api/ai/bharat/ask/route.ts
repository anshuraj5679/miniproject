import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken } from '@/lib/backend-api'

export const runtime = 'nodejs'
const ASK_TIMEOUT_MS = Number(process.env.BHARAT_AI_TIMEOUT_MS || 120000)

interface BharatAskRequestBody {
  question?: string
  ocrText?: string
  metadata?: Record<string, unknown>
  targetLanguageCode?: string
}

export async function POST(request: NextRequest) {
  try {
    const authToken = resolveRequestAuthToken(request)
    const isProduction = process.env.NODE_ENV === 'production'
    if (isProduction && !authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as BharatAskRequestBody
    const question = String(body.question || '').trim()
    const ocrText = String(body.ocrText || '').trim()
    if (!question) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 })
    }
    if (!ocrText) {
      return NextResponse.json({ error: 'ocrText is required' }, { status: 400 })
    }

    const payload = await backendApiFetch<Record<string, unknown>>(
      '/ai/bharat/ask',
      {
        method: 'POST',
        body: JSON.stringify({
          question,
          ocr_text: ocrText,
          metadata: body.metadata || {},
          target_language_code: String(body.targetLanguageCode || 'en'),
        }),
      },
      ASK_TIMEOUT_MS,
      authToken || undefined
    )

    return NextResponse.json(payload)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.payload || error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to answer invoice question'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
