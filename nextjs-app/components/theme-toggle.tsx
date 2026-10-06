'use client'

import { Moon, Sun } from 'lucide-react'
import { useThemeStore } from '@/lib/store/theme-store'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useThemeStore()

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <label className="btn btn-ghost btn-circle swap swap-rotate">
      <input
        type="checkbox"
        checked={resolvedTheme === 'dark'}
        onChange={toggleTheme}
        aria-label="Toggle theme"
      />
      <Sun className="swap-off w-5 h-5" />
      <Moon className="swap-on w-5 h-5" />
    </label>
  )
}
