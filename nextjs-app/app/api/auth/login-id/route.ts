import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { createSupabaseServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

// Sign in with a SafeBill ID (CON-XXXXXXXX / MER-XXXXXXXX) + password.
// Supabase Auth only knows emails, so the server resolves the ID to the account's email and
// signs in here; the email is never sent to the browser, only the session tokens.

const CUSTOM_ID_PATTERN = /^(CON|MER)-[A-Z0-9]{4,16}$/
const INVALID_CREDENTIALS = 'Incorrect ID or password.'

// Basic brute-force protection: attempts per client IP + ID within the window.
const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 8
const attempts = new Map<string, { count: number; resetAt: number }>()

function rateLimited(key: string): boolean {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  entry.count += 1
  return entry.count > MAX_ATTEMPTS
}

function clientIp(request: NextRequest): string {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    customId?: string
    password?: string
    userType?: string
  }
  const customId = String(body.customId || '').trim().toUpperCase()
  const password = String(body.password || '')
  const userType = String(body.userType || '').trim().toLowerCase()

  if (!CUSTOM_ID_PATTERN.test(customId) || !password) {
    return NextResponse.json({ error: 'Enter your SafeBill ID (e.g. CON-1A2B3C4D) and password.' }, { status: 400 })
  }
  const idType = customId.startsWith('MER-') ? 'merchant' : 'consumer'
  if (userType && userType !== idType) {
    const label = idType === 'merchant' ? 'Merchant' : 'Consumer'
    return NextResponse.json({ error: `This is a ${label} ID. Switch to ${label} login and try again.` }, { status: 400 })
  }
  if (rateLimited(`${clientIp(request)}:${customId}`)) {
    return NextResponse.json({ error: 'Too many attempts. Please wait 15 minutes and try again.' }, { status: 429 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'ID login is not configured on the server.' }, { status: 503 })
  }

  const admin = createSupabaseServiceClient()
  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('user_id')
    .eq('custom_id', customId)
    .maybeSingle()
  if (profileError) {
    console.error('login-id profile lookup failed:', profileError.message)
    return NextResponse.json({ error: 'Login is temporarily unavailable.' }, { status: 503 })
  }
  if (!profile?.user_id) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 })
  }

  // Use the current email on the auth account; the profile copy can be out of date.
  const { data: account } = await admin.auth.admin.getUserById(profile.user_id)
  const email = account?.user?.email
  if (!email) {
    return NextResponse.json(
      { error: 'This account has no email address. Log in with your phone number instead.' },
      { status: 400 }
    )
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    const message = (error?.message || '').toLowerCase()
    if (message.includes('email not confirmed')) {
      return NextResponse.json(
        { error: 'Your email is not confirmed yet. Open the SafeBill confirmation email, then log in.' },
        { status: 403 }
      )
    }
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 })
  }

  attempts.delete(`${clientIp(request)}:${customId}`)
  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
}
