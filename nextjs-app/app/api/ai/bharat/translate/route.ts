import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken } from '@/lib/backend-api'

export const runtime = 'nodejs'
const TRANSLATE_TIMEOUT_MS = Number(process.env.BHARAT_AI_TIMEOUT_MS || 120000)

interface BharatTranslateRequestBody {
  text?: string
  targetLanguageCode?: string
  sourceLanguageCode?: string
}

export async function POST(request: NextRequest) {
  try {
    const authToken = resolveRequestAuthToken(request)
    const isProduction = process.env.NODE_ENV === 'production'
    if (isProduction && !authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as BharatTranslateRequestBody
    const text = String(body.text || '').trim()
    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }

    const payload = await backendApiFetch<Record<string, unknown>>(
      '/ai/bharat/translate',
      {
        method: 'POST',
        body: JSON.stringify({
          text,
          target_language_code: String(body.targetLanguageCode || 'en'),
          source_language_code: String(body.sourceLanguageCode || 'auto'),
        }),
      },
      TRANSLATE_TIMEOUT_MS,
      authToken || undefined
    )

    return NextResponse.json(payload)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.payload || error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : 'Failed to translate text'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
