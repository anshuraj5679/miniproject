'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  ScanLine,
  FileText,
  Settings,
  LogOut,
  Search,
  Bell,
  Menu,
  X,
  Filter,
  ArrowUpRight,
  MoreVertical,
  ShieldCheck,
  AlertCircle,
  Clock,
  Wallet
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { useAuthStore } from '@/lib/store/auth-store'
import { supabase } from '@/lib/supabase'
import { useGsapCountUp, useGsapReveal } from '@/lib/gsap-helpers'
import type { Document } from '@/lib/types'

// --- Utility Functions ---

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

function getStatusColor(daysLeft: number | null) {
  if (daysLeft === null) return 'badge-ghost'
  if (daysLeft < 0) return 'badge-error'
  if (daysLeft <= 30) return 'badge-warning'
  return 'badge-success'
}

function getStatusLabel(daysLeft: number | null) {
  if (daysLeft === null) return 'No Expiry'
  if (daysLeft < 0) return 'Expired'
  if (daysLeft <= 30) return 'Expiring Soon'
  return 'Active'
}

type AssetFilter = 'all' | 'active' | 'expiring' | 'expired' | 'no_expiry'

const FILTER_ORDER: AssetFilter[] = ['all', 'active', 'expiring', 'expired', 'no_expiry']
const FILTER_LABELS: Record<AssetFilter, string> = {
  all: 'All',
  active: 'Active',
  expiring: 'Expiring Soon',
  expired: 'Expired',
  no_expiry: 'No Expiry',
}

// --- Components ---

function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
  isCollapsed
}: {
  icon: any,
  label: string,
  active?: boolean,
  onClick: () => void,
  isCollapsed?: boolean
}) {
  return (
    <button
      onClick={onClick}
      data-gsap="list-item"
      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group w-full ${active
        ? 'bg-primary/15 text-primary font-medium'
        : 'text-base-content/60 hover:bg-base-200 hover:text-base-content'
        }`}
    >
      <Icon className={`w-5 h-5 ${active ? 'stroke-[2.5px]' : 'stroke-2'}`} />
      {!isCollapsed && <span className="whitespace-nowrap">{label}</span>}
      {active && !isCollapsed && (
        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--p),0.8)]"></div>
      )}
    </button>
  )
}

function StatCard({
  label,
  value,
  subtext,
  icon: Icon,
  trend,
  colorClass = 'text-primary',
  countTo,
  countPrefix,
  countSuffix
}: {
  label: string,
  value: string | number,
  subtext?: string,
  icon: any,
  trend?: string,
  colorClass?: string,
  countTo?: number,
  countPrefix?: string,
  countSuffix?: string
}) {
  return (
    <div data-gsap="card" data-gsap-hover="lift" className="card bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="card-body p-6">
        <div className="flex items-start justify-between">
          <div className={`p-3 rounded-2xl bg-base-200/50 ${colorClass}`}>
            <Icon className="w-6 h-6" />
          </div>
          {trend && (
            <div className="flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-2 py-1 rounded-full">
              <ArrowUpRight className="w-3 h-3" />
              {trend}
            </div>
          )}
        </div>
        <div className="mt-4">
          <p className="text-sm font-medium text-base-content/60">{label}</p>
          <h3 className="text-2xl font-bold mt-1 text-base-content tracking-tight">
            {typeof countTo === 'number' ? (
              <span
                data-count-to={countTo}
                data-count-prefix={countPrefix || ''}
                data-count-suffix={countSuffix || ''}
                data-count-decimals="0"
              >
                {value}
              </span>
            ) : (
              value
            )}
          </h3>
          {subtext && <p className="text-xs text-base-content/40 mt-1">{subtext}</p>}
        </div>
      </div>
    </div>
  )
}

// --- Main Screen ---

export function LockerScreen() {
  const router = useRouter()
  const { user, clearAuth } = useAuthStore()
  const rootRef = useRef<HTMLDivElement>(null)

  const [documents, setDocuments] = useState<Document[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all')

  const loadDocuments = useCallback(async () => {
    try {
      setIsLoading(true)
      const response = await apiClient.get<{ documents: Document[] }>('/documents', {
        params: { userId: user?.userId || 'anonymous', limit: 100 },
      })
      setDocuments(response.documents || [])
    } catch (error) {
      console.error('Failed to load documents:', error)
    } finally {
      setIsLoading(false)
    }
  }, [user?.userId])

  useEffect(() => { loadDocuments() }, [loadDocuments])
  useGsapReveal(rootRef, [isLoading, documents.length, searchQuery])

  const stats = useMemo(() => {
    const total = documents.length
    const totalValue = documents.reduce((acc, doc) => acc + (doc.items?.[0]?.purchasePrice || 0), 0)

    // Mock expiry check
    const now = Date.now()
    const expiring = documents.filter(d => {
      const end = d.items?.[0]?.warrantyEnd
      if (!end) return false
      const days = Math.ceil((new Date(end).getTime() - now) / (1000 * 60 * 60 * 24))
      return days > 0 && days <= 30
    }).length

    const expired = documents.filter(d => {
      const end = d.items?.[0]?.warrantyEnd
      if (!end) return false
      return new Date(end).getTime() < now
    }).length

    return { total, totalValue, expiring, expired }
  }, [documents])

  const filteredDocs = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()

    return documents.filter((doc) => {
      const matchesSearch =
        !query ||
        doc.title.toLowerCase().includes(query) ||
        doc.sellerName?.toLowerCase().includes(query)

      if (!matchesSearch) return false

      if (assetFilter === 'all') return true

      const end = doc.items?.[0]?.warrantyEnd
      const daysLeft = end
        ? Math.ceil((new Date(end).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null

      if (assetFilter === 'no_expiry') return daysLeft === null
      if (assetFilter === 'expired') return daysLeft !== null && daysLeft < 0
      if (assetFilter === 'expiring') return daysLeft !== null && daysLeft >= 0 && daysLeft <= 30
      if (assetFilter === 'active') return daysLeft !== null && daysLeft > 30
      return true
    })
  }, [documents, searchQuery, assetFilter])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    clearAuth()
    router.push('/landing')
  }

  const cycleFilter = () => {
    setAssetFilter((current) => {
      const currentIndex = FILTER_ORDER.indexOf(current)
      const nextIndex = (currentIndex + 1) % FILTER_ORDER.length
      return FILTER_ORDER[nextIndex]
    })
  }

  useGsapCountUp(rootRef, [stats.total, stats.expiring, stats.expired])

  return (
    <div ref={rootRef} className="flex h-screen bg-base-200/50 font-sans text-base-content overflow-hidden">
      {/* Sidebar - Desktop */}
      <aside data-gsap="panel" className="hidden lg:flex flex-col w-72 bg-base-100 border-r border-base-200 h-full">
        <div data-gsap="hero" className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-content font-bold shadow-lg shadow-primary/20">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">SafeBill</h1>
            <p className="text-xs text-base-content/50 font-medium">Locker & Warranty</p>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4">
          <div className="px-4 mb-2 text-xs font-semibold text-base-content/40 uppercase tracking-wider">Menu</div>
          <SidebarItem icon={LayoutDashboard} label="Dashboard" active onClick={() => router.push('/locker')} />
          <SidebarItem icon={FileText} label="All Assets" onClick={() => router.push('/locker')} />
          <SidebarItem icon={Clock} label="Expiring Soon" onClick={() => router.push('/reminders')} />
          <SidebarItem icon={ScanLine} label="Scan Invoice" onClick={() => router.push('/scan')} />
        </nav>

        <div data-gsap="panel" className="p-4 border-t border-base-200">
          <SidebarItem icon={Settings} label="Settings" onClick={() => router.push('/settings')} />
          <SidebarItem icon={LogOut} label="Logout" onClick={handleLogout} />

          <div className="mt-4 p-4 rounded-xl bg-base-200/50 border border-base-200 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-neutral text-neutral-content flex items-center justify-center font-bold text-sm">
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{user?.name || 'User'}</p>
              <p className="text-xs text-base-content/50 truncate">{user?.customId || user?.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Mobile Header */}
        <div data-gsap="hero" className="lg:hidden flex items-center justify-between p-4 bg-base-100 border-b border-base-200">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="btn btn-square btn-ghost">
              <Menu className="w-6 h-6" />
            </button>
            <span className="font-bold text-lg">SafeBill</span>
          </div>
          <button onClick={() => router.push('/reminders')} className="btn btn-circle btn-ghost">
            <Bell className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-24">
          <div className="max-w-7xl mx-auto space-y-6">

            {/* Dashboard Title + Actions Row */}
            <div data-gsap="hero" className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div data-gsap="hero">
                <p className="text-sm font-medium text-primary mb-1">Welcome back, {user?.name?.split(' ')[0] || 'User'}</p>
                <h2 className="text-3xl font-extrabold tracking-tight">Dashboard</h2>
              </div>
              <div data-gsap="card" className="flex items-center gap-3">
                <div className="relative hidden md:block">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
                  <input
                    type="text"
                    placeholder="Search assets..."
                    className="input input-sm input-bordered pl-9 w-56 bg-base-200/40 focus:bg-base-100 focus:w-72 transition-all duration-300"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <button onClick={() => router.push('/reminders')} data-gsap-hover="lift" className="btn btn-sm btn-ghost btn-square relative">
                  <Bell className="w-4 h-4" />
                  {stats.expiring > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-error"></span>}
                </button>
                <button onClick={() => router.push('/scan')} data-gsap-hover="lift" className="btn btn-sm btn-primary gap-2 shadow-md shadow-primary/25 hover:shadow-lg hover:shadow-primary/30 transition-all">
                  <ScanLine className="w-4 h-4" />
                  Scan Now
                </button>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
              <StatCard
                label="Total Assets"
                value={stats.total}
                countTo={stats.total}
                icon={ShieldCheck}
                subtext="Active in locker"
              />
              <StatCard
                label="Protected Value"
                value={formatCurrency(stats.totalValue)}
                icon={Wallet}
                colorClass="text-secondary"
              />
              <StatCard
                label="Expiring Soon"
                value={stats.expiring}
                countTo={stats.expiring}
                icon={Clock}
                colorClass="text-warning"
                subtext="Next 30 days"
              />
              <StatCard
                label="Expired"
                value={stats.expired}
                countTo={stats.expired}
                icon={AlertCircle}
                colorClass="text-error"
              />
            </div>

            {/* Mobile Search */}
            <div className="md:hidden relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
              <input
                type="text"
                placeholder="Search assets..."
                className="input input-sm input-bordered pl-9 w-full bg-base-200/40"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Data Table / List */}
            <div data-gsap="card" className="card bg-base-100 border border-base-200 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-base-200 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base">Your Assets</h3>
                  <p className="text-xs text-base-content/40 mt-0.5">{filteredDocs.length} items</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={cycleFilter}
                    data-gsap-hover="lift"
                    className="btn btn-xs btn-ghost gap-1.5 border border-base-200"
                    title="Cycle asset status filter"
                  >
                    <Filter className="w-3.5 h-3.5" /> {FILTER_LABELS[assetFilter]}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="table table-lg w-full">
                  <thead className="bg-base-200/50 text-base-content/60">
                    <tr>
                      <th>Asset Name</th>
                      <th>Value</th>
                      <th>Warranty Expiry</th>
                      <th>Status</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          <td colSpan={5} className="h-16">
                            <div className="h-4 bg-base-200 rounded w-full"></div>
                          </td>
                        </tr>
                      ))
                    ) : filteredDocs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-base-content/50">
                          No assets found. Upload your first invoice to get started.
                        </td>
                      </tr>
                    ) : (
                      filteredDocs.map((doc) => {
                        const item = doc.items?.[0]
                        const end = item?.warrantyEnd
                        const daysLeft = end ? Math.ceil((new Date(end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null

                        return (
                          <tr
                            key={doc.docId}
                            data-gsap="list-item"
                            className="hover:bg-base-200/30 transition-colors cursor-pointer group"
                            onClick={() => router.push(`/document/${doc.docId}`)}
                          >
                            <td>
                              <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-base-200 flex items-center justify-center shrink-0">
                                  <FileText className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                  <div className="font-bold">{item?.productName || doc.title}</div>
                                  <div className="text-sm opacity-50">{doc.category || 'Other'} • {doc.sellerName || 'Unknown Seller'}</div>
                                </div>
                              </div>
                            </td>
                            <td className="font-mono font-medium">
                              {item?.purchasePrice ? formatCurrency(item.purchasePrice) : '-'}
                            </td>
                            <td className="text-sm">
                              {end ? (
                                <div>
                                  <div className="font-medium">{end}</div>
                                  <div className="text-xs opacity-50">{daysLeft !== null && daysLeft > 0 ? `${daysLeft} days left` : ''}</div>
                                </div>
                              ) : <span className="text-xs opacity-40">Not available</span>}
                            </td>
                            <td>
                              <span className={`badge border-0 font-medium ${getStatusColor(daysLeft)} bg-opacity-20 text-opacity-100 px-3 py-3`}>
                                {getStatusLabel(daysLeft)}
                              </span>
                            </td>
                            <td className="text-right">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation()
                                  router.push(`/document/${doc.docId}`)
                                }}
                                className="btn btn-ghost btn-sm btn-square opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label="Open asset details"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)}></div>
          <aside data-gsap="panel" className="absolute top-0 bottom-0 left-0 w-80 bg-base-100 shadow-2xl p-6 flex flex-col h-full animate-in slide-in-from-left duration-300">
            <div className="flex items-center justify-between mb-8">
              <h2 className="font-bold text-xl">Locker Menu</h2>
              <button onClick={() => setSidebarOpen(false)} className="btn btn-circle btn-sm btn-ghost">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-6 p-4 rounded-xl bg-base-200/50 border border-base-200 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-neutral text-neutral-content flex items-center justify-center font-bold text-sm">
                {user?.name?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{user?.name || 'User'}</p>
                <p className="text-xs text-base-content/50 truncate">{user?.customId || user?.email}</p>
              </div>
            </div>
            <nav className="flex-1 space-y-2">
              <SidebarItem icon={LayoutDashboard} label="Dashboard" active onClick={() => router.push('/locker')} />
              <SidebarItem icon={FileText} label="All Assets" onClick={() => router.push('/locker')} />
              <SidebarItem icon={ScanLine} label="Scan Invoice" onClick={() => router.push('/scan')} />
            </nav>
            <div className="pt-6 border-t border-base-200">
              <button className="btn btn-outline w-full gap-2" onClick={handleLogout}>
                <LogOut className="w-4 h-4" /> Logout
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
