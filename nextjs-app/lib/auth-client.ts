import { getSupabaseBrowserClient } from '@/lib/supabase'
import type { User, UserType } from '@/lib/types'

export interface UserProfileRow {
  custom_id: string | null
  user_type: string | null
  full_name: string | null
}

/**
 * Read the signed-in user's profile. Profiles are created server-side
 * (backend/sql/008_supabase_auth_hardening.sql); if none exists yet, e.g. a first
 * Google sign-in, claim one with the requested role. The role can only be set once.
 */
export async function loadOrClaimProfile(
  userId: string,
  requestedUserType: UserType
): Promise<UserProfileRow | null> {
  const supabase = getSupabaseBrowserClient()
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('custom_id, user_type, full_name')
    .eq('user_id', userId)
    .maybeSingle()
  if (existing) return existing as UserProfileRow

  const { data: claimed, error } = await supabase.rpc('safebill_claim_profile', {
    requested_user_type: requestedUserType,
  })
  if (error) {
    console.error('Failed to create SafeBill profile:', error.message)
    return null
  }
  const row = (Array.isArray(claimed) ? claimed[0] : claimed) as UserProfileRow | null
  return row?.custom_id ? row : null
}

/**
 * Get a fresh access token. supabase-js refreshes the session when it is close
 * to expiry, so this also recovers after the 1-hour access token lifetime.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient()
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) return null
  const expiresAtMs = (session.expires_at || 0) * 1000
  if (expiresAtMs - Date.now() > 60_000) return session.access_token
  const { data: refreshed, error } = await supabase.auth.refreshSession()
  if (error || !refreshed.session) return null
  return refreshed.session.access_token
}

/** Turn Supabase Auth errors into messages a user can act on. */
function friendlyAuthError(message: string | undefined, fallback: string): string {
  const text = (message || '').toLowerCase()
  if (text.includes('email not confirmed')) {
    return 'Your email is not confirmed yet. Open the SafeBill email (check Spam/Promotions too), or sign up again with the same email to get a new link.'
  }
  if (text.includes('rate limit')) {
    return 'Too many emails were sent recently. Please wait a few minutes and try again.'
  }
  if (text.includes('error sending') || text.includes('sending confirmation')) {
    return 'We could not send the confirmation email right now. Please try again later.'
  }
  if (text.includes('invalid login credentials')) {
    return 'Incorrect email or password.'
  }
  return message || fallback
}

export interface SignInResult {
  token: string
  user: User
  userType: UserType
}

/**
 * Sign in with email/phone + password via Supabase Auth.
 */
/**
 * Sign in with a Consumer/Merchant ID. The server resolves the ID to the account email
 * (never exposed to the browser) and returns session tokens, which are installed in the
 * Supabase client so token refresh works as for an email login.
 */
async function signInWithSafeBillId(customId: string, password: string, userType: UserType) {
  const response = await fetch('/api/auth/login-id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customId, password, userType }),
  })
  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; error?: string }
    | null
  if (!response.ok || !payload?.access_token || !payload.refresh_token) {
    throw new Error(payload?.error || 'Login failed. Please try again.')
  }
  return getSupabaseBrowserClient().auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  })
}

export async function signInWithIdentifier(params: {
  identifier: string
  password: string
  userType: UserType
}): Promise<SignInResult> {
  const supabase = getSupabaseBrowserClient()

  const identifier = params.identifier.trim()
  const isEmail = identifier.includes('@')
  const isSafeBillId = /^(CON|MER)-/i.test(identifier)

  const { data, error } = isSafeBillId
    ? await signInWithSafeBillId(identifier, params.password, params.userType)
    : isEmail
      ? await supabase.auth.signInWithPassword({ email: identifier, password: params.password })
      : await supabase.auth.signInWithPassword({ phone: identifier, password: params.password })

  if (error || !data.session || !data.user) {
    throw new Error(friendlyAuthError(error?.message, 'Login failed. Please try again.'))
  }

  // The profile is created server-side; claim it if this account predates that.
  const profile = await loadOrClaimProfile(data.user.id, params.userType)

  const userType = (profile?.user_type as UserType) || params.userType
  const customId = profile?.custom_id || undefined

  // Each account has one role. Logging in on the other tab must not silently open the
  // other portal, so sign back out and say which tab this account belongs to.
  if (userType !== params.userType) {
    await supabase.auth.signOut()
    const accountRole = userType === 'merchant' ? 'Merchant' : 'Consumer'
    const requestedRole = params.userType === 'merchant' ? 'Merchant' : 'Consumer'
    throw new Error(
      `This is a ${accountRole} account. Choose "${accountRole}" to log in with it. ` +
        `To use the ${requestedRole} portal, sign up for a ${requestedRole} account with a different email.`
    )
  }

  const user: User = {
    userId: data.user.id,
    email: data.user.email,
    phone: data.user.phone || undefined,
    name: profile?.full_name || data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'User',
    userType,
    customId,
    provider: data.user.app_metadata?.provider || 'email',
  }

  return {
    token: data.session.access_token,
    user,
    userType,
  }
}

/**
 * Sign up with email/phone + password via Supabase Auth.
 * Creates user_profiles row with custom SafeBill ID.
 */
export async function signUpWithIdentifier(params: {
  identifier: string
  password: string
  name: string
  userType: UserType
}): Promise<{
  user: User
  token: string
  userType: UserType
  customId: string
  needsVerification: boolean
}> {
  const supabase = getSupabaseBrowserClient()
  const isEmail = params.identifier.includes('@')

  // Generate custom SafeBill ID
  const prefix = params.userType === 'merchant' ? 'MER' : 'CON'
  const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join('')
  const customId = `${prefix}-${randomHex}`

  const signUpPayload = isEmail
    ? {
        email: params.identifier.trim(),
        password: params.password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: {
            full_name: params.name.trim(),
            user_type: params.userType,
            custom_id: customId,
          },
        },
      }
    : {
        phone: params.identifier.trim(),
        password: params.password,
        options: {
          data: {
            full_name: params.name.trim(),
            user_type: params.userType,
            custom_id: customId,
          },
        },
      }

  const { data, error } = await supabase.auth.signUp(signUpPayload)

  if (error || !data.user) {
    throw new Error(friendlyAuthError(error?.message, 'Signup failed.'))
  }

  // For an email that is already registered, Supabase answers "success" with an empty
  // identities list and sends no email (so attackers cannot probe which emails exist).
  if (isEmail && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error(
      'An account with this email already exists. Please log in, or use "Forgot password" if you do not remember it. ' +
        'Each email can hold one account, so a separate Consumer or Merchant account needs a different email.'
    )
  }

  const needsVerification = !data.session

  // A database trigger creates the profile (and may assign a different ID on collision).
  const profile = data.session ? await loadOrClaimProfile(data.user.id, params.userType) : null
  const resolvedCustomId = profile?.custom_id || customId
  const resolvedUserType = (profile?.user_type as UserType) || params.userType

  const user: User = {
    userId: data.user.id,
    email: data.user.email,
    phone: data.user.phone || undefined,
    name: params.name.trim(),
    userType: resolvedUserType,
    customId: resolvedCustomId,
    provider: 'email',
  }

  return {
    user,
    token: data.session?.access_token || '',
    userType: resolvedUserType,
    customId: resolvedCustomId,
    needsVerification,
  }
}

/**
 * Send the sign-up confirmation email again.
 */
export async function resendSignupConfirmation(email: string): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo: `${window.location.origin}/login` },
  })
  if (error) {
    throw new Error(friendlyAuthError(error.message, 'Could not resend the email.'))
  }
}

/**
 * Sign in with Google OAuth via Supabase Auth.
 */
export async function signInWithGoogle(userType: UserType) {
  const supabase = getSupabaseBrowserClient()

  const redirectUrl = `${window.location.origin}/auth/callback?userType=${userType}`

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  })

  if (error) {
    throw new Error(error.message || 'Google sign-in failed.')
  }
}

/**
 * Request password reset email.
 */
export async function forgotPassword(email: string): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/auth/reset-password`,
  })
  if (error) {
    throw new Error(error.message || 'Failed to send reset email.')
  }
}

/**
 * Reset password with a new password (called from the reset link).
 */
export async function resetPassword(newPassword: string): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) {
    throw new Error(error.message || 'Failed to reset password.')
  }
}

/**
 * Sign out the current user.
 */
export async function signOut(): Promise<void> {
  const supabase = getSupabaseBrowserClient()
  await supabase.auth.signOut()
}

/**
 * Persist user type cookie for middleware route protection.
 */
export function persistClientAuthCookies(token: string, userType: UserType) {
  if (token) {
    document.cookie = `sb_access_token=${token}; path=/; max-age=${60 * 60 * 24 * 7}`
  }
  document.cookie = `sb_user_type=${userType}; path=/; max-age=${60 * 60 * 24 * 7}`
}
