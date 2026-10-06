'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Bell,
  Download,
  Trash2,
  ChevronRight,
} from 'lucide-react'
import { useAuthStore } from '@/lib/store/auth-store'
import { useGsapReveal } from '@/lib/gsap-helpers'

export function SettingsScreen() {
  const router = useRouter()
  const { user } = useAuthStore()
  const rootRef = useRef<HTMLDivElement>(null)

  // Notification preferences
  const [inApp, setInApp] = useState(true)
  const [emailNotifs, setEmailNotifs] = useState(true)
  const [pushNotifs, setPushNotifs] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  useGsapReveal(rootRef, [inApp, emailNotifs, pushNotifs, exporting, exportError])

  const handleExportAllData = async () => {
    if (!user?.userId) {
      setExportError('Sign in to export your data.')
      return
    }
    setExporting(true)
    setExportError(null)
    try {
      const params = new URLSearchParams()
      if (user.userType === 'merchant') {
        params.set('merchantUserId', user.userId)
      } else {
        params.set('userId', user.userId)
      }
      params.set('limit', '500')

      const response = await fetch(`/api/documents?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const message = payload && typeof payload.error === 'string' ? payload.error : 'Export failed.'
        throw new Error(message)
      }
      const payload = await response.json()
      const exportPayload = {
        exportedAt: new Date().toISOString(),
        user: {
          userId: user.userId,
          userType: user.userType || 'consumer',
          email: user.email,
          name: user.name,
          customId: user.customId,
        },
        documents: Array.isArray(payload?.documents) ? payload.documents : payload,
      }
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `safebill-export-${user.userId}-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div ref={rootRef} className="dashboard-shell">
      {/* Navbar */}
      <div data-gsap="hero" className="dashboard-navbar flex items-center px-4 py-3">
        <div className="flex-none">
          <button onClick={() => router.back()} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-blue-50 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 text-center">
          <span className="font-bold text-lg text-slate-900">Settings</span>
        </div>
        <div className="flex-none w-10"></div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        {/* Notifications */}
        <div data-gsap="card" className="dashboard-card mb-4 p-5">
          <div className="gap-3">
            <h2 className="text-base font-bold gap-2 text-slate-900 flex items-center">
              <div className="p-1.5 rounded-lg bg-blue-50 border border-blue-100"><Bell className="w-5 h-5 text-blue-600" /></div>
              Notifications
            </h2>
            <ToggleRow label="In-app notifications" checked={inApp} onChange={setInApp} />
            <ToggleRow label="Email notifications" checked={emailNotifs} onChange={setEmailNotifs} />
            <ToggleRow label="Push notifications" checked={pushNotifs} onChange={setPushNotifs} />
          </div>
        </div>

        {/* Data */}
        <div data-gsap="panel" className="dashboard-card mb-4">
          <div className="gap-1 p-0">
            <button
              data-gsap-hover="lift"
              onClick={handleExportAllData}
              disabled={exporting}
              className="flex h-14 w-full items-center justify-between px-6 text-left text-sm font-medium text-slate-700 transition hover:bg-blue-50 rounded-t-2xl disabled:opacity-60"
            >
              <span className="flex items-center gap-3">
                <Download className="w-4 h-4 text-blue-600" />
                {exporting ? 'Exporting...' : 'Export all data'}
              </span>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </button>
            {exportError ? (
              <div className="px-6 pb-3 text-xs text-rose-600">{exportError}</div>
            ) : null}
            <div className="my-0 border-t border-slate-100 px-6"></div>
            <button data-gsap-hover="lift" className="flex h-14 w-full items-center justify-between px-6 text-left text-sm font-medium text-red-600 transition hover:bg-red-50 rounded-b-2xl">
              <span className="flex items-center gap-3">
                <Trash2 className="w-4 h-4" />
                Delete account
              </span>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-8">SafeBill v1.0.0</p>
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  icon,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (val: boolean) => void
  icon?: React.ReactNode
}) {
  return (
    <div className="form-control">
      <label className="label cursor-pointer gap-4">
        <div className="flex items-center gap-2 flex-1">
          {icon}
          <div>
            <span className="label-text font-medium text-slate-800">{label}</span>
            {hint && <p className="text-xs text-slate-600 mt-0.5">{hint}</p>}
          </div>
        </div>
        <input
          type="checkbox"
          className="h-5 w-9 cursor-pointer rounded-full accent-blue-600"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
    </div>
  )
}
