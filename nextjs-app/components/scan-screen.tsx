'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  DollarSign,
  FileText,
  Hash,
  Package,
  ScanLine,
  ShieldCheck,
  Store,
  Upload,
  Zap,
} from 'lucide-react'
import { useAuthStore } from '@/lib/store/auth-store'
import { useGsapReveal } from '@/lib/gsap-helpers'

interface ScanResult {
  docId: string
  title: string
  sellerName: string
  category: string
  items: Array<{
    productName: string
    model: string
    serialNumber: string
    invoiceNo: string
    purchaseDate: string
    purchasePrice: number | null
    warrantyMonths: number | null
    warrantyStart: string
    warrantyEnd: string
  }>
}

interface ScanApiResponse {
  document?: {
    docId: string
    title: string
    details?: {
      productName?: string
      brand?: string
      category?: string
      amount?: string
      purchaseDate?: string
      warrantyPeriod?: string
      warrantyStart?: string
      warrantyEnd?: string
      serialNumber?: string
      invoiceNumber?: string
      store?: string
    }
  }
  error?: string
}

export function ScanScreen() {
  const router = useRouter()
  const { user } = useAuthStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  useGsapReveal(rootRef, [Boolean(file), Boolean(scanResult), isScanning, error])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    if (!selected) return
    setFile(selected)
    setScanResult(null)
    setError(null)

    if (selected.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (e) => setPreview(e.target?.result as string)
      reader.readAsDataURL(selected)
    } else {
      setPreview(null)
    }
  }

  const handleScan = async () => {
    if (!file) return
    setIsScanning(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('userId', user?.userId || 'anonymous')
      if (user?.email) formData.append('consumerEmail', user.email)

      const response = await fetch('/api/scan', {
        method: 'POST',
        body: formData,
      })
      const data = (await response.json().catch(() => null)) as ScanApiResponse | null

      if (!response.ok) {
        throw new Error(data?.error || 'Scan failed. Please try again.')
      }
      const scanned = data?.document
      if (!scanned?.docId) {
        throw new Error('Scan response is missing document payload.')
      }

      const details = scanned.details || {}
      const parsedAmount = details.amount ? Number.parseFloat(details.amount) : null
      const parsedWarrantyMonths = details.warrantyPeriod
        ? Number.parseInt(String(details.warrantyPeriod).split(' ', 1)[0], 10) || null
        : null

      setScanResult({
        docId: scanned.docId,
        title: scanned.title,
        sellerName: details.store || '',
        category: details.category || 'Others',
        items: [
          {
            productName: details.productName || scanned.title || '',
            model: details.brand || '',
            serialNumber: details.serialNumber || '',
            invoiceNo: details.invoiceNumber || '',
            purchaseDate: details.purchaseDate || '',
            purchasePrice:
              parsedAmount !== null && Number.isFinite(parsedAmount) ? parsedAmount : null,
            warrantyMonths: parsedWarrantyMonths,
            warrantyStart: details.warrantyStart || '',
            warrantyEnd: details.warrantyEnd || '',
          },
        ],
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Scan failed.')
    } finally {
      setIsScanning(false)
    }
  }

  const resetScan = () => {
    setFile(null)
    setPreview(null)
    setScanResult(null)
    setError(null)
    if (uploadInputRef.current) uploadInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }

  const openDocument = () => {
    if (!scanResult?.docId) return
    router.push(`/document/${scanResult.docId}`)
  }

  const item = scanResult?.items?.[0]

  return (
    <div ref={rootRef} className="relative min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(79,70,229,0.32),rgba(15,23,42,0.9)_45%,rgba(2,6,23,1)_100%)]" />
        <div className="noise-overlay absolute inset-0 opacity-50" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-4 pb-10 pt-6 md:px-6">
        <header data-gsap="hero" className="mb-6 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl md:p-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/locker')}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-all hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-white md:text-2xl">Scan Invoice</h1>
              <p className="text-xs text-slate-400 md:text-sm">AI extraction for warranty details</p>
            </div>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-2">
          <section data-gsap="card" className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
            {!file ? (
              <div className="py-10 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5">
                  <ScanLine className="h-8 w-8 text-indigo-200" />
                </div>
                <h2 className="text-lg font-semibold text-white">Upload an Invoice</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
                  Upload PDF/image or use camera to extract invoice and warranty details.
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={() => uploadInputRef.current?.click()}
                    data-gsap-hover="lift"
                    className="glow-button inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-semibold text-white"
                  >
                    <Upload className="h-4 w-4" />
                    Upload File
                  </button>
                  <button
                    onClick={() => cameraInputRef.current?.click()}
                    data-gsap-hover="lift"
                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/12"
                  >
                    <Camera className="h-4 w-4" />
                    Camera
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{file.name}</p>
                    <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={resetScan}
                    className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
                  >
                    Clear
                  </button>
                </div>

                {preview && (
                  <div className="relative mb-4 h-[360px] overflow-hidden rounded-xl border border-white/10 bg-slate-900/45">
                    <Image src={preview} alt="Invoice preview" fill unoptimized className="object-contain" />
                  </div>
                )}

                {!scanResult && (
                  <button
                    onClick={handleScan}
                    disabled={isScanning}
                    data-gsap-hover="lift"
                    className="glow-button inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-70"
                  >
                    {isScanning ? (
                      <>
                        <span className="loading loading-spinner loading-sm"></span>
                        Extracting...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4" />
                        Start Extraction
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />
            {error && (
              <div className="mt-4 rounded-xl border border-red-300/25 bg-red-500/10 p-3 text-sm text-red-100">
                <div className="inline-flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  {error}
                </div>
              </div>
            )}
          </section>

          <section data-gsap="panel" className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
            {scanResult ? (
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-100">
                  <Check className="h-4 w-4" />
                  Extraction Complete
                </div>

                <div className="space-y-2">
                  <ResultField icon={Package} label="Product" value={item?.productName} />
                  <ResultField icon={Store} label="Seller" value={scanResult.sellerName} />
                  <ResultField icon={Hash} label="Invoice No" value={item?.invoiceNo} />
                  <ResultField icon={DollarSign} label="Amount" value={item?.purchasePrice ? `Rs ${item.purchasePrice}` : null} />
                  <ResultField
                    icon={ShieldCheck}
                    label="Warranty"
                    value={item?.warrantyMonths ? `${item.warrantyMonths} months` : null}
                  />
                  <ResultField icon={FileText} label="Category" value={scanResult.category} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={openDocument}
                    data-gsap-hover="lift"
                    className="glow-button inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-semibold text-white"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    View in Locker
                  </button>
                  <button
                    onClick={resetScan}
                    data-gsap-hover="lift"
                    className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/12"
                  >
                    Scan Another
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-slate-900/30 text-center">
                <ScanLine className="mb-3 h-9 w-9 text-slate-400" />
                <p className="text-sm font-semibold text-slate-100">Awaiting extraction</p>
                <p className="mt-1 max-w-[240px] text-xs text-slate-400">
                  Uploaded invoice details will appear here once extraction completes.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function ResultField({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value?: string | number | null
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="rounded-lg border border-white/10 bg-white/8 p-2">
        <Icon className="h-4 w-4 text-indigo-200" />
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <p className={`mt-0.5 text-sm ${value ? 'text-slate-100' : 'italic text-slate-500'}`}>
          {value || 'Not detected'}
        </p>
      </div>
    </div>
  )
}
