import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken, withQuery } from '@/lib/backend-api'

export const runtime = 'nodejs'
const INGEST_TIMEOUT_MS = 120000
const DOCUMENT_FETCH_TIMEOUT_MS = 60000

interface IngestResponse {
  document_id: string
  chunk_count: number
  bill_id: string
  vendor: string
  created_at: string
}

interface BackendWarrantyItem {
  productName?: string
  model?: string
  invoiceNo?: string
  purchaseDate?: string
  purchasePrice?: number
  quantity?: number
  unitPrice?: number
  gstAmount?: number
  warrantyMonths?: number
  warrantyStart?: string
  warrantyEnd?: string
  serialNumber?: string
}

interface ScanLineItem {
  name: string
  amount: string
  quantity?: number
  unitPrice?: number
  gstAmount?: number
}

interface BackendDocument {
  docId: string
  title: string
  rawText?: string
  sellerName?: string
  category?: string
  reviewRequired?: boolean
  lowConfidenceFields?: string[]
  taxableAmount?: number
  gstAmount?: number
  gstRate?: number
  cgstAmount?: number
  sgstAmount?: number
  igstAmount?: number
  items: BackendWarrantyItem[]
}

function toScanPayload(document: BackendDocument, fileName: string) {
  const items: ScanLineItem[] = (document.items || [])
    .map((entry) => ({
      name: entry.productName || '',
      amount:
        entry.purchasePrice !== undefined && entry.purchasePrice !== null
          ? String(entry.purchasePrice)
          : '',
      quantity:
        entry.quantity !== undefined && entry.quantity !== null ? entry.quantity : undefined,
      unitPrice:
        entry.unitPrice !== undefined && entry.unitPrice !== null ? entry.unitPrice : undefined,
      gstAmount:
        entry.gstAmount !== undefined && entry.gstAmount !== null ? entry.gstAmount : undefined,
    }))
    .filter((entry) => entry.name || entry.amount)

  const item = document.items?.[0] || {}
  const warrantyMonths = item.warrantyMonths
  return {
    docId: document.docId,
    title: document.title || fileName.replace(/\.[^/.]+$/, ''),
    fileName,
    reviewRequired: Boolean(document.reviewRequired),
    lowConfidenceFields: document.lowConfidenceFields || [],
    extractedText: document.rawText || '',
    details: {
      productName: item.productName || document.title || '',
      brand: item.model || document.sellerName || '',
      category: document.category || 'Others',
      amount: item.purchasePrice !== undefined && item.purchasePrice !== null ? String(item.purchasePrice) : '',
      purchaseDate: item.purchaseDate || '',
      warrantyPeriod: warrantyMonths ? `${warrantyMonths} Month(s)` : '',
      warrantyStart: item.warrantyStart || '',
      warrantyEnd: item.warrantyEnd || '',
      serialNumber: item.serialNumber || '',
      invoiceNumber: item.invoiceNo || '',
      store: document.sellerName || '',
      itemCount: items.length,
      items,
      gstAmount:
        item.gstAmount !== undefined && item.gstAmount !== null
          ? String(item.gstAmount)
          : document.gstAmount !== undefined && document.gstAmount !== null
            ? String(document.gstAmount)
            : '',
      gstRate: document.gstRate !== undefined && document.gstRate !== null ? String(document.gstRate) : '',
      taxableAmount: document.taxableAmount !== undefined && document.taxableAmount !== null ? String(document.taxableAmount) : '',
      cgstAmount: document.cgstAmount !== undefined && document.cgstAmount !== null ? String(document.cgstAmount) : '',
      sgstAmount: document.sgstAmount !== undefined && document.sgstAmount !== null ? String(document.sgstAmount) : '',
      igstAmount: document.igstAmount !== undefined && document.igstAmount !== null ? String(document.igstAmount) : '',
    },
  }
}

export async function POST(request: NextRequest) {
  try {
    const authToken = resolveRequestAuthToken(request)
    if (!authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    const userId = String(formData.get('userId') || '').trim()
    const consumerEmail = String(formData.get('consumerEmail') || '').trim()

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const lowered = file.name.toLowerCase()
    const isPdf = lowered.endsWith('.pdf') || file.type === 'application/pdf'
    const isImage =
      file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|tiff?)$/.test(lowered)
    if (!isPdf && !isImage) {
      return NextResponse.json(
        { error: 'Only PDF and image files are supported.' },
        { status: 400 }
      )
    }

    const backendFormData = new FormData()
    backendFormData.append('file', file, file.name)
    if (userId) backendFormData.append('user_id', userId)
    if (consumerEmail) backendFormData.append('consumer_email', consumerEmail)

    const ingestPath = isPdf ? '/ingest/pdf' : '/ingest/image'
    const ingest = await backendApiFetch<IngestResponse>(ingestPath, {
      method: 'POST',
      body: backendFormData,
    }, INGEST_TIMEOUT_MS, authToken)

    const document = await backendApiFetch<BackendDocument>(
      withQuery(`/documents/${ingest.document_id}`, { user_id: userId || undefined }),
      { method: 'GET' },
      DOCUMENT_FETCH_TIMEOUT_MS,
      authToken
    )

    return NextResponse.json({
      document: toScanPayload(document, file.name),
      ingestion: ingest,
    })
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json(
        { error: error.payload || error.message },
        { status: error.status }
      )
    }
    const message = error instanceof Error ? error.message : 'Failed to process file'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
