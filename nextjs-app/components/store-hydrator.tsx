'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/lib/store/auth-store'

export function StoreHydrator() {
  useEffect(() => {
    void useAuthStore.persist.rehydrate()
  }, [])

  return null
}
