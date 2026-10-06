import NextAuth from 'next-auth'
import type { NextAuthOptions } from 'next-auth'

const authOptions: NextAuthOptions = {
    providers: [],
    pages: {
        signIn: '/landing',
        error: '/landing',
    },
    callbacks: {
        async redirect({ url, baseUrl }) {
            // Redirect to the in-app consumer experience after sign in
            if (url.startsWith(baseUrl)) return url
            else if (url.startsWith('/')) return `${baseUrl}${url}`
            return baseUrl + '/chat'
        },
    },
    session: {
        strategy: 'jwt',
    },
    secret: process.env.NEXTAUTH_SECRET,
}

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
