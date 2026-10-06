'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/lib/store/auth-store'
import { useThemeStore } from '@/lib/store/theme-store'

export function StoreHydrator() {
  useEffect(() => {
    void useAuthStore.persist.rehydrate()
    void useThemeStore.persist.rehydrate()
  }, [])

  return null
}
