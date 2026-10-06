'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Package, type LucideIcon } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

interface GenerateProductImageResponse {
  productImageAvailable?: boolean
  imageUrl?: string
}

interface ProductVisualProps {
  docId?: string | null
  alt: string
  productImageAvailable?: boolean
  productImageGeneratedAt?: string | null
  autoGenerate?: boolean
  fallbackIcon?: LucideIcon
  className?: string
  imageClassName?: string
  fallbackClassName?: string
}

const resolvedImages = new Set<string>()
const failedImages = new Set<string>()
const generationJobs = new Map<string, Promise<boolean>>()

function joinClasses(...values: Array<string | undefined | null | false>) {
  return values.filter(Boolean).join(' ')
}

async function ensureProductImage(docId: string): Promise<boolean> {
  if (resolvedImages.has(docId)) return true
  if (failedImages.has(docId)) return false
  const existing = generationJobs.get(docId)
  if (existing) return existing

  const job = apiClient
    .post<GenerateProductImageResponse>(`/documents/${docId}/product-image/generate`, {})
    .then((response) => {
      const success = Boolean(response?.productImageAvailable)
      if (success) {
        resolvedImages.add(docId)
        failedImages.delete(docId)
      } else {
        failedImages.add(docId)
      }
      return success
    })
    .catch(() => {
      return false
    })
    .finally(() => {
      generationJobs.delete(docId)
    })

  generationJobs.set(docId, job)
  return job
}

export function ProductVisual({
  docId,
  alt,
  productImageAvailable,
  productImageGeneratedAt,
  autoGenerate = true,
  fallbackIcon: FallbackIcon = Package,
  className,
  imageClassName,
  fallbackClassName,
}: ProductVisualProps) {
  const [hasImage, setHasImage] = useState(Boolean(docId && (productImageAvailable || resolvedImages.has(docId))))
  const [isGenerating, setIsGenerating] = useState(false)
  const [cacheBust, setCacheBust] = useState(() =>
    productImageGeneratedAt ? Date.parse(productImageGeneratedAt) || Date.now() : Date.now()
  )

  useEffect(() => {
    if (docId && productImageAvailable) {
      resolvedImages.add(docId)
      failedImages.delete(docId)
      setHasImage(true)
      if (productImageGeneratedAt) {
        setCacheBust(Date.parse(productImageGeneratedAt) || Date.now())
      }
    }
  }, [docId, productImageAvailable, productImageGeneratedAt])

  useEffect(() => {
    if (!autoGenerate || !docId || hasImage || failedImages.has(docId)) return
    let alive = true
    setIsGenerating(true)
    void ensureProductImage(docId).then((success) => {
      if (!alive) return
      setIsGenerating(false)
      if (success) {
        setHasImage(true)
        setCacheBust(Date.now())
      }
    })
    return () => {
      alive = false
    }
  }, [autoGenerate, docId, hasImage])

  const imageSrc = useMemo(() => {
    if (!docId || !hasImage) return null
    return `/api/documents/${docId}/product-image?v=${cacheBust}`
  }, [cacheBust, docId, hasImage])

  return (
    <div className={joinClasses('relative overflow-hidden', className)}>
      {imageSrc ? (
        <Image
          src={imageSrc}
          alt={alt}
          fill
          unoptimized
          sizes="(max-width: 768px) 96px, 160px"
          className={joinClasses('h-full w-full object-cover', imageClassName)}
          onError={() => {
            if (docId) failedImages.add(docId)
            setHasImage(false)
          }}
        />
      ) : (
        <div className={joinClasses('flex h-full w-full items-center justify-center bg-slate-100 text-slate-500', fallbackClassName)}>
          {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <FallbackIcon className="h-5 w-5" />}
        </div>
      )}
    </div>
  )
}
