import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken } from '@/lib/backend-api'

export const runtime = 'nodejs'
const ENRICH_TIMEOUT_MS = Number(process.env.BHARAT_AI_TIMEOUT_MS || 120000)

interface BharatEnrichRequestBody {
  ocrText?: string
  metadata?: Record<string, unknown>
  targetLanguageCode?: string
  includeSpeech?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const authToken = resolveRequestAuthToken(request)
    const isProduction = process.env.NODE_ENV === 'production'
    if (isProduction && !authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as BharatEnrichRequestBody
    const ocrText = String(body.ocrText || '').trim()
    if (!ocrText) {
      return NextResponse.json({ error: 'ocrText is required' }, { status: 400 })
    }

    const payload = await backendApiFetch<Record<string, unknown>>(
      '/ai/bharat/enrich',
      {
        method: 'POST',
        body: JSON.stringify({
          ocr_text: ocrText,
          metadata: body.metadata || {},
          target_language_code: String(body.targetLanguageCode || 'en'),
          include_speech: Boolean(body.includeSpeech),
        }),
      },
      ENRICH_TIMEOUT_MS,
      authToken || undefined
    )

    return NextResponse.json(payload)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.payload || error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to enrich OCR payload'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
