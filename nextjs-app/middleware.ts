import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that require authentication
const consumerRoutes = ['/locker', '/scan', '/chat', '/claims', '/reminders', '/document', '/settings']
const merchantRoutes = ['/merchant-dashboard']
const protectedRoutes = [...consumerRoutes, ...merchantRoutes]
const ACCESS_TOKEN_COOKIE = 'sb_access_token'
const USER_TYPE_COOKIE = 'sb_user_type'

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    // Check if user has auth token in cookies
    const authToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value
    const userType = request.cookies.get(USER_TYPE_COOKIE)?.value

    // Check if route is protected
    const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route))
    const isConsumerRoute = consumerRoutes.some(route => pathname.startsWith(route))
    const isMerchantRoute = merchantRoutes.some(route => pathname.startsWith(route))

    // Redirect to landing if accessing protected route without auth
    if (isProtectedRoute && !authToken) {
        const url = new URL('/landing', request.url)
        return NextResponse.redirect(url)
    }

    if (authToken && userType) {
        if (isMerchantRoute && userType !== 'merchant') {
            const url = new URL('/locker', request.url)
            return NextResponse.redirect(url)
        }
        if (isConsumerRoute && userType === 'merchant') {
            const url = new URL('/merchant-dashboard', request.url)
            return NextResponse.redirect(url)
        }
    }

    // Do NOT redirect away from landing/root even if authenticated
    // Let the user access the login page whenever they want

    return NextResponse.next()
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
}
