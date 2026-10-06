import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
const VISION_OCR_TIMEOUT_MS = 45000

interface VisionOcrResponse {
  ok?: boolean
  fullText?: string
  fields?: Record<string, unknown>
  error?: string
}

async function extractWithVisionService(file: File): Promise<VisionOcrResponse | null> {
  const base = String(process.env.VISION_OCR_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '')
  const target = `${base}/api/ocr`
  const fd = new FormData()
  fd.append('file', file, file.name)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VISION_OCR_TIMEOUT_MS)
  try {
    const response = await fetch(target, {
      method: 'POST',
      body: fd,
      signal: controller.signal,
    })
    if (!response.ok) return null
    return (await response.json().catch(() => null)) as VisionOcrResponse | null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'No file provided' }, { status: 400 })
    }

    const lowered = file.name.toLowerCase()
    const isPdf = lowered.endsWith('.pdf') || file.type === 'application/pdf'
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|tiff?)$/.test(lowered)
    if (!isPdf && !isImage) {
      return NextResponse.json(
        { ok: false, error: 'Only PDF and image files are supported.' },
        { status: 400 }
      )
    }

    const payload = await extractWithVisionService(file)
    if (!payload?.ok) {
      return NextResponse.json(
        { ok: false, error: payload?.error || 'Google Vision OCR service is unavailable.' },
        { status: 502 }
      )
    }

    return NextResponse.json({
      ok: true,
      fullText: String(payload.fullText || ''),
      fields: payload.fields || {},
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OCR demo failed.'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
