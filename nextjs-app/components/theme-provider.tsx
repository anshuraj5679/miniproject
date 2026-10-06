'use client'

import { useEffect } from 'react'
import { useThemeStore } from '@/lib/store/theme-store'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, setResolvedTheme } = useThemeStore()

  useEffect(() => {
    const root = window.document.documentElement

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      root.setAttribute('data-theme', systemTheme === 'dark' ? 'night' : 'winter')
      setResolvedTheme(systemTheme)
    } else {
      root.setAttribute('data-theme', theme === 'dark' ? 'night' : 'winter')
      setResolvedTheme(theme as 'light' | 'dark')
    }
  }, [theme, setResolvedTheme])

  return <>{children}</>
}
