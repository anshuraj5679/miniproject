import { NextRequest, NextResponse } from 'next/server'
import { BackendApiError, backendApiFetch, resolveRequestAuthToken } from '@/lib/backend-api'

export const runtime = 'nodejs'

interface ManualBillRequestBody {
  merchantUserId?: string
  merchantName?: string
  merchantCustomId?: string
  consumerUserId?: string
  consumerCustomId?: string
  consumerName?: string
  consumerEmail?: string
  productName?: string
  category?: string
  billId?: string
  vendor?: string
  purchaseDate?: string
  totalAmount?: number
  warrantyMonths?: number
  serialNumber?: string
  notes?: string
}

export async function POST(request: NextRequest) {
  try {
    const authToken = resolveRequestAuthToken(request)
    if (!authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as ManualBillRequestBody
    if (!body.merchantUserId || !body.consumerUserId || !body.productName) {
      return NextResponse.json(
        { error: 'merchantUserId, consumerUserId and productName are required' },
        { status: 400 }
      )
    }

    const backendPayload = {
      merchant_user_id: body.merchantUserId,
      merchant_name: body.merchantName,
      merchant_custom_id: body.merchantCustomId,
      consumer_user_id: body.consumerUserId,
      consumer_custom_id: body.consumerCustomId,
      consumer_name: body.consumerName,
      consumer_email: body.consumerEmail,
      product_name: body.productName,
      category: body.category || 'Others',
      bill_id: body.billId,
      vendor: body.vendor,
      purchase_date: body.purchaseDate,
      total_amount: body.totalAmount,
      warranty_months: body.warrantyMonths ?? 12,
      serial_number: body.serialNumber,
      notes: body.notes,
    }

    const response = await backendApiFetch<unknown>('/merchant/manual-bill', {
      method: 'POST',
      body: JSON.stringify(backendPayload),
    }, undefined, authToken)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BackendApiError) {
      return NextResponse.json(
        { error: error.payload || error.message },
        { status: error.status }
      )
    }
    const message = error instanceof Error ? error.message : 'Failed to create manual bill'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
