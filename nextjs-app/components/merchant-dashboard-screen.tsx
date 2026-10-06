'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  Upload,
  FileText,
  Users,
  Package,
  Send,
  Check,
  X,
  Plus,
  Clock,
  LayoutDashboard,
  Settings,
  LogOut,
  Menu,
  Bell,
  Store,
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { useAuthStore } from '@/lib/store/auth-store'
import { useGsapCountUp, useGsapReveal } from '@/lib/gsap-helpers'
import type { MerchantActivity } from '@/lib/types'

type ActiveTab = 'lookup' | 'upload' | 'manual'

interface ConsumerLookup {
  userId: string
  customId: string
  fullName: string
  email: string
}

// --- Sidebar Item ---
function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: any
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      data-gsap="list-item"
      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 w-full ${active
        ? 'bg-blue-100 text-blue-700 font-medium'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
    >
      <Icon className={`w-5 h-5 ${active ? 'stroke-[2.5px]' : 'stroke-2'}`} />
      <span className="whitespace-nowrap">{label}</span>
      {active && (
        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600"></div>
      )}
    </button>
  )
}

// --- Tab Button ---
function TabButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: any
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      data-gsap-hover="lift"
      className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${active
        ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  )
}

// --- Main Screen ---
export function MerchantDashboardScreen() {
  const router = useRouter()
  const { user, clearAuth } = useAuthStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const activityPanelRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('lookup')
  const [activeNav, setActiveNav] = useState<'dashboard' | 'activity'>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Lookup state
  const [consumerId, setConsumerId] = useState('')
  const [resolvedConsumer, setResolvedConsumer] = useState<ConsumerLookup | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [assignConsumerId, setAssignConsumerId] = useState('')
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadResult, setUploadResult] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Manual state
  const [manualData, setManualData] = useState({
    consumerId: '',
    productName: '',
    invoiceNo: '',
    purchaseDate: '',
    warrantyMonths: '',
    purchasePrice: '',
    sellerName: user?.name || '',
  })
  const [manualLoading, setManualLoading] = useState(false)
  const [manualResult, setManualResult] = useState<string | null>(null)
  const [manualError, setManualError] = useState<string | null>(null)

  // Activity
  const [recentActivity, setRecentActivity] = useState<MerchantActivity[]>([])
  const [statsData, setStatsData] = useState({ totalBills: 0, consumers: 0 })

  const loadActivity = useCallback(async () => {
    try {
      if (!user?.userId) {
        setRecentActivity([])
        setStatsData({ totalBills: 0, consumers: 0 })
        return
      }
      const response = await apiClient.get<{ activities: MerchantActivity[] }>('/merchant/activity', {
        params: { merchantUserId: user.userId, limit: 100 },
      })
      const activities = response.activities || []
      setRecentActivity(activities)
      const uniqueConsumers = new Set(
        activities.map((item) => item.consumerUserId || '').filter(Boolean)
      )
      setStatsData({ totalBills: activities.length, consumers: uniqueConsumers.size })
    } catch (error) {
      console.error('Failed to load activity:', error)
    }
  }, [user?.userId])

  useEffect(() => { loadActivity() }, [loadActivity])
  useEffect(() => {
    if (!user) return
    if (user.userType !== 'merchant') {
      router.replace('/locker')
    }
  }, [router, user])
  useGsapReveal(rootRef, [activeTab, recentActivity.length, lookupLoading, uploadLoading, manualLoading])
  useGsapCountUp(rootRef, [statsData.totalBills, statsData.consumers])

  const resolveConsumerByCustomId = async (customId: string): Promise<ConsumerLookup> => {
    const response = await fetch('/api/auth/lookup-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customId: customId.trim(), userType: 'consumer' }),
    })
    const data = (await response.json().catch(() => null)) as
      | { userId?: string; customId?: string; fullName?: string; email?: string; error?: string }
      | null
    if (!response.ok) {
      throw new Error(data?.error || 'Consumer not found.')
    }
    if (!data?.userId || !data?.customId) {
      throw new Error('Consumer profile is missing required identity fields.')
    }
    return {
      userId: data.userId,
      customId: data.customId,
      fullName: data.fullName || 'Consumer',
      email: data.email || '',
    }
  }

  const handleLookup = async () => {
    if (!consumerId.trim()) return
    setLookupLoading(true)
    setLookupError(null)
    setResolvedConsumer(null)
    try {
      const consumer = await resolveConsumerByCustomId(consumerId.trim())
      setResolvedConsumer(consumer)
    } catch (err: unknown) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed.')
    } finally {
      setLookupLoading(false)
    }
  }

  const handleUpload = async () => {
    if (!uploadFile || !assignConsumerId.trim() || !user?.userId) return
    setUploadLoading(true)
    setUploadError(null)
    setUploadResult(null)
    try {
      const consumer = await resolveConsumerByCustomId(assignConsumerId.trim())
      const formData = new FormData()
      formData.append('file', uploadFile)
      formData.append('merchantUserId', user.userId)
      if (user.name) formData.append('merchantName', user.name)
      if (user.customId) formData.append('merchantCustomId', user.customId)
      formData.append('consumerUserId', consumer.userId)
      formData.append('consumerCustomId', consumer.customId)
      if (consumer.fullName) formData.append('consumerName', consumer.fullName)
      if (consumer.email) formData.append('consumerEmail', consumer.email)
      formData.append('ocrMode', 'vision_only')

      const response = await fetch('/api/merchant/upload', { method: 'POST', body: formData })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Upload failed.')
      setUploadResult(`Bill scanned and assigned to ${consumer.fullName}.`)
      setUploadFile(null)
      setAssignConsumerId('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      loadActivity()
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploadLoading(false)
    }
  }

  const handleManualCreate = async () => {
    if (!manualData.consumerId.trim() || !manualData.productName.trim() || !user?.userId) return
    setManualLoading(true)
    setManualError(null)
    setManualResult(null)
    try {
      const consumer = await resolveConsumerByCustomId(manualData.consumerId.trim())
      await apiClient.post('/merchant/manual-bill', {
        merchantUserId: user.userId,
        merchantName: user.name || 'Merchant',
        merchantCustomId: user.customId,
        consumerUserId: consumer.userId,
        consumerCustomId: consumer.customId,
        consumerName: consumer.fullName,
        consumerEmail: consumer.email || undefined,
        productName: manualData.productName,
        billId: manualData.invoiceNo || undefined,
        vendor: manualData.sellerName || undefined,
        purchaseDate: manualData.purchaseDate || undefined,
        totalAmount: manualData.purchasePrice ? parseFloat(manualData.purchasePrice) : undefined,
        warrantyMonths: manualData.warrantyMonths ? parseInt(manualData.warrantyMonths, 10) : undefined,
        category: 'Others',
      })
      setManualResult('Bill created and assigned successfully.')
      setManualData({
        consumerId: '',
        productName: '',
        invoiceNo: '',
        purchaseDate: '',
        warrantyMonths: '',
        purchasePrice: '',
        sellerName: user?.name || '',
      })
      loadActivity()
    } catch (err: unknown) {
      setManualError(err instanceof Error ? err.message : 'Failed to create bill.')
    } finally {
      setManualLoading(false)
    }
  }

  const handleLogout = async () => {
    await clearAuth()
    router.push('/landing')
  }

  const handleDashboardNav = () => {
    setActiveNav('dashboard')
    setActiveTab('lookup')
    setSidebarOpen(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleActivityNav = () => {
    setActiveNav('activity')
    setSidebarOpen(false)
    activityPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div ref={rootRef} className="dashboard-shell flex h-screen font-sans text-slate-900 overflow-hidden">
      {/* ─── Desktop Sidebar ─── */}
      <aside data-gsap="panel" className="hidden lg:flex flex-col w-72 dashboard-sidebar h-full">
        <div data-gsap="hero" className="p-6 flex items-center gap-3 dashboard-sidebar-header">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center text-white font-bold shadow-lg shadow-blue-200/60">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-slate-900">SafeBill</h1>
            <p className="text-xs text-slate-400 font-medium">Merchant Portal</p>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4">
          <div className="px-4 mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Menu</div>
          <SidebarItem icon={LayoutDashboard} label="Dashboard" active={activeNav === 'dashboard'} onClick={handleDashboardNav} />
          <SidebarItem icon={Clock} label="Activity" active={activeNav === 'activity'} onClick={handleActivityNav} />
        </nav>

        <div data-gsap="panel" className="p-4 border-t border-slate-100">
          <SidebarItem icon={Settings} label="Settings" onClick={() => router.push('/settings')} />
          <SidebarItem icon={LogOut} label="Logout" onClick={handleLogout} />

          <div className="mt-4 p-4 rounded-xl bg-gradient-to-br from-slate-50 to-blue-50/40 border border-slate-200/80 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 text-white flex items-center justify-center font-bold text-sm shadow-md shadow-blue-200/50">
              {user?.name?.[0]?.toUpperCase() || 'M'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate text-slate-900">{user?.name || 'Merchant'}</p>
              <p className="text-xs text-slate-400 truncate">{user?.customId || user?.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Mobile Header */}
        <div data-gsap="hero" className="lg:hidden flex items-center justify-between p-4 dashboard-navbar">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-xl hover:bg-blue-50 transition-colors">
              <Menu className="w-6 h-6 text-slate-700" />
            </button>
            <span className="font-bold text-lg text-slate-900">Merchant</span>
          </div>
          <button onClick={handleActivityNav} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-blue-50 transition-colors" aria-label="Open activity">
            <Bell className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 lg:p-8 pb-24">
          <div className="max-w-5xl mx-auto space-y-6">

            {/* Title Row */}
            <div data-gsap="hero" className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div data-gsap="hero">
                <p className="text-sm font-medium text-blue-600 mb-1">Welcome back, {user?.name?.split(' ')[0] || 'Merchant'}</p>
                <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">Merchant Dashboard</h2>
              </div>
              <button
                onClick={() => {
                  setActiveNav('dashboard')
                  setActiveTab('upload')
                }}
                data-gsap-hover="lift"
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-3 text-sm font-medium text-white shadow-lg shadow-blue-200/60 hover:from-blue-700 hover:to-blue-800 transition-all"
              >
                <Upload className="w-4 h-4" />
                Upload Bill
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 lg:gap-4">
              <div data-gsap="card" data-gsap-hover="lift" className="dashboard-stat-card">
                <div className="p-5 flex items-center gap-4 relative">
                  <div className="p-3 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">Bills Created</p>
                    <h3 className="text-2xl font-bold tracking-tight text-slate-900">
                      <span data-count-to={statsData.totalBills} data-count-decimals="0">{statsData.totalBills}</span>
                    </h3>
                  </div>
                </div>
              </div>
              <div data-gsap="card" data-gsap-hover="lift" className="dashboard-stat-card">
                <div className="p-5 flex items-center gap-4 relative">
                  <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                    <Users className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">Consumers</p>
                    <h3 className="text-2xl font-bold tracking-tight text-slate-900">
                      <span data-count-to={statsData.consumers} data-count-decimals="0">{statsData.consumers}</span>
                    </h3>
                  </div>
                </div>
              </div>
            </div>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Left: Actions Panel */}
              <div className="lg:col-span-3 space-y-5">
                {/* Tab Switcher */}
                <div className="flex items-center gap-2 p-1.5 bg-white border border-slate-200 rounded-2xl">
                  <TabButton icon={Search} label="Lookup" active={activeTab === 'lookup'} onClick={() => { setActiveNav('dashboard'); setActiveTab('lookup') }} />
                  <TabButton icon={Upload} label="Upload" active={activeTab === 'upload'} onClick={() => { setActiveNav('dashboard'); setActiveTab('upload') }} />
                  <TabButton icon={Plus} label="Manual" active={activeTab === 'manual'} onClick={() => { setActiveNav('dashboard'); setActiveTab('manual') }} />
                </div>

                {/* Tab Content Card */}
                <div data-gsap="card" className="dashboard-card">
                  <div className="p-5 space-y-5">
                    {/* ── Lookup Tab ── */}
                    {activeTab === 'lookup' && (
                      <>
                        <div>
                          <h3 className="font-bold text-base">Consumer Lookup</h3>
                          <p className="text-xs text-slate-500 mt-0.5">Find a consumer by their SafeBill ID.</p>
                        </div>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                              type="text"
                              placeholder="CON-XXXXXX"
                              value={consumerId}
                              onChange={(e) => setConsumerId(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                              className="h-10 w-full rounded-xl border border-slate-300 pl-10 pr-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                          </div>
                          <button onClick={handleLookup} disabled={lookupLoading} data-gsap-hover="lift" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
                            {lookupLoading ? <span className="loading loading-spinner loading-sm"></span> : <Search className="w-4 h-4" />}
                            Search
                          </button>
                        </div>
                        {lookupError && (
                          <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm flex items-center gap-2 text-red-700">
                            <X className="w-4 h-4" />
                            <span>{lookupError}</span>
                          </div>
                        )}
                        {resolvedConsumer && (
                          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-sm border border-emerald-200">
                                {resolvedConsumer.fullName[0]?.toUpperCase() || 'C'}
                              </div>
                              <div>
                                <p className="font-bold text-sm text-slate-900">{resolvedConsumer.fullName}</p>
                                <p className="text-xs text-slate-500">{resolvedConsumer.customId} • {resolvedConsumer.email || 'No email'}</p>
                              </div>
                              <Check className="w-5 h-5 text-emerald-600 ml-auto" />
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* ── Upload Tab ── */}
                    {activeTab === 'upload' && (
                      <>
                        <div>
                          <h3 className="font-bold text-base">Upload & Assign Bill</h3>
                          <p className="text-xs text-slate-500 mt-0.5">Upload an invoice and assign it to a consumer.</p>
                        </div>
                        <div className="form-control">
                          <label className="label pb-1"><span className="label-text text-xs font-semibold uppercase tracking-wider text-slate-500">Consumer ID</span></label>
                          <input
                            type="text"
                            placeholder="CON-XXXXXX"
                            value={assignConsumerId}
                            onChange={(e) => setAssignConsumerId(e.target.value)}
                            className="h-10 w-full rounded-xl border border-slate-300 px-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          />
                        </div>
                        <div className="form-control">
                          <label className="label pb-1"><span className="label-text text-xs font-semibold uppercase tracking-wider text-slate-500">Invoice File</span></label>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*,.pdf"
                            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                            className="file-input file-input-bordered w-full border-slate-300"
                          />
                        </div>
                        <button
                          onClick={handleUpload}
                          disabled={uploadLoading || !uploadFile || !assignConsumerId.trim()}
                          data-gsap-hover="lift"
                          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {uploadLoading ? <span className="loading loading-spinner loading-sm"></span> : <Send className="w-4 h-4" />}
                          Upload & Assign
                        </button>
                        {uploadError && (
                          <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm flex items-center gap-2 text-red-700"><X className="w-4 h-4" /><span>{uploadError}</span></div>
                        )}
                        {uploadResult && (
                          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm flex items-center gap-2 text-emerald-700"><Check className="w-4 h-4" /><span>{uploadResult}</span></div>
                        )}
                      </>
                    )}

                    {/* ── Manual Tab ── */}
                    {activeTab === 'manual' && (
                      <>
                        <div>
                          <h3 className="font-bold text-base">Manual Bill Entry</h3>
                          <p className="text-xs text-slate-500 mt-0.5">Create a warranty record manually.</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="form-control">
                            <label className="label pb-1"><span className="label-text text-xs font-semibold uppercase tracking-wider text-slate-500">Consumer ID *</span></label>
                            <input type="text" placeholder="CON-XXXXXX" value={manualData.consumerId} onChange={(e) => setManualData({ ...manualData, consumerId: e.target.value })} className="h-10 w-full rounded-xl border border-slate-300 px-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                          </div>
                          <div className="form-control">
                            <label className="label pb-1"><span className="label-text text-xs font-semibold uppercase tracking-wider text-slate-500">Product Name *</span></label>
                            <input type="text" placeholder="e.g. Samsung TV" value={manualData.productName} onChange={(e) => setManualData({ ...manualData, productName: e.target.value })} className="h-10 w-full rounded-xl border border-slate-300 px-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                          </div>
                          <div className="form-control">
                            <label className="label pb-1"><span className="label-text text-xs font-semibold uppercase tracking-wider text-slate-500">Invoice No.</span></label>
                            <input type="text" placeholder="INV-12345" value={manualData.invoiceNo} onChange={(e) => setManualData({ ...manualData, invoiceNo: e.target.value })} className="h-10 w-full rounded-xl border border-slate-300 px-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                          </div>
                          <div className="form-control">
                            <label className="label pb-1"><span className="label-text text-xs font-semibold uppercase tracking-wider text-slate-500">Purchase Date</span></label>
                            <input type="date" value={manualData.purchaseDate} onChange={(e) => setManualData({ ...manualData, purchaseDate: e.target.value })} className="h-10 w-full rounded-xl border border-slate-300 px-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                          </div>
                          <div className="form-control">
                            <label className="label pb-1"><span className="label-text text-xs font-semibold uppercase tracking-wider text-slate-500">Warranty (months)</span></label>
                            <input type="number" placeholder="12" value={manualData.warrantyMonths} onChange={(e) => setManualData({ ...manualData, warrantyMonths: e.target.value })} className="h-10 w-full rounded-xl border border-slate-300 px-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                          </div>
                          <div className="form-control">
                            <label className="label pb-1"><span className="label-text text-xs font-semibold uppercase tracking-wider text-slate-500">Amount (₹)</span></label>
                            <input type="number" placeholder="29999" value={manualData.purchasePrice} onChange={(e) => setManualData({ ...manualData, purchasePrice: e.target.value })} className="h-10 w-full rounded-xl border border-slate-300 px-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                          </div>
                        </div>
                        <button
                          onClick={handleManualCreate}
                          disabled={manualLoading || !manualData.consumerId.trim() || !manualData.productName.trim()}
                          data-gsap-hover="lift"
                          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {manualLoading ? <span className="loading loading-spinner loading-sm"></span> : <Plus className="w-4 h-4" />}
                          Create Bill
                        </button>
                        {manualError && (
                          <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm flex items-center gap-2 text-red-700"><X className="w-4 h-4" /><span>{manualError}</span></div>
                        )}
                        {manualResult && (
                          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm flex items-center gap-2 text-emerald-700"><Check className="w-4 h-4" /><span>{manualResult}</span></div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Activity Panel */}
              <div ref={activityPanelRef} className="lg:col-span-2">
                <div data-gsap="panel" className="dashboard-card">
                  <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-base text-slate-900">Recent Activity</h3>
                      <p className="text-xs text-slate-400 mt-0.5">{recentActivity.length} records</p>
                    </div>
                    <Clock className="w-4 h-4 text-slate-300" />
                  </div>

                  <div className="max-h-[480px] overflow-y-auto">
                    {recentActivity.length === 0 ? (
                      <div className="text-center py-12 px-6">
                        <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                        <p className="text-sm text-slate-400">No activity yet</p>
                        <p className="text-xs text-slate-300 mt-1">Upload your first bill to get started.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-200">
                        {recentActivity.slice(0, 10).map((activity) => (
                          <div
                            key={activity.activityId}
                            data-gsap="list-item"
                            className="p-4 hover:bg-slate-50 transition-colors cursor-pointer"
                            onClick={() => {
                              if (activity.documentId) router.push(`/document/${activity.documentId}`)
                            }}
                          >
                            <div className="flex items-start gap-3">
                              <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                                <Package className="w-4 h-4 text-blue-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm truncate">{activity.title || 'Untitled'}</p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                  {activity.vendor || 'Unknown'}
                                  {activity.consumerName ? ` • ${activity.consumerName}` : ''}
                                </p>
                              </div>
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600 font-medium shrink-0">
                                {activity.action || 'updated'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* ─── Mobile Sidebar Overlay ─── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)}></div>
          <aside data-gsap="panel" className="absolute top-0 bottom-0 left-0 w-80 bg-white shadow-2xl p-6 flex flex-col h-full">
            <div className="flex items-center justify-between mb-8">
              <h2 className="font-bold text-xl text-slate-900">Merchant Menu</h2>
              <button onClick={() => setSidebarOpen(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-blue-50 transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <nav className="flex-1 space-y-2">
              <SidebarItem icon={LayoutDashboard} label="Dashboard" active={activeNav === 'dashboard'} onClick={handleDashboardNav} />
              <SidebarItem icon={Clock} label="Activity" active={activeNav === 'activity'} onClick={handleActivityNav} />
              <SidebarItem icon={Settings} label="Settings" onClick={() => { setSidebarOpen(false); router.push('/settings') }} />
            </nav>
            <div className="pt-6 border-t border-slate-100">
              <button className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors" onClick={handleLogout}>
                <LogOut className="w-4 h-4" /> Logout
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}


