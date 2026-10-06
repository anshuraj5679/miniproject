'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Palette,
  Bell,
  Shield,
  Wifi,
  Network,
  Download,
  Trash2,
  ChevronRight,
} from 'lucide-react'
import { useThemeStore } from '@/lib/store/theme-store'
import { useGsapReveal } from '@/lib/gsap-helpers'

export function SettingsScreen() {
  const router = useRouter()
  const { theme, setTheme } = useThemeStore()
  const rootRef = useRef<HTMLDivElement>(null)

  // Notification preferences
  const [inApp, setInApp] = useState(true)
  const [emailNotifs, setEmailNotifs] = useState(true)
  const [smsNotifs, setSmsNotifs] = useState(false)
  const [pushNotifs, setPushNotifs] = useState(true)
  const [whatsapp, setWhatsapp] = useState(false)

  // Feature toggles
  const [localVault, setLocalVault] = useState(false)
  const [offlineOcr, setOfflineOcr] = useState(false)
  const [graphAugment, setGraphAugment] = useState(true)

  useGsapReveal(rootRef, [theme, inApp, emailNotifs, smsNotifs, pushNotifs, whatsapp, localVault, offlineOcr, graphAugment])

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
        {/* Theme */}
        <div data-gsap="card" className="dashboard-card mb-4 p-5">
          <div className="gap-3">
            <h2 className="text-base font-bold gap-2 text-slate-900 flex items-center">
              <div className="p-1.5 rounded-lg bg-blue-50 border border-blue-100"><Palette className="w-5 h-5 text-blue-600" /></div>
              Appearance
            </h2>
            <div className="form-control mt-3">
              <label className="label">
                <span className="label-text font-medium text-slate-700">Theme</span>
              </label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
                className="dashboard-input"
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div data-gsap="card" className="dashboard-card mb-4 p-5">
          <div className="gap-3">
            <h2 className="text-base font-bold gap-2 text-slate-900 flex items-center">
              <div className="p-1.5 rounded-lg bg-blue-50 border border-blue-100"><Bell className="w-5 h-5 text-blue-600" /></div>
              Notifications
            </h2>
            <ToggleRow label="In-app notifications" checked={inApp} onChange={setInApp} />
            <ToggleRow label="Email notifications" checked={emailNotifs} onChange={setEmailNotifs} />
            <ToggleRow label="SMS notifications" checked={smsNotifs} onChange={setSmsNotifs} />
            <ToggleRow label="Push notifications" checked={pushNotifs} onChange={setPushNotifs} />
            <ToggleRow label="WhatsApp notifications" checked={whatsapp} onChange={setWhatsapp} />
          </div>
        </div>

        {/* Features */}
        <div data-gsap="card" className="dashboard-card mb-4 p-5">
          <div className="gap-3">
            <h2 className="text-base font-bold gap-2 text-slate-900 flex items-center">
              <div className="p-1.5 rounded-lg bg-blue-50 border border-blue-100"><Shield className="w-5 h-5 text-blue-600" /></div>
              Privacy & Features
            </h2>
            <ToggleRow
              label="Local-only vault"
              hint="Keep documents only on this device"
              checked={localVault}
              onChange={setLocalVault}
            />
            <ToggleRow
              label="Offline OCR"
              hint="Process bills without internet"
              checked={offlineOcr}
              onChange={setOfflineOcr}
              icon={<Wifi className="w-4 h-4 text-slate-500" />}
            />
            <ToggleRow
              label="Graph augmentation"
              hint="Enable knowledge graph for better AI answers"
              checked={graphAugment}
              onChange={setGraphAugment}
              icon={<Network className="w-4 h-4 text-slate-500" />}
            />
          </div>
        </div>

        {/* Data */}
        <div data-gsap="panel" className="dashboard-card mb-4">
          <div className="gap-1 p-0">
            <button data-gsap-hover="lift" className="flex h-14 w-full items-center justify-between px-6 text-left text-sm font-medium text-slate-700 transition hover:bg-blue-50 rounded-t-2xl">
              <span className="flex items-center gap-3">
                <Download className="w-4 h-4 text-blue-600" />
                Export all data
              </span>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </button>
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
