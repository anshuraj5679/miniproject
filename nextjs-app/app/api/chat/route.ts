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
    docId?: string
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

interface FallbackDocument {
  sellerName?: string
  totalAmount?: number | null
  items?: Array<{
    invoiceNo?: string
    purchaseDate?: string
    purchasePrice?: number | null
    productName?: string
    warrantyEnd?: string
  }>
}

function isNoGroundedRecords(answer: string | undefined): boolean {
  const text = String(answer || '').trim().toLowerCase()
  return text.includes('no relevant grounded records were found')
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

    const normalizedUserId =
      body.userId && body.userId.trim().toLowerCase() !== 'anonymous'
        ? body.userId.trim()
        : ''
    const filters: Record<string, string> = {}
    if (normalizedUserId) filters.user_id = normalizedUserId
    if (body.docContext?.invoiceNumber) filters.bill_id = body.docContext.invoiceNumber
    if (body.docContext?.store) filters.vendor = body.docContext.store

    const askPayload = {
      query: message,
      top_k: 8,
      filters,
      user_latitude: body.location?.latitude,
      user_longitude: body.location?.longitude,
    }

    let answer = await backendApiFetch<AskResponsePayload>(
      '/ask',
      {
        method: 'POST',
        body: JSON.stringify(askPayload),
      },
      CHAT_BACKEND_TIMEOUT_MS,
      authToken
    )

    if (isNoGroundedRecords(answer.answer) && (filters.bill_id || filters.vendor)) {
      const relaxedPayload = {
        query: message,
        top_k: 8,
        filters: normalizedUserId ? { user_id: normalizedUserId } : {},
        user_latitude: body.location?.latitude,
        user_longitude: body.location?.longitude,
      }
      answer = await backendApiFetch<AskResponsePayload>(
        '/ask',
        {
          method: 'POST',
          body: JSON.stringify(relaxedPayload),
        },
        CHAT_BACKEND_TIMEOUT_MS,
        authToken
      )
    }

    if (isNoGroundedRecords(answer.answer) && body.docContext?.docId) {
      try {
        const doc = await backendApiFetch<FallbackDocument>(
          `/documents/${body.docContext.docId}`,
          { method: 'GET' },
          CHAT_BACKEND_TIMEOUT_MS,
          authToken
        )
        const item = doc.items?.[0]
        const amount =
          doc.totalAmount !== null && doc.totalAmount !== undefined
            ? doc.totalAmount
            : item?.purchasePrice
        const parts = [
          item?.productName ? `Product: ${item.productName}` : '',
          item?.invoiceNo ? `Invoice: ${item.invoiceNo}` : '',
          doc.sellerName ? `Vendor: ${doc.sellerName}` : '',
          item?.purchaseDate ? `Purchase date: ${item.purchaseDate}` : '',
          amount !== null && amount !== undefined
            ? `Amount: INR ${amount}`
            : '',
          item?.warrantyEnd ? `Warranty end: ${item.warrantyEnd}` : '',
        ].filter(Boolean)
        if (parts.length) {
          answer = {
            ...answer,
            answer: `I could not use grounded chunks for this query, but from this document: ${parts.join(' | ')}`,
          }
        }
      } catch {
        // Keep original answer when fallback fetch fails.
      }
    }

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
