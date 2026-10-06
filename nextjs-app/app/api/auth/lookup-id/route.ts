import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

interface LookupRequestBody {
  customId?: string
  userType?: string
}

export async function POST(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdminClient()
    const body = (await request.json()) as LookupRequestBody
    const customId = String(body.customId || '').trim().toUpperCase()
    const userType = String(body.userType || '').trim().toLowerCase()
    if (!customId || !['consumer', 'merchant'].includes(userType)) {
      return NextResponse.json(
        { error: 'customId and valid userType are required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, full_name, user_type, custom_id')
      .eq('custom_id', customId)
      .eq('user_type', userType)
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    const row = data as {
      user_id: string
      email: string
      full_name: string
      user_type: string
      custom_id: string
    }

    return NextResponse.json({
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      userType: row.user_type,
      customId: row.custom_id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lookup failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
