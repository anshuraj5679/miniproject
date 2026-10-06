import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken } from '@/lib/backend-api'

export const runtime = 'nodejs'
const TRANSLATE_TIMEOUT_MS = Number(process.env.BHARAT_AI_TIMEOUT_MS || 120000)

interface BharatTranslateBatchRequestBody {
  texts?: string[]
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

    const body = (await request.json()) as BharatTranslateBatchRequestBody
    const texts = Array.isArray(body.texts)
      ? body.texts.map((item) => String(item || ''))
      : []
    if (!texts.length) {
      return NextResponse.json({ error: 'texts is required' }, { status: 400 })
    }

    const payload = await backendApiFetch<Record<string, unknown>>(
      '/ai/bharat/translate-batch',
      {
        method: 'POST',
        body: JSON.stringify({
          texts,
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
    const message = error instanceof Error ? error.message : 'Failed to translate page content'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
