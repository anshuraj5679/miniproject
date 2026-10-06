'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ArrowLeft, FileText, ScanLine, Sparkles, Upload } from 'lucide-react'
import { useGsapReveal } from '@/lib/gsap-helpers'

type DemoFields = {
  invoiceNo: string | null
  purchaseDate: string | null
  amount: string | null
  vendor: string | null
}

interface DemoOcrApiResponse {
  ok?: boolean
  fullText?: string
  error?: string
}

function extractDemoFields(rawText: string): DemoFields {
  const text = rawText.replace(/\s+/g, ' ').trim()

  const invoiceNo =
    text.match(/invoice(?:\s*(?:number|no|#))?\s*[:\-]?\s*([A-Z0-9\-\/]{4,})/i)?.[1] || null

  const purchaseDate =
    text.match(/\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/)?.[1] ||
    text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ||
    null

  const amount =
    text.match(
      /(?:grand\s*total|total\s*amount|amount\s*payable|total)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i
    )?.[1] || null

  const vendor =
    text.match(/sold\s*by\s*[:\-]?\s*([A-Za-z0-9&.,'\-\s]{3,70})/i)?.[1]?.trim() ||
    text.match(/seller\s*[:\-]?\s*([A-Za-z0-9&.,'\-\s]{3,70})/i)?.[1]?.trim() ||
    null

  return { invoiceNo, purchaseDate, amount, vendor }
}

export function ScanDemoScreen() {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [ocrText, setOcrText] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useGsapReveal(rootRef, [Boolean(file), Boolean(ocrText), isRunning, error, progress])

  const extracted = useMemo(() => extractDemoFields(ocrText), [ocrText])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    if (!selected) return

    setFile(selected)
    setOcrText('')
    setError(null)
    setProgress(0)

    if (selected.type.startsWith('image/')) {
      const nextPreview = URL.createObjectURL(selected)
      setPreviewUrl(nextPreview)
    } else {
      setPreviewUrl(null)
    }
  }

  const runOcrDemo = async () => {
    if (!file) return

    setIsRunning(true)
    setProgress(0)
    setError(null)
    setOcrText('')

    try {
      setProgress(20)
      const formData = new FormData()
      formData.append('file', file, file.name)
      const response = await fetch('/api/scan/demo-ocr', {
        method: 'POST',
        body: formData,
      })
      setProgress(75)

      const payload = (await response.json().catch(() => null)) as DemoOcrApiResponse | null
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'OCR demo failed.')
      }

      const text = String(payload.fullText || '').trim()
      if (!text) {
        throw new Error('No text was detected in the uploaded document.')
      }
      setOcrText(text)
      setProgress(100)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'OCR demo failed.')
    } finally {
      setIsRunning(false)
    }
  }

  const clearDemo = () => {
    setFile(null)
    setPreviewUrl(null)
    setOcrText('')
    setError(null)
    setProgress(0)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div ref={rootRef} className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <Image src="/safebill-locker-bg.png" alt="" fill className="object-cover opacity-20" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,rgba(99,102,241,0.25),rgba(2,6,23,0.92)_45%,rgba(2,6,23,1)_100%)]" />
        <div className="noise-overlay absolute inset-0 opacity-35" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-12 pt-6 md:px-8">
        <header data-gsap="hero" className="mb-6 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl md:p-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/')}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-white md:text-2xl">Scan + OCR Demo</h1>
              <p className="text-xs text-slate-400 md:text-sm">Demo only: extract text and key fields from invoice images.</p>
            </div>
          </div>
          <div className="badge badge-outline border-indigo-300/40 bg-indigo-500/10 text-indigo-100">
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Demo Mode
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-2">
          <section data-gsap="card" className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
            <p className="mb-2 text-sm font-semibold text-white">1) Upload invoice image</p>
            <p className="mb-4 text-xs text-slate-400">Supported in demo: image files and PDF (`.png`, `.jpg`, `.jpeg`, `.pdf`).</p>

            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileChange}
                className="file-input file-input-bordered w-full border-white/15 bg-white/5"
              />

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={runOcrDemo}
                  disabled={!file || isRunning}
                  data-gsap-hover="lift"
                  className="glow-button inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <ScanLine className="h-4 w-4" />
                  {isRunning ? 'Running OCR...' : 'Run OCR Demo'}
                </button>
                <button
                  onClick={clearDemo}
                  disabled={isRunning}
                  data-gsap-hover="lift"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/12"
                >
                  <Upload className="h-4 w-4" />
                  Reset
                </button>
              </div>
            </div>

            {isRunning && (
              <div className="mt-4">
                <progress className="progress progress-primary w-full" value={progress} max={100}></progress>
                <p className="mt-1 text-xs text-slate-400">{progress}% complete</p>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-red-300/25 bg-red-500/10 p-3 text-sm text-red-100">
                {error}
              </div>
            )}

            {previewUrl && (
              <div className="relative mt-4 h-[360px] overflow-hidden rounded-xl border border-white/10 bg-slate-900/60">
                <Image src={previewUrl} alt="Invoice preview" fill unoptimized className="object-contain" />
              </div>
            )}
          </section>

          <section data-gsap="panel" className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
            <p className="mb-3 text-sm font-semibold text-white">2) OCR output preview</p>

            <div className="grid gap-2 sm:grid-cols-2">
              <FieldCard label="Invoice No" value={extracted.invoiceNo} />
              <FieldCard label="Purchase Date" value={extracted.purchaseDate} />
              <FieldCard label="Amount" value={extracted.amount ? `Rs ${extracted.amount}` : null} />
              <FieldCard label="Vendor" value={extracted.vendor} />
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/55 p-3">
              <p className="mb-2 text-xs uppercase tracking-[0.12em] text-slate-400">Raw OCR Text</p>
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap text-xs text-slate-200">
                {ocrText || 'OCR results will appear here after running the demo.'}
              </pre>
            </div>

            <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-500/10 p-3 text-xs text-emerald-100">
              Demo page only previews OCR capabilities and does not save, assign, or modify any warranty records.
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function FieldCard({ label, value }: { label: string; value: string | null }) {
  return (
    <div data-gsap="list-item" className="rounded-xl border border-white/10 bg-slate-900/45 p-3">
      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-1 text-sm ${value ? 'text-slate-100' : 'italic text-slate-500'}`}>{value || 'Not detected'}</p>
    </div>
  )
}
