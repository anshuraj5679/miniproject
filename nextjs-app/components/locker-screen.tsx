'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  AlertCircle,
  BarChart3,
  Bell,
  Building2,
  ChevronRight,
  Clock3,
  FileText,
  Headphones,
  Laptop,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Printer,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCircle2,
  Wallet,
  X,
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { useAuthStore } from '@/lib/store/auth-store'
import { useGsapCountUp, useGsapReveal } from '@/lib/gsap-helpers'
import type { Document, InAppNotification } from '@/lib/types'
import { ProductVisual } from '@/components/product-visual'

const DAY_MS = 24 * 60 * 60 * 1000

type AssetFilter = 'all' | 'active' | 'expiring' | 'expired' | 'no_expiry'
type AssetListLimit = 4 | 6 | 8 | 12

type NavItem = {
  label: string
  icon: any
  onClick: () => void
  active?: boolean
  disabled?: boolean
}

type TimelinePoint = {
  label: string
  value: number
  totalValue: number
  rangeLabel: string
  assets: string[]
  x: number
  y: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatCompactDate(value?: string) {
  if (!value) return 'No date'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}

function getDaysLeft(value?: string) {
  if (!value) return null
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return Math.ceil((parsed - Date.now()) / DAY_MS)
}

function getStatusMeta(daysLeft: number | null) {
  if (daysLeft === null) {
    return {
      label: 'No expiry',
      tone: 'bg-slate-100 text-slate-500 border border-slate-200',
      summary: 'No warranty deadline available',
      action: 'View',
    }
  }
  if (daysLeft < 0) {
    return {
      label: 'Expired',
      tone: 'bg-rose-100 text-rose-700 border border-rose-200',
      summary: `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`,
      action: 'Review',
    }
  }
  if (daysLeft <= 30) {
    return {
      label: 'Expiring Soon',
      tone: 'bg-amber-100 text-amber-700 border border-amber-200',
      summary: `In ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      action: 'Claim Warranty',
    }
  }
  return {
    label: 'Protected',
    tone: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    summary: `Covered for ${daysLeft} more day${daysLeft === 1 ? '' : 's'}`,
    action: 'View',
  }
}

function pickAssetIcon(productName?: string, category?: string) {
  const haystack = `${productName || ''} ${category || ''}`.toLowerCase()
  if (/(laptop|macbook|ipad|tablet|phone|mobile)/.test(haystack)) return Laptop
  if (/(speaker|headphone|earbud|audio|jabra|sony)/.test(haystack)) return Headphones
  if (/(printer|scanner)/.test(haystack)) return Printer
  return Package
}

function buildTimelineSeries(documents: Document[]) {
  const start = new Date()
  start.setDate(1)

  const points = Array.from({ length: 6 }).map((_, index) => {
    const monthStart = new Date(start.getFullYear(), start.getMonth() + index, 1)
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + index + 1, 0, 23, 59, 59, 999)
    const matchingDocs = documents.filter((doc) => {
      const warrantyEnd = doc.items?.[0]?.warrantyEnd
      if (!warrantyEnd) return false
      const parsed = Date.parse(warrantyEnd)
      if (!Number.isFinite(parsed)) return false
      return parsed >= monthStart.getTime() && parsed <= monthEnd.getTime()
    })
    return {
      label: monthStart.toLocaleString('en-IN', { month: 'short' }),
      value: matchingDocs.length,
      totalValue: matchingDocs.reduce((sum, doc) => sum + (doc.items?.[0]?.purchasePrice || 0), 0),
      rangeLabel: `${monthStart.toLocaleString('en-IN', { month: 'short' })} ${monthStart.getFullYear()}`,
      assets: matchingDocs
        .map((doc) => doc.items?.[0]?.productName || doc.title)
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, 3),
    }
  })

  const width = 560
  const height = 248
  const left = 42
  const right = width - 28
  const top = 42
  const bottom = height - 42
  const peakValue = Math.max(...points.map((point) => point.value), 1)
  const midValue = Math.max(Math.round(peakValue / 2), 1)
  const usableWidth = right - left
  const usableHeight = bottom - top

  const coordinates: TimelinePoint[] = points.map((point, index) => {
    const x = left + (usableWidth * index) / Math.max(points.length - 1, 1)
    const y = bottom - (point.value / peakValue) * usableHeight
    return { ...point, x, y }
  })

  const linePath = coordinates
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ')
  const areaPath = `${linePath} L ${coordinates[coordinates.length - 1]?.x.toFixed(1) || right} ${bottom} L ${coordinates[0]?.x.toFixed(1) || left} ${bottom} Z`
  const highlight = coordinates.reduce((best, point) => {
    if (!best) return point
    return point.value >= best.value ? point : best
  }, coordinates[0])

  const bubbleWidth = 128
  const bubbleHeight = 44
  const highlightBubble = highlight
    ? {
      x: clamp(highlight.x - bubbleWidth / 2, left + 4, right - bubbleWidth - 4),
      y: Math.max(8, highlight.y - 58),
      width: bubbleWidth,
      height: bubbleHeight,
    }
    : null

  return {
    points: coordinates,
    linePath,
    areaPath,
    width,
    height,
    left,
    right,
    top,
    bottom,
    peakValue,
    midValue,
    highlight,
    highlightBubble,
    datedAssetCount: coordinates.reduce((sum, point) => sum + point.value, 0),
  }
}

function SidebarNavItem({ item }: { item: NavItem }) {
  return (
    <button
      type="button"
      onClick={item.disabled ? undefined : item.onClick}
      disabled={item.disabled}
      data-gsap="list-item"
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition-all ${item.active
        ? 'bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
        : item.disabled
          ? 'cursor-not-allowed text-slate-500'
          : 'text-slate-300 hover:bg-white/5 hover:text-white'
        }`}
    >
      <item.icon className={`h-4.5 w-4.5 ${item.active ? 'text-blue-300' : ''}`} />
      <span className="flex-1 whitespace-nowrap">{item.label}</span>
      {item.active ? <span className="h-2 w-2 rounded-full bg-blue-400" /> : null}
    </button>
  )
}

function StatPanel({
  icon: Icon,
  label,
  value,
  subtext,
  accent,
  countTo,
  countPrefix,
}: {
  icon: any
  label: string
  value: string | number
  subtext: string
  accent: string
  countTo?: number
  countPrefix?: string
}) {
  return (
    <div data-gsap="card" className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.28)]">
      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-500">{label}</p>
      <div className="mt-1 text-[2rem] font-bold leading-none tracking-tight text-slate-950">
        {typeof countTo === 'number' ? (
          <span data-count-to={countTo} data-count-prefix={countPrefix || ''} data-count-suffix="" data-count-decimals="0">
            {value}
          </span>
        ) : (
          value
        )}
      </div>
      <p className="mt-3 text-xs font-medium text-slate-400">{subtext}</p>
    </div>
  )
}

function InsightListCard({ title, badge, items }: { title: string; badge?: string; items: string[] }) {
  return (
    <div data-gsap="card" className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.28)]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-bold tracking-tight text-slate-900">{title}</h3>
        {badge ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">{badge}</span> : null}
      </div>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={item} className="flex items-start gap-3 text-sm text-slate-600">
            <span className="mt-1 h-2.5 w-2.5 rounded-full bg-blue-500" />
            <span className="leading-6">{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function LockerScreen() {
  const router = useRouter()
  const pathname = usePathname()
  const { user, clearAuth } = useAuthStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const lastLoadedUserIdRef = useRef<string | null>(null)

  const [documents, setDocuments] = useState<Document[]>([])
  const [notifications, setNotifications] = useState<InAppNotification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all')
  const [assetListLimit, setAssetListLimit] = useState<AssetListLimit>(6)
  const [activeTimelinePointIndex, setActiveTimelinePointIndex] = useState<number | null>(null)

  const loadDocuments = useCallback(async () => {
    if (!user?.userId) {
      setDocuments([])
      setNotifications([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const [documentResponse, notificationResponse] = await Promise.all([
        apiClient.get<{ documents: Document[] }>('/documents', {
          params: { userId: user.userId, limit: 100 },
        }),
        apiClient.get<{ notifications: InAppNotification[] }>('/notifications', {
          params: { userId: user.userId, includeRead: false, limit: 20 },
        }),
      ])
      setDocuments(Array.isArray(documentResponse.documents) ? documentResponse.documents : [])
      setNotifications(Array.isArray(notificationResponse.notifications) ? notificationResponse.notifications : [])
    } catch (error) {
      console.error('Failed to load documents:', error)
      setNotifications([])
      lastLoadedUserIdRef.current = null
    } finally {
      setIsLoading(false)
    }
  }, [user?.userId])

  useEffect(() => {
    const currentUserId = user?.userId || ''
    if (lastLoadedUserIdRef.current === currentUserId) return
    lastLoadedUserIdRef.current = currentUserId
    void loadDocuments()
  }, [loadDocuments, user?.userId])

  useGsapReveal(rootRef, [documents.length, isLoading])

  const handleLogout = useCallback(async () => {
    await clearAuth()
    router.push('/landing')
  }, [clearAuth, router])

  const navigateIfNeeded = useCallback(
    (path: string) => {
      if (pathname === path) return
      router.push(path)
    },
    [pathname, router]
  )

  const resolveDocId = useCallback((doc: Document) => {
    const candidate =
      doc.docId ||
      (doc as unknown as { documentId?: string }).documentId ||
      (doc as unknown as { id?: string }).id
    return typeof candidate === 'string' && candidate.trim() ? candidate : null
  }, [])

  const openDocument = useCallback(
    (doc: Document) => {
      const resolvedId = resolveDocId(doc)
      if (!resolvedId) {
        alert('Unable to open this asset right now. Please refresh and try again.')
        return
      }
      router.push(`/document/${resolvedId}`)
    },
    [resolveDocId, router]
  )

  const stats = useMemo(() => {
    const total = documents.length
    const totalValue = documents.reduce((sum, doc) => sum + (doc.items?.[0]?.purchasePrice || 0), 0)
    const expiring = documents.filter((doc) => {
      const daysLeft = getDaysLeft(doc.items?.[0]?.warrantyEnd)
      return daysLeft !== null && daysLeft >= 0 && daysLeft <= 30
    }).length
    const expired = documents.filter((doc) => {
      const daysLeft = getDaysLeft(doc.items?.[0]?.warrantyEnd)
      return daysLeft !== null && daysLeft < 0
    }).length
    const soonest = documents
      .map((doc) => ({ doc, daysLeft: getDaysLeft(doc.items?.[0]?.warrantyEnd) }))
      .filter((entry): entry is { doc: Document; daysLeft: number } => entry.daysLeft !== null && entry.daysLeft >= 0)
      .sort((a, b) => a.daysLeft - b.daysLeft)[0]

    return {
      total,
      totalValue,
      expiring,
      expired,
      soonestDays: soonest?.daysLeft ?? null,
    }
  }, [documents])

  const filteredDocs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return documents
      .filter((doc) => {
        const item = doc.items?.[0]
        const haystack = [
          doc.title,
          doc.sellerName,
          doc.category,
          item?.productName,
          item?.model,
          item?.invoiceNo,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (query && !haystack.includes(query)) return false

        const daysLeft = getDaysLeft(item?.warrantyEnd)
        if (assetFilter === 'active') return daysLeft !== null && daysLeft > 30
        if (assetFilter === 'expiring') return daysLeft !== null && daysLeft >= 0 && daysLeft <= 30
        if (assetFilter === 'expired') return daysLeft !== null && daysLeft < 0
        if (assetFilter === 'no_expiry') return daysLeft === null
        return true
      })
      .sort((left, right) => {
        const leftDays = getDaysLeft(left.items?.[0]?.warrantyEnd)
        const rightDays = getDaysLeft(right.items?.[0]?.warrantyEnd)
        if (leftDays === null && rightDays === null) return 0
        if (leftDays === null) return 1
        if (rightDays === null) return -1
        return leftDays - rightDays
      })
  }, [assetFilter, documents, searchQuery])

  const actionItems = useMemo(() => filteredDocs.slice(0, 4), [filteredDocs])
  const visibleDocs = useMemo(() => filteredDocs.slice(0, assetListLimit), [assetListLimit, filteredDocs])
  const timeline = useMemo(() => buildTimelineSeries(documents), [documents])
  const displayName = user?.name?.split(' ')[0] || 'Dev'
  const unreadNotificationCount = useMemo(
    () => notifications.filter((item) => item.status === 'unread').length,
    [notifications]
  )
  const activeTimelinePoint = useMemo(() => {
    if (typeof activeTimelinePointIndex === 'number') {
      return timeline.points[activeTimelinePointIndex] || null
    }
    return timeline.highlight || timeline.points[0] || null
  }, [activeTimelinePointIndex, timeline.highlight, timeline.points])

  const expiringInsights = useMemo(() => {
    const items: string[] = []
    if (stats.expiring > 0) {
      items.push(`${stats.expiring} asset${stats.expiring === 1 ? '' : 's'} expire within 30 days`)
    } else {
      items.push('No assets expire within the next 30 days')
    }
    items.push(`${formatCurrency(stats.totalValue)} protected value currently in the locker`)
    if (stats.soonestDays !== null) {
      items.push(`Nearest warranty deadline is in ${stats.soonestDays} day${stats.soonestDays === 1 ? '' : 's'}`)
    }
    return items
  }, [stats.expiring, stats.soonestDays, stats.totalValue])

  const aiInsights = useMemo(() => {
    const reviewRequired = documents.filter((doc) => doc.reviewRequired).length
    const lowOcr = documents.filter((doc) => (doc.ocrConfidence || 0) > 0 && (doc.ocrConfidence || 0) < 0.8).length
    const notes: string[] = []
    if (reviewRequired > 0) {
      notes.push(`${reviewRequired} asset${reviewRequired === 1 ? '' : 's'} need extraction review before claim filing`)
    } else {
      notes.push('Mapped invoices look stable enough for claim preparation')
    }
    notes.push(`${formatCurrency(stats.totalValue)} claimable value remains protected`)
    notes.push(
      lowOcr > 0
        ? `Re-scan ${lowOcr} invoice${lowOcr === 1 ? '' : 's'} with weak OCR confidence`
        : 'Recommend scanning any missing invoices to keep the locker complete'
    )
    return notes
  }, [documents, stats.totalValue])

  const navPrimary = useMemo<NavItem[]>(
    () => [
      { label: 'Dashboard', icon: LayoutDashboard, active: true, onClick: () => navigateIfNeeded('/locker') },
      { label: 'All Assets', icon: FileText, onClick: () => navigateIfNeeded('/locker') },
      { label: 'Expiring Soon', icon: Clock3, onClick: () => router.push('/reminders') },
      { label: 'Scan Invoice', icon: ScanLine, onClick: () => router.push('/scan') },
      { label: 'Analytics', icon: BarChart3, onClick: () => undefined, disabled: true },
      { label: 'Claims', icon: ShieldCheck, onClick: () => router.push('/claims') },
      { label: 'Vendors', icon: Building2, onClick: () => undefined, disabled: true },
    ],
    [navigateIfNeeded, router]
  )

  const navSecondary = useMemo<NavItem[]>(
    () => [
      { label: 'Settings', icon: Settings, onClick: () => router.push('/settings') },
      { label: 'Logout', icon: LogOut, onClick: () => void handleLogout() },
    ],
    [handleLogout, router]
  )

  useGsapCountUp(rootRef, [stats.total, stats.totalValue, stats.expiring, stats.expired])

  return (
    <div
      ref={rootRef}
      className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.24),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.92),transparent_24%),linear-gradient(135deg,#0a1224_0%,#12213e_26%,#eef2ff_26%,#f8fafc_100%)] p-2.5 text-slate-900 lg:p-4"
    >
      <div className="mx-auto flex min-h-[calc(100vh-20px)] max-w-[1460px] gap-3.5 lg:gap-4">
        <aside className="hidden w-[244px] shrink-0 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,#0f1730_0%,#101b37_42%,#0b1227_100%)] p-4.5 text-white shadow-[0_28px_70px_-38px_rgba(0,0,0,0.75)] lg:flex lg:flex-col">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 shadow-[0_12px_24px_-12px_rgba(59,130,246,0.75)]">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[1.4rem] font-bold tracking-tight">SafeBill</p>
              <p className="text-xs text-slate-400">Warranty Locker</p>
            </div>
          </div>

          <nav className="mt-8 space-y-1">
            {navPrimary.map((item) => (
              <SidebarNavItem key={item.label} item={item} />
            ))}
          </nav>

          <div className="mt-auto space-y-1 border-t border-white/10 pt-5">
            {navSecondary.map((item) => (
              <SidebarNavItem key={item.label} item={item} />
            ))}
            <div className="mt-4 rounded-[22px] border border-white/10 bg-white/5 p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold text-white">
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{user?.name || 'User'}</p>
                  <p className="truncate text-xs text-slate-400">{user?.email || user?.customId || 'SafeBill user'}</p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 rounded-[30px] border border-white/60 bg-[rgba(255,255,255,0.92)] shadow-[0_36px_90px_-46px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-4 lg:hidden">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <p className="text-lg font-bold tracking-tight text-slate-900">SafeBill</p>
                <p className="text-xs text-slate-400">Warranty Locker</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push('/scan')}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-[0_16px_26px_-16px_rgba(37,99,235,0.9)]"
            >
              <ScanLine className="h-4 w-4" />
              Scan
            </button>
          </div>

          <div className="flex h-full min-h-[calc(100vh-32px)] flex-col overflow-hidden">
            <div className="border-b border-slate-200/80 px-5 py-4 lg:px-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="relative hidden min-w-0 flex-1 md:block">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search assets, vendors..."
                      className="h-12 w-full rounded-[18px] border border-slate-200 bg-slate-50/80 pl-11 pr-4 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 md:gap-3">
                  <button
                    type="button"
                    onClick={() => router.push('/reminders')}
                    className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-600"
                  >
                    <Bell className="h-4.5 w-4.5" />
                    {unreadNotificationCount > 0 ? (
                      <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white shadow-[0_10px_20px_-12px_rgba(244,63,94,0.95)]">
                        {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/scan')}
                    className="inline-flex h-11 items-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-[0_20px_34px_-20px_rgba(37,99,235,0.95)] transition hover:bg-blue-700"
                  >
                    <ScanLine className="h-4 w-4" />
                    Scan Invoice
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/settings')}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-600"
                    aria-label="Account"
                  >
                    <UserCircle2 className="h-6 w-6" />
                  </button>
                </div>
              </div>

              <div className="relative mt-4 md:hidden">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search assets, vendors..."
                  className="h-12 w-full rounded-[18px] border border-slate-200 bg-slate-50/80 pl-11 pr-4 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 lg:px-6 lg:py-6">
              <div className="space-y-5">
                <section data-gsap="hero" className="space-y-4.5">
                  <div>
                    <p className="text-lg font-medium text-slate-600">Welcome back, {displayName}</p>
                    <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950 md:text-[3.4rem] md:leading-[1.02]">
                      Warranty Command Center
                    </h1>
                    <p className="mt-2.5 max-w-2xl text-base text-slate-500">
                      Track your assets, prevent warranty loss, and claim faster.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2.5">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-[0_14px_32px_-26px_rgba(15,23,42,0.28)]">
                      <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 font-blue-600">Tracked</span>
                      <span className="mt-1 block text-base font-semibold text-slate-900">{stats.total} assets in locker</span>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-[0_14px_32px_-26px_rgba(15,23,42,0.28)]">
                      <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Protected Value</span>
                      <span className="mt-1 block text-base font-semibold text-slate-900">{formatCurrency(stats.totalValue)}</span>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-[0_14px_32px_-26px_rgba(15,23,42,0.28)]">
                      <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Next Deadline</span>
                      <span className="mt-1 block text-base font-semibold text-slate-900">
                        {stats.soonestDays !== null ? `${stats.soonestDays} days left` : 'No active deadline'}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                  <StatPanel
                    icon={ShieldCheck}
                    label="Total Assets"
                    value={stats.total}
                    countTo={stats.total}
                    subtext={`${stats.total} tracked in locker`}
                    accent="bg-blue-50 text-blue-600"
                  />
                  <StatPanel
                    icon={Wallet}
                    label="Protected Value"
                    value={formatCurrency(stats.totalValue)}
                    countTo={stats.totalValue}
                    countPrefix="Rs "
                    subtext={`${formatCurrency(stats.totalValue)} claimable`}
                    accent="bg-emerald-50 text-emerald-600"
                  />
                  <StatPanel
                    icon={Clock3}
                    label="Expiring Soon"
                    value={stats.expiring}
                    countTo={stats.expiring}
                    subtext={stats.expiring > 0 ? 'In next 30 days' : 'No near deadlines'}
                    accent="bg-amber-50 text-amber-600"
                  />
                  <StatPanel
                    icon={AlertCircle}
                    label="Expired"
                    value={stats.expired}
                    countTo={stats.expired}
                    subtext={stats.expired > 0 ? 'Needs claim review' : 'No expired coverage'}
                    accent="bg-rose-50 text-rose-600"
                  />
                </section>

                <section className="grid gap-3.5 xl:grid-cols-[minmax(0,1.62fr)_300px]">
                  <div data-gsap="card" className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.28)]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-bold tracking-tight text-slate-950">Warranty Expiration Timeline</h2>
                        <p className="mt-1 text-sm text-slate-500">Expiring assets over time</p>
                      </div>
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500">
                        <BarChart3 className="h-4.5 w-4.5" />
                      </div>
                    </div>

                    <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_100%)] p-4">
                      <div className="mb-4 flex flex-col gap-2 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
                        <p>Monthly expiry buckets from actual warranty end dates.</p>
                        <p className="font-medium text-slate-600">{timeline.datedAssetCount} dated assets tracked</p>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px] xl:items-start">
                        <svg
                          viewBox={`0 0 ${timeline.width} ${timeline.height}`}
                          className="h-[250px] w-full rounded-[20px] bg-white"
                          onMouseLeave={() => setActiveTimelinePointIndex(null)}
                        >
                          {[0, 1, 2].map((step) => {
                            const y = timeline.top + ((timeline.bottom - timeline.top) / 2) * step
                            return (
                              <line
                                key={step}
                                x1={timeline.left}
                                y1={y}
                                x2={timeline.right}
                                y2={y}
                                stroke="#e2e8f0"
                                strokeDasharray="4 6"
                              />
                            )
                          })}
                          {[timeline.peakValue, timeline.midValue, 0].map((value, index) => {
                            const y = timeline.top + ((timeline.bottom - timeline.top) / 2) * index
                            return (
                              <text key={`y-${value}-${index}`} x={10} y={y + 4} fontSize="12" fontWeight="600" fill="#94a3b8">
                                {value}
                              </text>
                            )
                          })}
                          {timeline.points.map((point) => (
                            <line
                              key={`v-${point.label}`}
                              x1={point.x}
                              y1={timeline.top}
                              x2={point.x}
                              y2={timeline.bottom}
                              stroke="#f1f5f9"
                            />
                          ))}
                          {activeTimelinePoint ? (
                            <line
                              x1={activeTimelinePoint.x}
                              y1={timeline.top}
                              x2={activeTimelinePoint.x}
                              y2={timeline.bottom}
                              stroke="#93c5fd"
                              strokeWidth="2"
                              strokeDasharray="6 6"
                            />
                          ) : null}
                          <path d={timeline.areaPath} fill="url(#lockerAreaFill)" />
                          <path d={timeline.linePath} fill="none" stroke="#2478ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                          {timeline.points.map((point, index) => {
                            const isActive = activeTimelinePoint?.label === point.label && activeTimelinePoint?.rangeLabel === point.rangeLabel
                            return (
                              <g
                                key={point.label}
                                role="button"
                                tabIndex={0}
                                onMouseEnter={() => setActiveTimelinePointIndex(index)}
                                onFocus={() => setActiveTimelinePointIndex(index)}
                                onBlur={() => setActiveTimelinePointIndex(null)}
                              >
                                {isActive ? <circle cx={point.x} cy={point.y} r="10" fill="#dbeafe" opacity="0.9" /> : null}
                                <circle cx={point.x} cy={point.y} r="5.5" fill="#ffffff" stroke="#2478ff" strokeWidth="3.5" />
                                <text x={point.x} y={timeline.bottom + 20} textAnchor="middle" fontSize="12" fill="#94a3b8">
                                  {point.label}
                                </text>
                              </g>
                            )
                          })}
                          <defs>
                            <linearGradient id="lockerAreaFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#2478ff" stopOpacity="0.22" />
                              <stop offset="100%" stopColor="#2478ff" stopOpacity="0.03" />
                            </linearGradient>
                          </defs>
                        </svg>
                        <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.42)]">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Selected Bucket</p>
                          <div className="mt-3 flex items-start justify-between gap-3">
                            <div>
                              <h3 className="text-xl font-bold tracking-tight text-slate-950">{activeTimelinePoint?.rangeLabel || 'No data'}</h3>
                              <p className="mt-1 text-sm text-slate-500">
                                {activeTimelinePoint?.value
                                  ? `${activeTimelinePoint.value} asset${activeTimelinePoint.value === 1 ? '' : 's'} expire in this month`
                                  : 'No mapped expiries in this month'}
                              </p>
                            </div>
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${activeTimelinePoint?.value
                                ? 'border border-blue-200 bg-blue-50 text-blue-700'
                                : 'border border-slate-200 bg-slate-100 text-slate-500'
                                }`}
                            >
                              {activeTimelinePoint?.value ? 'Active' : 'Empty'}
                            </span>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Assets</p>
                              <p className="mt-1 text-lg font-bold text-slate-950">{activeTimelinePoint?.value || 0}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Protected Value</p>
                              <p className="mt-1 text-lg font-bold text-slate-950">{formatCurrency(activeTimelinePoint?.totalValue || 0)}</p>
                            </div>
                          </div>
                          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Top Assets</p>
                            <div className="mt-2 space-y-2">
                              {activeTimelinePoint?.assets.length ? (
                                activeTimelinePoint.assets.map((asset) => (
                                  <div key={asset} className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.55)]">
                                    {asset}
                                  </div>
                                ))
                              ) : (
                                <p className="text-sm text-slate-500">No assets mapped in this bucket yet.</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3.5">
                    <InsightListCard title="Expiring Soon" badge="Action" items={expiringInsights} />
                    <InsightListCard title="AI Warranty Insights" badge="Live" items={aiInsights} />
                  </div>
                </section>

                <section className="grid gap-3.5 xl:grid-cols-[minmax(0,1.55fr)_340px] xl:items-start">
                  <div data-gsap="card" className="rounded-[28px] border border-slate-200/80 bg-white shadow-[0_18px_50px_-32px_rgba(15,23,42,0.28)]">
                    <div className="flex flex-col gap-3.5 border-b border-slate-200/80 px-5 py-4.5 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h2 className="text-2xl font-bold tracking-tight text-slate-950">Expiring Soon</h2>
                        <p className="mt-1 text-sm text-slate-500">Browse your locker as asset cards instead of a long table.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <label className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          <span className="mr-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Filter</span>
                          <select
                            value={assetFilter}
                            onChange={(event) => setAssetFilter(event.target.value as AssetFilter)}
                            className="bg-transparent font-medium text-slate-700 outline-none"
                          >
                            <option value="all">All</option>
                            <option value="active">Active</option>
                            <option value="expiring">Expiring Soon</option>
                            <option value="expired">Expired</option>
                            <option value="no_expiry">No Expiry</option>
                          </select>
                        </label>
                        <label className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          <span className="mr-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Rows</span>
                          <select
                            value={assetListLimit}
                            onChange={(event) => setAssetListLimit(Number(event.target.value) as AssetListLimit)}
                            className="bg-transparent font-medium text-slate-700 outline-none"
                          >
                            <option value={4}>4</option>
                            <option value={6}>6</option>
                            <option value={8}>8</option>
                            <option value={12}>12</option>
                          </select>
                        </label>
                      </div>
                    </div>

                    <div className="border-b border-slate-100 px-5 py-3 text-sm text-slate-500">
                      Showing <span className="font-semibold text-slate-800">{Math.min(visibleDocs.length, filteredDocs.length)}</span> of{' '}
                      <span className="font-semibold text-slate-800">{filteredDocs.length}</span> assets
                    </div>

                    <div className="max-h-[720px] overflow-y-auto p-5">
                      {isLoading ? (
                        <div className="grid gap-4 md:grid-cols-2">
                          {Array.from({ length: 4 }).map((_, index) => (
                            <div key={index} className="animate-pulse rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                  <div className="h-12 w-12 rounded-2xl bg-slate-100" />
                                  <div className="space-y-2">
                                    <div className="h-4 w-40 rounded bg-slate-100" />
                                    <div className="h-3 w-28 rounded bg-slate-100" />
                                  </div>
                                </div>
                                <div className="h-7 w-20 rounded-full bg-slate-100" />
                              </div>
                              <div className="mt-4 grid grid-cols-2 gap-3">
                                <div className="h-16 rounded-2xl bg-slate-100" />
                                <div className="h-16 rounded-2xl bg-slate-100" />
                              </div>
                              <div className="mt-4 h-12 rounded-2xl bg-slate-100" />
                            </div>
                          ))}
                        </div>
                      ) : filteredDocs.length === 0 ? (
                        <div className="px-5 py-12 text-center">
                          <p className="text-base font-semibold text-slate-700">No assets match this view.</p>
                          <p className="mt-2 text-sm text-slate-500">Add or scan invoices to populate your locker dashboard.</p>
                        </div>
                      ) : (
                        <div className="grid gap-4 md:grid-cols-2">
                          {visibleDocs.map((doc) => {
                            const item = doc.items?.[0]
                            const daysLeft = getDaysLeft(item?.warrantyEnd)
                            const status = getStatusMeta(daysLeft)
                            const Icon = pickAssetIcon(item?.productName || doc.title, doc.category)
                            const resolvedId = resolveDocId(doc) || `${doc.title}-${doc.createdAt}`

                            return (
                              <button
                                key={resolvedId}
                                type="button"
                                onClick={() => openDocument(doc)}
                                data-gsap="list-item"
                                className="group rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5 text-left shadow-[0_18px_36px_-30px_rgba(15,23,42,0.32)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_26px_52px_-34px_rgba(37,99,235,0.3)]"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex min-w-0 items-center gap-4">
                                    <ProductVisual
                                      docId={resolveDocId(doc)}
                                      alt={item?.productName || doc.title || 'Product image'}
                                      productImageAvailable={doc.productImageAvailable}
                                      productImageGeneratedAt={doc.productImageGeneratedAt}
                                      fallbackIcon={Icon}
                                      className="h-14 w-14 shrink-0 rounded-[20px] border border-slate-200 bg-white shadow-[0_18px_28px_-24px_rgba(15,23,42,0.35)]"
                                      imageClassName="h-full w-full object-cover"
                                    />
                                    <div className="min-w-0">
                                      <div className="line-clamp-2 text-lg font-semibold leading-6 text-slate-900">
                                        {item?.productName || doc.title || 'Untitled asset'}
                                      </div>
                                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                                        <span>{doc.sellerName || 'Unknown seller'}</span>
                                        <span className="hidden text-slate-300 md:inline">•</span>
                                        <span>{formatCompactDate(item?.purchaseDate)}</span>
                                      </div>
                                    </div>
                                  </div>
                                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${status.tone}`}>
                                    {status.label}
                                  </span>
                                </div>

                                <div className="mt-4 grid grid-cols-2 gap-3">
                                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Asset Value</p>
                                    <p className="mt-1 text-lg font-bold text-slate-950">
                                      {item?.purchasePrice ? formatCurrency(item.purchasePrice) : 'Not available'}
                                    </p>
                                  </div>
                                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Warranty Ends</p>
                                    <p className="mt-1 text-lg font-bold text-slate-950">{formatCompactDate(item?.warrantyEnd)}</p>
                                  </div>
                                </div>

                                <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Coverage Status</p>
                                  <p className="mt-1 text-sm font-medium text-slate-700">{status.summary}</p>
                                </div>

                                <div className="mt-4 flex items-center justify-between gap-3">
                                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                                    {doc.category || 'General category'}
                                  </span>
                                  <span className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_18px_28px_-18px_rgba(37,99,235,0.95)]">
                                    Open Asset
                                    <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                                  </span>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4.5 xl:sticky xl:top-6">
                    <div data-gsap="card" className="rounded-[28px] border border-slate-200/80 bg-white p-4.5 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.28)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-500">Action Queue</p>
                          <h3 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Next Moves</h3>
                        </div>
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                          {actionItems.length} items
                        </span>
                      </div>
                      <div className="mt-4 space-y-2.5">
                        {actionItems.length === 0 ? (
                          <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                            No urgent actions right now. Keep scanning invoices to expand your locker.
                          </p>
                        ) : (
                          actionItems.map((doc, index) => {
                            const item = doc.items?.[0]
                            const daysLeft = getDaysLeft(item?.warrantyEnd)
                            const status = getStatusMeta(daysLeft)
                            const Icon = pickAssetIcon(item?.productName || doc.title, doc.category)
                            return (
                              <button
                                key={`${doc.docId || doc.title}-${index}`}
                                type="button"
                                onClick={() => openDocument(doc)}
                                className="group w-full rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-4 py-3.5 text-left transition hover:border-blue-200 hover:bg-blue-50"
                              >
                                <div className="flex items-start gap-3">
                                  <ProductVisual
                                    docId={resolveDocId(doc)}
                                    alt={item?.productName || doc.title || 'Product image'}
                                    productImageAvailable={doc.productImageAvailable}
                                    productImageGeneratedAt={doc.productImageGeneratedAt}
                                    fallbackIcon={Icon}
                                    className="h-11 w-11 shrink-0 rounded-2xl border border-blue-100 bg-white"
                                    imageClassName="h-full w-full object-cover"
                                    fallbackClassName="bg-blue-50 text-blue-600"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="line-clamp-1 text-sm font-semibold text-slate-900">{item?.productName || doc.title}</p>
                                        <p className="mt-1 line-clamp-1 text-xs text-slate-500">{doc.sellerName || 'Unknown seller'}</p>
                                      </div>
                                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.tone}`}>
                                        {status.label}
                                      </span>
                                    </div>
                                    <div className="mt-3 flex items-center justify-between gap-3">
                                      <p className="text-xs font-medium text-blue-600">
                                        {daysLeft === null
                                          ? 'Warranty date missing'
                                          : daysLeft < 0
                                            ? `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`
                                            : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left to act`}
                                      </p>
                                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition group-hover:border-blue-200 group-hover:text-blue-600">
                                        <ChevronRight className="h-4 w-4" />
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </button>
                            )
                          })
                        )}
                      </div>
                    </div>

                    <div data-gsap="card" className="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,#f7fbff_0%,#eef5ff_100%)] p-5 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.28)]">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_16px_28px_-18px_rgba(37,99,235,0.9)]">
                          <Sparkles className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-500">Locker Intelligence</p>
                          <h3 className="text-2xl font-bold tracking-tight text-slate-950">Coverage signals</h3>
                        </div>
                      </div>
                      <div className="mt-4 space-y-3">
                        <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 shadow-[0_18px_34px_-30px_rgba(15,23,42,0.32)]">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                              <Clock3 className="h-4.5 w-4.5" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Expiry pressure</p>
                              <p className="mt-1 text-sm text-slate-600">
                                {stats.expiring > 0
                                  ? `${stats.expiring} asset${stats.expiring === 1 ? '' : 's'} need attention in the next 30 days.`
                                  : 'No immediate expiry pressure in the next 30 days.'}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 shadow-[0_18px_34px_-30px_rgba(15,23,42,0.32)]">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                              <Wallet className="h-4.5 w-4.5" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Protected value</p>
                              <p className="mt-1 text-sm text-slate-600">Locker currently protects {formatCurrency(stats.totalValue)} worth of purchases.</p>
                            </div>
                          </div>
                        </div>
                        <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 shadow-[0_18px_34px_-30px_rgba(15,23,42,0.32)]">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                              <Bell className="h-4.5 w-4.5" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Notification health</p>
                              <p className="mt-1 text-sm text-slate-600">
                                {unreadNotificationCount > 0
                                  ? `${unreadNotificationCount} unread notification${unreadNotificationCount === 1 ? '' : 's'} need attention.`
                                  : 'No pending notification alerts right now.'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </main>
      </div>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[290px] rounded-r-[28px] border-r border-white/10 bg-[linear-gradient(180deg,#0f1730_0%,#101b37_42%,#0b1227_100%)] p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-lg font-bold tracking-tight">SafeBill</p>
                  <p className="text-xs text-slate-400">Warranty Locker</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="mt-8 space-y-1">
              {navPrimary.map((item) => (
                <SidebarNavItem key={item.label} item={item} />
              ))}
            </nav>

            <div className="mt-auto space-y-1 border-t border-white/10 pt-5">
              {navSecondary.map((item) => (
                <SidebarNavItem key={item.label} item={item} />
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

