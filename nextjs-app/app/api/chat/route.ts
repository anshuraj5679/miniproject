import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken } from '@/lib/backend-api'

export const runtime = 'nodejs'
const CHAT_BACKEND_TIMEOUT_MS = Number(process.env.BACKEND_CHAT_TIMEOUT_MS || 120000)

interface ChatRequestPayload {
  message?: string
  userId?: string
  location?: {
    latitude: number
    longitude: number
  }
  docContext?: {
    invoiceNumber?: string
    store?: string
  }
}

interface AskCitation {
  document_id: string
  bill_id: string
  score: number
  excerpt: string
}

interface AskExtractionTrace {
  field: string
  value?: string | number | boolean | null
  confidence?: number | null
  source?: string | null
  reason: string
  citations: string[]
}

interface AskResponsePayload {
  answer: string
  confidence_score: number
  qa_log_id: string
  citations: AskCitation[]
  extraction_trace?: AskExtractionTrace[]
  service_centers?: Array<{
    name: string
    address: string
    latitude: number
    longitude: number
    distance_km?: number | null
    source?: string
    confidence?: string
    map_url?: string | null
    city?: string | null
    phone?: string | null
    website?: string | null
    pincode?: string | null
    pickup_available?: boolean | null
    estimated_tat_days?: number | null
  }>
}

export async function POST(request: NextRequest) {
  try {
    const authToken = resolveRequestAuthToken(request)
    if (!authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as ChatRequestPayload
    const message = body.message?.trim()
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const filters: Record<string, string> = {}
    if (body.userId) filters.user_id = body.userId
    if (body.docContext?.invoiceNumber) filters.bill_id = body.docContext.invoiceNumber
    if (body.docContext?.store) filters.vendor = body.docContext.store

    const askPayload = {
      query: message,
      top_k: 8,
      filters,
      user_latitude: body.location?.latitude,
      user_longitude: body.location?.longitude,
    }

    const answer = await backendApiFetch<AskResponsePayload>(
      '/ask',
      {
        method: 'POST',
        body: JSON.stringify(askPayload),
      },
      CHAT_BACKEND_TIMEOUT_MS,
      authToken
    )

    const timestamp = new Date().toISOString()
    return NextResponse.json({
      answer: answer.answer,
      confidenceScore: answer.confidence_score,
      qaLogId: answer.qa_log_id,
      citations: answer.citations,
      extractionTrace: answer.extraction_trace || [],
      serviceCenters: answer.service_centers || [],
      message: {
        id: Date.now().toString(),
        role: 'assistant',
        content: answer.answer,
        timestamp,
        sources: answer.citations.map((citation) => ({
          docId: citation.bill_id,
          chunk: citation.excerpt,
          score: citation.score,
        })),
      },
    })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
    ) {
      const timeoutMessage =
        'Service-center lookup took too long. Please try again with company + city + range (for example: Samsung in Delhi within 40 km).'
      return NextResponse.json({
        answer: timeoutMessage,
        confidenceScore: 0,
        qaLogId: null,
        citations: [],
        serviceCenters: [],
        message: {
          id: Date.now().toString(),
          role: 'assistant',
          content: timeoutMessage,
          timestamp: new Date().toISOString(),
          sources: [],
        },
      })
    }

    if (error instanceof BackendApiError) {
      return NextResponse.json(
        { error: error.payload || error.message },
        { status: error.status }
      )
    }
    const message = error instanceof Error ? error.message : 'Failed to process chat request'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
