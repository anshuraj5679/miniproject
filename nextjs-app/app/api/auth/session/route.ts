import { NextRequest, NextResponse } from 'next/server'

const ACCESS_TOKEN_COOKIE = 'sb_access_token'
const USER_TYPE_COOKIE = 'sb_user_type'
const LEGACY_COOKIES = ['auth_token', 'user_type', 'custom_id']
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function baseCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string
    userType?: string
  }

  const token = String(body.token || '').trim()
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 })
  }

  const userType = String(body.userType || '').trim().toLowerCase()
  const normalizedUserType = userType === 'merchant' ? 'merchant' : 'consumer'

  const response = NextResponse.json({ ok: true })
  response.cookies.set(ACCESS_TOKEN_COOKIE, token, {
    ...baseCookieOptions(),
    maxAge: COOKIE_MAX_AGE_SECONDS,
  })
  response.cookies.set(USER_TYPE_COOKIE, normalizedUserType, {
    ...baseCookieOptions(),
    maxAge: COOKIE_MAX_AGE_SECONDS,
  })
  for (const legacyName of LEGACY_COOKIES) {
    response.cookies.set(legacyName, '', {
      ...baseCookieOptions(),
      maxAge: 0,
    })
  }

  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ACCESS_TOKEN_COOKIE, '', {
    ...baseCookieOptions(),
    maxAge: 0,
  })
  response.cookies.set(USER_TYPE_COOKIE, '', {
    ...baseCookieOptions(),
    maxAge: 0,
  })
  for (const legacyName of LEGACY_COOKIES) {
    response.cookies.set(legacyName, '', {
      ...baseCookieOptions(),
      maxAge: 0,
    })
  }
  return response
}
