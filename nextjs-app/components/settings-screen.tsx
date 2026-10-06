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
    <div ref={rootRef} className="min-h-screen bg-base-200">
      {/* Navbar */}
      <div data-gsap="hero" className="navbar bg-base-100 border-b border-base-300 sticky top-0 z-50">
        <div className="navbar-start">
          <button onClick={() => router.back()} className="btn btn-ghost btn-circle">
            <ArrowLeft className="w-5 h-5" />
          </button>
        </div>
        <div className="navbar-center">
          <span className="font-bold text-lg">Settings</span>
        </div>
        <div className="navbar-end"></div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        {/* Theme */}
        <div data-gsap="card" className="card bg-base-100 border border-base-300 shadow-sm mb-4">
          <div className="card-body gap-3">
            <h2 className="card-title text-base gap-2">
              <Palette className="w-5 h-5 text-primary" />
              Appearance
            </h2>
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Theme</span>
              </label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
                className="select select-bordered w-full"
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div data-gsap="card" className="card bg-base-100 border border-base-300 shadow-sm mb-4">
          <div className="card-body gap-3">
            <h2 className="card-title text-base gap-2">
              <Bell className="w-5 h-5 text-primary" />
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
        <div data-gsap="card" className="card bg-base-100 border border-base-300 shadow-sm mb-4">
          <div className="card-body gap-3">
            <h2 className="card-title text-base gap-2">
              <Shield className="w-5 h-5 text-primary" />
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
              icon={<Wifi className="w-4 h-4 text-base-content/40" />}
            />
            <ToggleRow
              label="Graph augmentation"
              hint="Enable knowledge graph for better AI answers"
              checked={graphAugment}
              onChange={setGraphAugment}
              icon={<Network className="w-4 h-4 text-base-content/40" />}
            />
          </div>
        </div>

        {/* Data */}
        <div data-gsap="panel" className="card bg-base-100 border border-base-300 shadow-sm mb-4">
          <div className="card-body gap-1 p-0">
            <button data-gsap-hover="lift" className="btn btn-ghost justify-between font-medium text-sm h-14 rounded-none px-6">
              <span className="flex items-center gap-3">
                <Download className="w-4 h-4 text-primary" />
                Export all data
              </span>
              <ChevronRight className="w-4 h-4 text-base-content/40" />
            </button>
            <div className="divider my-0 px-6"></div>
            <button data-gsap-hover="lift" className="btn btn-ghost justify-between font-medium text-sm h-14 rounded-none px-6 text-error hover:bg-error/10">
              <span className="flex items-center gap-3">
                <Trash2 className="w-4 h-4" />
                Delete account
              </span>
              <ChevronRight className="w-4 h-4 text-base-content/40" />
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-base-content/40 mt-8">SafeBill v1.0.0</p>
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
            <span className="label-text font-medium">{label}</span>
            {hint && <p className="text-xs text-base-content/50 mt-0.5">{hint}</p>}
          </div>
        </div>
        <input
          type="checkbox"
          className="toggle toggle-primary"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
    </div>
  )
}
