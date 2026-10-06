'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Eye,
  FileText,
  IndianRupee,
  LayoutDashboard,
  Link2,
  Loader2,
  LogOut,
  Menu,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Store,
  Upload,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { useAuthStore } from '@/lib/store/auth-store'
import type { Document, ExtractionReview, InAppNotification, MerchantActivity, MerchantAssignmentAudit } from '@/lib/types'

type WorkspaceTab = 'upload' | 'manual' | 'reassign'
type NavigationMode = 'workspace' | 'activity'
type WorkspacePanel = 'inventory' | 'review'
type NoticeTone = 'success' | 'error'

interface ConsumerLookup {
  userId: string
  customId: string
  fullName: string
  email: string
}

interface UploadFormState {
  consumerId: string
  billId: string
  vendor: string
  purchaseDate: string
  totalAmount: string
}

interface ManualFormState {
  consumerId: string
  productName: string
  invoiceNo: string
  purchaseDate: string
  warrantyMonths: string
  purchasePrice: string
  sellerName: string
  serialNumber: string
  notes: string
}

interface ActionNotice {
  tone: NoticeTone
  message: string
  documentId?: string
}

interface MerchantUploadResponse {
  document?: Document
}

interface MerchantManualResponse {
  document?: Document
}

interface ReviewDraft {
  bill_id: string
  vendor: string
  date: string
  total_amount: string
  product_name: string
  serial_number: string
  notes: string
}

function normalizeConsumerId(value: string): string {
  return value.trim().toUpperCase()
}

function formatCurrency(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Amount unavailable'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value?: string | null): string {
  if (!value) return 'Not captured'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}

function formatRelativeTime(value?: string | null): string {
  if (!value) return 'Date unavailable'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable'
  const diffMs = parsed.getTime() - Date.now()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (Math.abs(diffDays) < 1) return 'today'
  if (diffDays > 0) return `in ${diffDays} day${diffDays === 1 ? '' : 's'}`
  const pastDays = Math.abs(diffDays)
  return `${pastDays} day${pastDays === 1 ? '' : 's'} ago`
}

function getPrimaryItem(document: Document) {
  return document.items[0]
}

function getDocumentAmount(document: Document): number | null {
  const primaryItem = getPrimaryItem(document)
  return document.totalAmount ?? primaryItem?.purchasePrice ?? null
}

function getDocumentInvoice(document: Document): string {
  return getPrimaryItem(document)?.invoiceNo || 'Invoice not captured'
}

function getDocumentWarrantyEnd(document: Document): string | undefined {
  return getPrimaryItem(document)?.warrantyEnd
}

function getStatusTone(document: Document): 'emerald' | 'amber' | 'slate' {
  if (document.reviewRequired || (document.lowConfidenceFields || []).length > 0) return 'amber'
  if (document.isVerified) return 'emerald'
  return 'slate'
}

function getStatusLabel(document: Document): string {
  if (document.reviewRequired || (document.lowConfidenceFields || []).length > 0) return 'Needs review'
  if (document.isVerified) return 'Assigned'
  return 'Pending verification'
}

function statusChipClass(tone: 'emerald' | 'amber' | 'slate'): string {
  if (tone === 'emerald') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-slate-200 bg-slate-100 text-slate-600'
}

function getAuditTone(status?: string | null): string {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'accepted') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (normalized === 'escalated') return 'border-red-200 bg-red-50 text-red-700'
  if (normalized === 'assigned') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-slate-200 bg-slate-100 text-slate-600'
}

function formatAuditStatus(status?: string | null): string {
  const normalized = String(status || '').trim().toLowerCase()
  if (!normalized) return 'unknown'
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function formatAssignmentSource(source?: string | null): string {
  const normalized = String(source || '').trim().replace(/[_-]+/g, ' ')
  if (!normalized) return 'manual action'
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function normalizeReviewDraft(review: ExtractionReview | null): ReviewDraft {
  const extracted = review?.extractedFields || {}
  const confirmed = review?.confirmedFields || {}
  const preferred = (key: string): unknown => confirmed[key] ?? extracted[key]
  return {
    bill_id: String(preferred('bill_id') || ''),
    vendor: String(preferred('vendor') || ''),
    date: String(preferred('date') || ''),
    total_amount: preferred('total_amount') == null ? '' : String(preferred('total_amount')),
    product_name: String(preferred('product_name') || ''),
    serial_number: String(preferred('serial_number') || ''),
    notes: String(review?.reviewNotes || ''),
  }
}

function formatReviewFieldLabel(key: keyof ReviewDraft): string {
  const labels: Record<keyof ReviewDraft, string> = {
    bill_id: 'Invoice No',
    vendor: 'Vendor',
    date: 'Purchase Date',
    total_amount: 'Total Amount',
    product_name: 'Product Name',
    serial_number: 'Serial Number',
    notes: 'Review Notes',
  }
  return labels[key]
}

function getWorkspaceTabLabel(tab: WorkspaceTab): string {
  if (tab === 'manual') return 'Manual bill'
  if (tab === 'reassign') return 'Reassign existing'
  return 'Upload and assign'
}

function buildClientAuthHeaders(): HeadersInit | undefined {
  if (typeof window === 'undefined') return undefined
  const token = localStorage.getItem('auth_token')?.trim()
  if (!token) return undefined
  return { Authorization: `Bearer ${token}` }
}

function SidebarNavItem({
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
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm transition-all ${
        active
          ? 'bg-white/14 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
          : 'text-blue-100/70 hover:bg-white/8 hover:text-white'
      }`}
    >
      <Icon className="h-4.5 w-4.5" />
      <span>{label}</span>
      {active ? <div className="ml-auto h-2 w-2 rounded-full bg-cyan-300" /> : null}
    </button>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: any
  label: string
  value: string
  detail: string
  accent: 'blue' | 'emerald' | 'amber' | 'violet'
}) {
  const accentClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
  }

  return (
    <div className="dashboard-stat-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
          <p className="mt-2 text-sm text-slate-500">{detail}</p>
        </div>
        <div className={`rounded-2xl border p-3 ${accentClasses[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

function NoticeBanner({
  notice,
  onDismiss,
  onOpenDocument,
}: {
  notice: ActionNotice
  onDismiss: () => void
  onOpenDocument?: () => void
}) {
  const isSuccess = notice.tone === 'success'
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
        isSuccess
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-red-200 bg-red-50 text-red-800'
      }`}
    >
      {isSuccess ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="flex-1">
        <p>{notice.message}</p>
        {isSuccess && notice.documentId && onOpenDocument ? (
          <button
            onClick={onOpenDocument}
            className="mt-2 inline-flex items-center gap-1 font-semibold text-emerald-800 hover:text-emerald-900"
          >
            Open document
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <button onClick={onDismiss} className="rounded-full p-1 hover:bg-black/5">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function EmptyPanel({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
        <Package className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          {actionLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}

export function MerchantDashboardScreen() {
  const router = useRouter()
  const { user, clearAuth } = useAuthStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inventoryPanelRef = useRef<HTMLDivElement>(null)
  const activityPanelRef = useRef<HTMLDivElement>(null)

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeNav, setActiveNav] = useState<NavigationMode>('workspace')
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('upload')
  const [activeWorkspacePanel, setActiveWorkspacePanel] = useState<WorkspacePanel>('inventory')

  const [documents, setDocuments] = useState<Document[]>([])
  const [recentActivity, setRecentActivity] = useState<MerchantActivity[]>([])
  const [assignmentAudits, setAssignmentAudits] = useState<MerchantAssignmentAudit[]>([])
  const [unreadNotifications, setUnreadNotifications] = useState<InAppNotification[]>([])
  const [extractionReviews, setExtractionReviews] = useState<ExtractionReview[]>([])
  const [notificationCount, setNotificationCount] = useState(0)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const [consumerLookupInput, setConsumerLookupInput] = useState('')
  const [resolvedConsumer, setResolvedConsumer] = useState<ConsumerLookup | null>(null)
  const [selectedConsumer, setSelectedConsumer] = useState<ConsumerLookup | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)

  const [inventoryQuery, setInventoryQuery] = useState('')
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null)
  const [assignBusyDocId, setAssignBusyDocId] = useState<string | null>(null)
  const [assignNotice, setAssignNotice] = useState<ActionNotice | null>(null)
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>({
    bill_id: '',
    vendor: '',
    date: '',
    total_amount: '',
    product_name: '',
    serial_number: '',
    notes: '',
  })
  const [reviewSaveLoading, setReviewSaveLoading] = useState(false)
  const [reviewNotice, setReviewNotice] = useState<ActionNotice | null>(null)

  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadForm, setUploadForm] = useState<UploadFormState>({
    consumerId: '',
    billId: '',
    vendor: '',
    purchaseDate: '',
    totalAmount: '',
  })
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadNotice, setUploadNotice] = useState<ActionNotice | null>(null)

  const [manualForm, setManualForm] = useState<ManualFormState>({
    consumerId: '',
    productName: '',
    invoiceNo: '',
    purchaseDate: '',
    warrantyMonths: '12',
    purchasePrice: '',
    sellerName: user?.name || '',
    serialNumber: '',
    notes: '',
  })
  const [manualLoading, setManualLoading] = useState(false)
  const [manualNotice, setManualNotice] = useState<ActionNotice | null>(null)

  const resolveConsumerByCustomId = useCallback(async (customId: string): Promise<ConsumerLookup> => {
    const normalized = normalizeConsumerId(customId)
    if (!normalized) {
      throw new Error('Consumer ID is required.')
    }

    const response = await fetch('/api/auth/lookup-id', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(buildClientAuthHeaders() || {}),
      },
      credentials: 'include',
      body: JSON.stringify({ customId: normalized, userType: 'consumer' }),
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
  }, [])

  const applyConsumerToWorkspace = useCallback((consumer: ConsumerLookup) => {
    setResolvedConsumer(consumer)
    setSelectedConsumer(consumer)
    setConsumerLookupInput(consumer.customId)
    setUploadForm((current) => ({ ...current, consumerId: consumer.customId }))
    setManualForm((current) => ({ ...current, consumerId: consumer.customId }))
    setLookupError(null)
  }, [])

  const loadWorkspace = useCallback(async () => {
    if (!user?.userId) return
    setWorkspaceLoading(true)
    setWorkspaceError(null)

    const [documentsResult, activityResult, notificationsResult, auditsResult, reviewsResult] = await Promise.allSettled([
      apiClient.get<{ documents: Document[] }>('/documents', {
        params: { merchantUserId: user.userId, limit: 200 },
      }),
      apiClient.get<{ activities: MerchantActivity[] }>('/merchant/activity', {
        params: { merchantUserId: user.userId, limit: 100 },
      }),
      apiClient.get<{ notifications: InAppNotification[] }>('/notifications', {
        params: { userId: user.userId, include_read: false, limit: 20 },
      }),
      apiClient.get<{ assignments: MerchantAssignmentAudit[] }>('/merchant/assignment-audits', {
        params: { merchantUserId: user.userId, limit: 50 },
      }),
      apiClient.get<{ reviews: ExtractionReview[] }>('/extraction-reviews', {
        params: { merchantUserId: user.userId, status: 'pending', limit: 50 },
      }),
    ])

    if (documentsResult.status === 'fulfilled') {
      setDocuments(documentsResult.value.documents || [])
    }
    if (activityResult.status === 'fulfilled') {
      setRecentActivity(activityResult.value.activities || [])
    }
    if (notificationsResult.status === 'fulfilled') {
      const notifications = notificationsResult.value.notifications || []
      setUnreadNotifications(notifications)
      setNotificationCount(notifications.length)
    }
    if (auditsResult.status === 'fulfilled') {
      setAssignmentAudits(auditsResult.value.assignments || [])
    }
    if (reviewsResult.status === 'fulfilled') {
      setExtractionReviews(reviewsResult.value.reviews || [])
    }

    if (
      documentsResult.status === 'rejected' &&
      activityResult.status === 'rejected' &&
      notificationsResult.status === 'rejected' &&
      auditsResult.status === 'rejected' &&
      reviewsResult.status === 'rejected'
    ) {
      setWorkspaceError('Merchant workspace failed to load. Refresh and retry.')
    }

    setWorkspaceLoading(false)
  }, [user?.userId])

  useEffect(() => {
    if (!user) return
    if (user.userType !== 'merchant') {
      router.replace('/locker')
      return
    }
    setManualForm((current) => ({
      ...current,
      sellerName: current.sellerName || user.name || '',
    }))
    loadWorkspace()
  }, [loadWorkspace, router, user])

  useEffect(() => {
    const activeReview = extractionReviews.find((review) => review.reviewId === selectedReviewId) || null
    setReviewDraft(normalizeReviewDraft(activeReview))
  }, [extractionReviews, selectedReviewId])

  useEffect(() => {
    if (!extractionReviews.length) {
      setSelectedReviewId(null)
      return
    }
    if (!selectedReviewId || !extractionReviews.some((review) => review.reviewId === selectedReviewId)) {
      setSelectedReviewId(extractionReviews[0].reviewId)
    }
  }, [extractionReviews, selectedReviewId])

  const activityByDocumentId = useMemo(() => {
    const map = new Map<string, MerchantActivity>()
    for (const activity of recentActivity) {
      if (!map.has(activity.documentId)) {
        map.set(activity.documentId, activity)
      }
    }
    return map
  }, [recentActivity])

  const documentById = useMemo(() => {
    const map = new Map<string, Document>()
    for (const document of documents) {
      map.set(document.docId, document)
    }
    return map
  }, [documents])

  const recentConsumers = useMemo(() => {
    const seen = new Set<string>()
    const roster: ConsumerLookup[] = []
    for (const activity of recentActivity) {
      if (!activity.consumerUserId) continue
      const key = activity.consumerUserId
      if (seen.has(key)) continue
      seen.add(key)
      roster.push({
        userId: activity.consumerUserId,
        customId: activity.consumerCustomId || activity.consumerUserId.slice(0, 8).toUpperCase(),
        fullName: activity.consumerName || 'Consumer',
        email: '',
      })
    }
    return roster.slice(0, 6)
  }, [recentActivity])

  const filteredDocuments = useMemo(() => {
    const query = inventoryQuery.trim().toLowerCase()
    if (!query) return documents
    return documents.filter((document) => {
      const primaryItem = getPrimaryItem(document)
      const haystack = [
        document.title,
        document.sellerName,
        document.consumerCustomId,
        document.userId,
        primaryItem?.invoiceNo,
        primaryItem?.productName,
        primaryItem?.model,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [documents, inventoryQuery])

  const selectedDocument = useMemo(
    () => documents.find((document) => document.docId === selectedDocumentId) || null,
    [documents, selectedDocumentId]
  )

  const selectedReview = useMemo(
    () => extractionReviews.find((review) => review.reviewId === selectedReviewId) || null,
    [extractionReviews, selectedReviewId]
  )
  const selectedReviewDocument = selectedReview ? documentById.get(selectedReview.documentId) || null : null

  const reviewQueue = useMemo(
    () =>
      extractionReviews
        .slice()
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .slice(0, 6),
    [extractionReviews]
  )

  const auditTrail = useMemo(() => assignmentAudits.slice(0, 8), [assignmentAudits])

  const pendingAuditCount = useMemo(
    () => assignmentAudits.filter((audit) => String(audit.status || '').trim().toLowerCase() !== 'accepted').length,
    [assignmentAudits]
  )

  const stats = useMemo(() => {
    const uniqueConsumers = new Set<string>()
    let totalValue = 0
    let attentionCount = 0

    for (const document of documents) {
      if (document.userId) uniqueConsumers.add(document.userId)
      const amount = getDocumentAmount(document)
      if (amount) totalValue += amount
      if (document.reviewRequired || (document.lowConfidenceFields || []).length > 0) {
        attentionCount += 1
      }
    }

    return {
      totalBills: documents.length,
      totalConsumers: uniqueConsumers.size,
      trackedValue: totalValue,
      attentionCount,
    }
  }, [documents])

  const handleLookup = useCallback(async () => {
    const normalized = normalizeConsumerId(consumerLookupInput)
    if (!normalized) return
    setLookupLoading(true)
    setLookupError(null)
    try {
      const consumer = await resolveConsumerByCustomId(normalized)
      applyConsumerToWorkspace(consumer)
    } catch (error) {
      setResolvedConsumer(null)
      setLookupError(error instanceof Error ? error.message : 'Consumer lookup failed.')
    } finally {
      setLookupLoading(false)
    }
  }, [applyConsumerToWorkspace, consumerLookupInput, resolveConsumerByCustomId])

  const handleUpload = useCallback(async () => {
    if (!uploadFile || !user?.userId) return
    setUploadLoading(true)
    setUploadNotice(null)
    try {
      const consumer = await resolveConsumerByCustomId(uploadForm.consumerId || selectedConsumer?.customId || '')
      applyConsumerToWorkspace(consumer)

      const formData = new FormData()
      formData.append('file', uploadFile)
      formData.append('merchantUserId', user.userId)
      if (user.name) formData.append('merchantName', user.name)
      if (user.customId) formData.append('merchantCustomId', user.customId)
      formData.append('consumerUserId', consumer.userId)
      formData.append('consumerCustomId', consumer.customId)
      formData.append('consumerName', consumer.fullName)
      if (consumer.email) formData.append('consumerEmail', consumer.email)
      if (uploadForm.billId.trim()) formData.append('billId', uploadForm.billId.trim())
      if (uploadForm.vendor.trim()) formData.append('vendor', uploadForm.vendor.trim())
      if (uploadForm.purchaseDate.trim()) formData.append('purchaseDate', uploadForm.purchaseDate.trim())
      if (uploadForm.totalAmount.trim()) formData.append('totalAmount', uploadForm.totalAmount.trim())
      formData.append('ocrMode', 'hybrid')

      const response = await fetch('/api/merchant/upload', {
        method: 'POST',
        headers: buildClientAuthHeaders(),
        credentials: 'include',
        body: formData,
      })
      const payload = (await response.json().catch(() => null)) as MerchantUploadResponse | { error?: string } | null
      if (!response.ok) {
        const message = payload && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : 'Bill upload failed.'
        throw new Error(message)
      }

      const documentId = payload && 'document' in payload ? payload.document?.docId : undefined
      setUploadNotice({
        tone: 'success',
        message: `Invoice uploaded and assigned to ${consumer.fullName}.`,
        documentId,
      })
      setUploadFile(null)
      setUploadForm({ consumerId: consumer.customId, billId: '', vendor: '', purchaseDate: '', totalAmount: '' })
      if (fileInputRef.current) fileInputRef.current.value = ''
      await loadWorkspace()
      if (documentId) setSelectedDocumentId(documentId)
    } catch (error) {
      setUploadNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Bill upload failed.',
      })
    } finally {
      setUploadLoading(false)
    }
  }, [applyConsumerToWorkspace, loadWorkspace, resolveConsumerByCustomId, selectedConsumer?.customId, uploadFile, uploadForm, user?.customId, user?.name, user?.userId])

  const handleManualCreate = useCallback(async () => {
    if (!user?.userId || !manualForm.productName.trim()) return
    setManualLoading(true)
    setManualNotice(null)
    try {
      const consumer = await resolveConsumerByCustomId(manualForm.consumerId || selectedConsumer?.customId || '')
      applyConsumerToWorkspace(consumer)
      const payload = await apiClient.post<MerchantManualResponse>('/merchant/manual-bill', {
        merchantUserId: user.userId,
        merchantName: user.name || 'Merchant',
        merchantCustomId: user.customId,
        consumerUserId: consumer.userId,
        consumerCustomId: consumer.customId,
        consumerName: consumer.fullName,
        consumerEmail: consumer.email || undefined,
        productName: manualForm.productName.trim(),
        billId: manualForm.invoiceNo.trim() || undefined,
        vendor: manualForm.sellerName.trim() || undefined,
        purchaseDate: manualForm.purchaseDate.trim() || undefined,
        totalAmount: manualForm.purchasePrice ? Number(manualForm.purchasePrice) : undefined,
        warrantyMonths: manualForm.warrantyMonths ? Number(manualForm.warrantyMonths) : undefined,
        serialNumber: manualForm.serialNumber.trim() || undefined,
        notes: manualForm.notes.trim() || undefined,
        category: 'Others',
      })
      const documentId = payload.document?.docId
      setManualNotice({
        tone: 'success',
        message: `Manual bill created and assigned to ${consumer.fullName}.`,
        documentId,
      })
      setManualForm({
        consumerId: consumer.customId,
        productName: '',
        invoiceNo: '',
        purchaseDate: '',
        warrantyMonths: '12',
        purchasePrice: '',
        sellerName: user.name || '',
        serialNumber: '',
        notes: '',
      })
      await loadWorkspace()
      if (documentId) setSelectedDocumentId(documentId)
    } catch (error) {
      setManualNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Manual bill creation failed.',
      })
    } finally {
      setManualLoading(false)
    }
  }, [applyConsumerToWorkspace, loadWorkspace, manualForm, resolveConsumerByCustomId, selectedConsumer?.customId, user?.customId, user?.name, user?.userId])

  const assignDocumentToConsumer = useCallback(async (documentId: string, consumerOverride?: ConsumerLookup) => {
    if (!user?.userId) return
    setAssignBusyDocId(documentId)
    setAssignNotice(null)
    try {
      const consumer = consumerOverride || await resolveConsumerByCustomId(selectedConsumer?.customId || '')
      applyConsumerToWorkspace(consumer)
      const payload = await apiClient.post<Document>(`/merchant/documents/${documentId}/assign`, {
        merchantUserId: user.userId,
        merchantName: user.name || 'Merchant',
        merchantCustomId: user.customId,
        consumerUserId: consumer.userId,
        consumerCustomId: consumer.customId,
        consumerName: consumer.fullName,
        consumerEmail: consumer.email || undefined,
      })
      setAssignNotice({
        tone: 'success',
        message: `Assigned ${payload.title || 'invoice'} to ${consumer.fullName}.`,
        documentId: payload.docId,
      })
      setSelectedDocumentId(payload.docId)
      await loadWorkspace()
    } catch (error) {
      setAssignNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Document assignment failed.',
      })
    } finally {
      setAssignBusyDocId(null)
    }
  }, [applyConsumerToWorkspace, loadWorkspace, resolveConsumerByCustomId, selectedConsumer?.customId, user?.customId, user?.name, user?.userId])

  const saveExtractionReview = useCallback(async (status: 'confirmed' | 'rejected') => {
    if (!selectedReview) return
    setReviewSaveLoading(true)
    setReviewNotice(null)
    try {
      const confirmedFields: Record<string, unknown> = {
        bill_id: reviewDraft.bill_id.trim() || undefined,
        vendor: reviewDraft.vendor.trim() || undefined,
        date: reviewDraft.date.trim() || undefined,
        total_amount: reviewDraft.total_amount.trim() ? Number(reviewDraft.total_amount) : undefined,
        product_name: reviewDraft.product_name.trim() || undefined,
        serial_number: reviewDraft.serial_number.trim() || undefined,
      }
      Object.keys(confirmedFields).forEach((key) => {
        if (confirmedFields[key] === undefined || Number.isNaN(confirmedFields[key])) {
          delete confirmedFields[key]
        }
      })

      await apiClient.put<ExtractionReview>(`/extraction-reviews/${selectedReview.reviewId}`, {
        confirmed_fields: confirmedFields,
        review_notes: reviewDraft.notes.trim() || undefined,
        status,
      })
      setReviewNotice({
        tone: 'success',
        message: status === 'confirmed'
          ? 'OCR review saved and document fields were confirmed.'
          : 'OCR review was rejected and flagged for further correction.',
        documentId: selectedReview.documentId,
      })
      await loadWorkspace()
    } catch (error) {
      setReviewNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Failed to save OCR review.',
      })
    } finally {
      setReviewSaveLoading(false)
    }
  }, [loadWorkspace, reviewDraft, selectedReview])

  const handleLogout = useCallback(async () => {
    await clearAuth()
    router.push('/landing')
  }, [clearAuth, router])

  const scrollInventoryPanelIntoView = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        inventoryPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }, [])

  const scrollActivityPanelIntoView = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        activityPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }, [])

  const openInventoryPanel = useCallback(() => {
    setActiveWorkspacePanel('inventory')
    setInventoryQuery('')
    scrollInventoryPanelIntoView()
  }, [scrollInventoryPanelIntoView])

  const navigateToWorkspace = useCallback(() => {
    setActiveNav('workspace')
    setSidebarOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const navigateToActivity = useCallback(() => {
    setActiveNav('activity')
    setSidebarOpen(false)
    scrollActivityPanelIntoView()
  }, [scrollActivityPanelIntoView])

  if (!user) {
    return (
      <div className="dashboard-shell flex min-h-screen items-center justify-center px-6">
        <div className="dashboard-card flex items-center gap-3 px-5 py-4 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading merchant workspace...
        </div>
      </div>
    )
  }

  const headerName = user.name?.split(' ')[0] || 'Merchant'

  return (
    <div className="dashboard-shell flex min-h-screen overflow-hidden text-slate-950">
      <aside className="hidden w-72 shrink-0 bg-[linear-gradient(180deg,#0f1f52_0%,#0a1538_45%,#08112f_100%)] text-white lg:flex lg:flex-col">
        <div className="border-b border-white/10 px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/12 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-tight">SafeBill</p>
              <p className="text-xs uppercase tracking-[0.26em] text-blue-100/55">Merchant Ops</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6">
          <div className="mb-3 px-4 text-xs font-semibold uppercase tracking-[0.24em] text-blue-100/40">Workspace</div>
          <div className="space-y-1.5">
            <SidebarNavItem
              icon={LayoutDashboard}
              label="Assignment Console"
              active={activeNav === 'workspace'}
              onClick={navigateToWorkspace}
            />
            <SidebarNavItem icon={Clock3} label="Merchant Activity" active={activeNav === 'activity'} onClick={navigateToActivity} />
          </div>
        </nav>

        <div className="mt-auto border-t border-white/10 p-4">
          <div className="rounded-3xl bg-white/8 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
            <p className="text-sm font-semibold">{user.name || 'Merchant'}</p>
            <p className="mt-1 truncate text-xs text-blue-100/55">{user.customId || user.phone || user.email || user.loginId}</p>
          </div>
          <div className="mt-4 space-y-1.5">
            <SidebarNavItem icon={Settings} label="Settings" active={false} onClick={() => router.push('/settings')} />
            <SidebarNavItem icon={LogOut} label="Logout" active={false} onClick={handleLogout} />
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="dashboard-navbar flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <button
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open merchant menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Merchant dashboard</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                {activeNav === 'workspace' ? 'Assignment console' : 'Merchant activity'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {activeNav === 'workspace'
                  ? 'Resolve consumers, process bills, and manage reassignment from one focused workspace.'
                  : 'Track consumer responses, notifications, and locker events without mixing them into the bill form.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end lg:self-auto">
            <button
              type="button"
              onClick={loadWorkspace}
              className="hidden items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 lg:inline-flex"
            >
              <RefreshCw className={`h-4 w-4 ${workspaceLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={navigateToActivity}
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              aria-label="Merchant notifications"
            >
              <Bell className="h-5 w-5" />
              {notificationCount > 0 ? (
                <span className="absolute right-1.5 top-1.5 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                  {notificationCount}
                </span>
              ) : null}
            </button>
            <div className="hidden items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm lg:flex">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 text-sm font-bold text-white">
                {headerName[0]?.toUpperCase() || 'M'}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{user.name || 'Merchant'}</p>
                <p className="text-xs text-slate-500">{user.customId || user.phone || user.email || user.loginId}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-10 pt-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-6">
            <section className="dashboard-card overflow-hidden">
              <div className="grid gap-6 px-6 py-6 xl:grid-cols-[minmax(0,1.28fr)_380px] lg:px-8 lg:py-8">
                <div>
                  <p className="text-sm font-semibold text-blue-600">Merchant assignment workflow</p>
                  <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">Assign every bill through consumer ID</h1>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-500 lg:text-base">
                    Search the consumer, verify the recipient, upload or create the bill, and reassign any existing invoice from one workspace.
                  </p>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                      <span className="font-semibold">Current workflow:</span> {getWorkspaceTabLabel(activeTab)}
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                      <span className="font-semibold">Review queue:</span> {reviewQueue.length} pending
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                      <span className="font-semibold">Inventory:</span> {documents.length} merchant invoice{documents.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-blue-100 bg-[linear-gradient(135deg,#eff6ff_0%,#f8fbff_100%)] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Active consumer</p>
                      <h2 className="mt-2 text-lg font-semibold text-slate-950">
                        {selectedConsumer ? selectedConsumer.fullName : 'No consumer selected'}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {selectedConsumer ? `${selectedConsumer.customId}${selectedConsumer.email ? ` | ${selectedConsumer.email}` : ''}` : 'Search with SafeBill consumer ID to start assigning bills.'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-blue-200 bg-white p-3 text-blue-600">
                      <UserCheck className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Step 1</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">Resolve consumer</p>
                    </div>
                    <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Step 2</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">Attach or create bill</p>
                    </div>
                    <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Step 3</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">Confirm locker assignment</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-white/70 bg-white/70 px-4 py-3 text-sm text-slate-600">
                    {activeNav === 'workspace'
                      ? 'Workspace view keeps consumer lookup, bill workflow, and the selected secondary panel visible without stacking every operational feed below it.'
                      : 'Activity view isolates notifications, assignment audits, and locker changes so the bill form is not competing for space.'}
                  </div>
                </div>
              </div>
            </section>

            {workspaceError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {workspaceError}
              </div>
            ) : null}

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={Receipt}
                label="Bills in workspace"
                value={String(stats.totalBills)}
                detail="Merchant-scoped invoices available for assignment"
                accent="blue"
              />
              <MetricCard
                icon={Users}
                label="Consumers reached"
                value={String(stats.totalConsumers)}
                detail="Unique consumers assigned from this merchant workspace"
                accent="emerald"
              />
              <MetricCard
                icon={IndianRupee}
                label="Assigned value"
                value={formatCurrency(stats.trackedValue)}
                detail="Total invoice amount currently tracked in merchant scope"
                accent="amber"
              />
              <MetricCard
                icon={ShieldCheck}
                label="Needs review"
                value={String(stats.attentionCount)}
                detail={`${pendingAuditCount} assignment${pendingAuditCount === 1 ? '' : 's'} still waiting for final acceptance`}
                accent="violet"
              />
            </section>

            <section className={activeNav === 'workspace' ? 'grid gap-6 2xl:grid-cols-[minmax(0,1.45fr)_380px]' : 'grid gap-6'}>
              <div className={activeNav === 'workspace' ? 'space-y-6' : 'hidden'}>
                <div className="dashboard-card p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Consumer resolution</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Search by consumer ID</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-500">Resolve the recipient before you upload or reassign any bill. The active consumer is reused across the whole merchant workspace.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recentConsumers.map((consumer) => (
                        <button
                          key={`${consumer.userId}-${consumer.customId}`}
                          onClick={() => applyConsumerToWorkspace(consumer)}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                        >
                          {consumer.customId}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={consumerLookupInput}
                        onChange={(event) => setConsumerLookupInput(normalizeConsumerId(event.target.value))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void handleLookup()
                          }
                        }}
                        placeholder="Enter SafeBill consumer ID, for example CON-AB12CD"
                        className="dashboard-input h-12 rounded-2xl border-slate-200 !pl-11 pr-4"
                      />
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
                      <button
                        onClick={() => void handleLookup()}
                        disabled={lookupLoading || !consumerLookupInput.trim()}
                        className="inline-flex h-12 min-w-[164px] items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        Verify consumer
                      </button>
                      {selectedConsumer ? (
                        <button
                          onClick={() => {
                            setSelectedConsumer(null)
                            setResolvedConsumer(null)
                            setLookupError(null)
                          }}
                          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                        >
                          <X className="h-4 w-4" />
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {lookupError ? (
                    <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{lookupError}</div>
                  ) : null}

                  {resolvedConsumer ? (
                    <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
                      <div className="rounded-[26px] border border-emerald-200 bg-emerald-50 px-5 py-5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm">
                            <UserCheck className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-950">{resolvedConsumer.fullName}</p>
                            <p className="text-xs text-slate-500">{resolvedConsumer.customId}{resolvedConsumer.email ? ` | ${resolvedConsumer.email}` : ''}</p>
                          </div>
                        </div>
                        <p className="mt-4 text-sm leading-6 text-slate-600">
                          This consumer is now the active recipient for uploads, manual bills, and reassignment actions.
                        </p>
                      </div>
                      <div className="rounded-[26px] border border-slate-200 bg-slate-50 px-5 py-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Next action</p>
                        <p className="mt-3 text-sm leading-6 text-slate-600">
                          Continue in <span className="font-semibold text-slate-900">{getWorkspaceTabLabel(activeTab)}</span>. Use the workflow switch beside this panel to upload, create, or reassign without jumping around the page.
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                            {getWorkspaceTabLabel(activeTab)}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500">
                            {selectedDocument ? 'Invoice selected for reassignment' : 'No invoice selected yet'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="dashboard-card p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Assignment actions</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Merchant bill workflows</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-500">All actions below are consumer-ID aware. The selected consumer, if present, is reused automatically.</p>
                    </div>
                    <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
                      {[
                        { key: 'upload', label: 'Upload and assign', icon: Upload },
                        { key: 'manual', label: 'Manual bill', icon: Plus },
                        { key: 'reassign', label: 'Reassign existing', icon: Link2 },
                      ].map((tab) => {
                        const Icon = tab.icon
                        return (
                          <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key as WorkspaceTab)}
                            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                              activeTab === tab.key
                                ? 'bg-white text-slate-950 shadow-sm'
                                : 'text-slate-500 hover:text-slate-900'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            {tab.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="mt-6 space-y-4">
                    {activeTab === 'upload' ? (
                      <>
                        {uploadNotice ? (
                          <NoticeBanner
                            notice={uploadNotice}
                            onDismiss={() => setUploadNotice(null)}
                            onOpenDocument={uploadNotice.documentId ? () => router.push(`/document/${uploadNotice.documentId}`) : undefined}
                          />
                        ) : null}
                        <div className="grid gap-4 lg:grid-cols-2">
                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Consumer ID</span>
                            <input
                              type="text"
                              value={uploadForm.consumerId}
                              onChange={(event) => setUploadForm((current) => ({ ...current, consumerId: normalizeConsumerId(event.target.value) }))}
                              placeholder="CON-AB12CD"
                              className="dashboard-input"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Invoice number override</span>
                            <input
                              type="text"
                              value={uploadForm.billId}
                              onChange={(event) => setUploadForm((current) => ({ ...current, billId: event.target.value }))}
                              placeholder="Optional"
                              className="dashboard-input"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Vendor override</span>
                            <input
                              type="text"
                              value={uploadForm.vendor}
                              onChange={(event) => setUploadForm((current) => ({ ...current, vendor: event.target.value }))}
                              placeholder="Optional"
                              className="dashboard-input"
                            />
                          </label>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <label className="space-y-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Purchase date</span>
                              <input
                                type="date"
                                value={uploadForm.purchaseDate}
                                onChange={(event) => setUploadForm((current) => ({ ...current, purchaseDate: event.target.value }))}
                                className="dashboard-input"
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Amount</span>
                              <input
                                type="number"
                                min="0"
                                value={uploadForm.totalAmount}
                                onChange={(event) => setUploadForm((current) => ({ ...current, totalAmount: event.target.value }))}
                                placeholder="Optional"
                                className="dashboard-input"
                              />
                            </label>
                          </div>
                        </div>
                        <label className="block space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Invoice file</span>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*,.pdf"
                            onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
                            className="block w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
                          />
                        </label>
                        {uploadFile ? (
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                            Selected file: <span className="font-semibold text-slate-900">{uploadFile.name}</span>
                          </div>
                        ) : null}
                        <button
                          onClick={() => void handleUpload()}
                          disabled={uploadLoading || !uploadFile || !(uploadForm.consumerId || selectedConsumer?.customId)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {uploadLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          Upload invoice and assign to locker
                        </button>
                      </>
                    ) : null}

                    {activeTab === 'manual' ? (
                      <>
                        {manualNotice ? (
                          <NoticeBanner
                            notice={manualNotice}
                            onDismiss={() => setManualNotice(null)}
                            onOpenDocument={manualNotice.documentId ? () => router.push(`/document/${manualNotice.documentId}`) : undefined}
                          />
                        ) : null}
                        <div className="grid gap-4 lg:grid-cols-2">
                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Consumer ID</span>
                            <input
                              type="text"
                              value={manualForm.consumerId}
                              onChange={(event) => setManualForm((current) => ({ ...current, consumerId: normalizeConsumerId(event.target.value) }))}
                              placeholder="CON-AB12CD"
                              className="dashboard-input"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Product name</span>
                            <input
                              type="text"
                              value={manualForm.productName}
                              onChange={(event) => setManualForm((current) => ({ ...current, productName: event.target.value }))}
                              placeholder="Bosch drill kit"
                              className="dashboard-input"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Invoice number</span>
                            <input
                              type="text"
                              value={manualForm.invoiceNo}
                              onChange={(event) => setManualForm((current) => ({ ...current, invoiceNo: event.target.value }))}
                              placeholder="INV-10293"
                              className="dashboard-input"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Seller or vendor</span>
                            <input
                              type="text"
                              value={manualForm.sellerName}
                              onChange={(event) => setManualForm((current) => ({ ...current, sellerName: event.target.value }))}
                              placeholder="Merchant or brand"
                              className="dashboard-input"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Purchase date</span>
                            <input
                              type="date"
                              value={manualForm.purchaseDate}
                              onChange={(event) => setManualForm((current) => ({ ...current, purchaseDate: event.target.value }))}
                              className="dashboard-input"
                            />
                          </label>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <label className="space-y-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Warranty months</span>
                              <input
                                type="number"
                                min="1"
                                max="180"
                                value={manualForm.warrantyMonths}
                                onChange={(event) => setManualForm((current) => ({ ...current, warrantyMonths: event.target.value }))}
                                className="dashboard-input"
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Amount</span>
                              <input
                                type="number"
                                min="0"
                                value={manualForm.purchasePrice}
                                onChange={(event) => setManualForm((current) => ({ ...current, purchasePrice: event.target.value }))}
                                className="dashboard-input"
                              />
                            </label>
                          </div>
                          <label className="space-y-2 lg:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Serial number</span>
                            <input
                              type="text"
                              value={manualForm.serialNumber}
                              onChange={(event) => setManualForm((current) => ({ ...current, serialNumber: event.target.value }))}
                              placeholder="Optional"
                              className="dashboard-input"
                            />
                          </label>
                          <label className="space-y-2 lg:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Notes</span>
                            <textarea
                              value={manualForm.notes}
                              onChange={(event) => setManualForm((current) => ({ ...current, notes: event.target.value }))}
                              placeholder="Add service notes, brand details, or seller context"
                              className="min-h-[104px] w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                            />
                          </label>
                        </div>
                        <button
                          onClick={() => void handleManualCreate()}
                          disabled={manualLoading || !manualForm.productName.trim() || !(manualForm.consumerId || selectedConsumer?.customId)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {manualLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                          Create manual bill and assign
                        </button>
                      </>
                    ) : null}

                    {activeTab === 'reassign' ? (
                      <>
                        {assignNotice ? (
                          <NoticeBanner
                            notice={assignNotice}
                            onDismiss={() => setAssignNotice(null)}
                            onOpenDocument={assignNotice.documentId ? () => router.push(`/document/${assignNotice.documentId}`) : undefined}
                          />
                        ) : null}
                        {selectedDocument ? (
                          <div className="grid gap-4 lg:grid-cols-[1.25fr_0.95fr]">
                            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Selected invoice</p>
                              <h3 className="mt-3 text-lg font-semibold text-slate-950">{selectedDocument.title}</h3>
                              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                <div className="rounded-2xl border border-white bg-white px-4 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Invoice no</p>
                                  <p className="mt-1 text-sm font-semibold text-slate-900">{getDocumentInvoice(selectedDocument)}</p>
                                </div>
                                <div className="rounded-2xl border border-white bg-white px-4 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Amount</p>
                                  <p className="mt-1 text-sm font-semibold text-slate-900">{formatCurrency(getDocumentAmount(selectedDocument))}</p>
                                </div>
                                <div className="rounded-2xl border border-white bg-white px-4 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Current consumer</p>
                                  <p className="mt-1 text-sm font-semibold text-slate-900">{selectedDocument.consumerCustomId || selectedDocument.userId || 'Not assigned'}</p>
                                </div>
                                <div className="rounded-2xl border border-white bg-white px-4 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Warranty end</p>
                                  <p className="mt-1 text-sm font-semibold text-slate-900">{formatDate(getDocumentWarrantyEnd(selectedDocument))}</p>
                                </div>
                              </div>
                            </div>
                            <div className="rounded-[28px] border border-blue-100 bg-blue-50/70 p-5">
                              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">New assignee</p>
                              <input
                                type="text"
                                value={selectedConsumer?.customId || ''}
                                readOnly
                                placeholder="Select a consumer from the lookup panel"
                                className="dashboard-input mt-4 bg-white"
                              />
                              <p className="mt-4 text-sm leading-6 text-slate-600">
                                Reassign the selected invoice to the active consumer. This updates the locker owner and records merchant assignment activity.
                              </p>
                              <button
                                onClick={() => void assignDocumentToConsumer(selectedDocument.docId, selectedConsumer || undefined)}
                                disabled={!selectedConsumer || assignBusyDocId === selectedDocument.docId}
                                className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {assignBusyDocId === selectedDocument.docId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                                Reassign this bill
                              </button>
                            </div>
                          </div>
                        ) : (
                          <EmptyPanel
                            title="Pick an invoice from the merchant bill list"
                            description="Select any existing bill below, then reassign it to the active consumer without leaving the merchant workspace."
                            actionLabel="Open bill inventory"
                            onAction={openInventoryPanel}
                          />
                        )}
                      </>
                    ) : null}
                  </div>
                </div>

                {activeWorkspacePanel === 'review' ? (
                <div className="dashboard-card p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">OCR review workspace</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Review and correct extraction</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        Merchant operators can verify OCR output, correct mapped fields, and push the confirmed values back into the document record.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                        {reviewQueue.length} pending review
                      </span>
                      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
                        <button
                          onClick={() => setActiveWorkspacePanel('inventory')}
                          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:text-slate-900"
                        >
                          <Package className="h-4 w-4" />
                          Inventory
                        </button>
                        <button
                          onClick={() => setActiveWorkspacePanel('review')}
                          className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-sm"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          OCR review
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-5 xl:grid-cols-[0.95fr_1.15fr]">
                    <div className="space-y-3">
                      {reviewQueue.length === 0 ? (
                        <EmptyPanel
                          title="No OCR reviews pending"
                          description="When extraction confidence is low, the invoice will appear here for merchant correction."
                        />
                      ) : (
                        reviewQueue.map((review) => {
                          const relatedDocument = documentById.get(review.documentId)
                          const isSelected = review.reviewId === selectedReviewId
                          return (
                            <button
                              key={review.reviewId}
                              onClick={() => setSelectedReviewId(review.reviewId)}
                              className={`w-full rounded-[24px] border p-4 text-left transition ${
                                isSelected
                                  ? 'border-blue-300 bg-blue-50 ring-4 ring-blue-100'
                                  : 'border-slate-200 bg-slate-50/70 hover:border-slate-300'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-950">
                                    {relatedDocument?.title || review.extractedFields?.product_name?.toString() || 'Untitled invoice'}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {relatedDocument?.sellerName || String(review.extractedFields?.vendor || 'Vendor missing')}
                                  </p>
                                </div>
                                <span className="rounded-full border border-amber-200 bg-white px-2 py-1 text-[11px] font-semibold text-amber-700">
                                  {review.status}
                                </span>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {(review.lowConfidenceFields || []).slice(0, 4).map((field) => (
                                  <span key={field} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm">
                                    {field}
                                  </span>
                                ))}
                              </div>
                              <p className="mt-3 text-xs text-slate-400">
                                Updated {formatDate(review.updatedAt)} | {formatRelativeTime(review.updatedAt)}
                              </p>
                            </button>
                          )
                        })
                      )}
                    </div>

                    <div className="rounded-[28px] border border-slate-200 bg-slate-50/70 p-5">
                      {selectedReview ? (
                        <>
                          {reviewNotice ? (
                            <div className="mb-4">
                              <NoticeBanner
                                notice={reviewNotice}
                                onDismiss={() => setReviewNotice(null)}
                                onOpenDocument={reviewNotice.documentId ? () => router.push(`/document/${reviewNotice.documentId}`) : undefined}
                              />
                            </div>
                          ) : null}
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Selected review</p>
                              <h3 className="mt-2 text-lg font-semibold text-slate-950">
                                {selectedReviewDocument?.title || String(selectedReview.extractedFields?.product_name || 'Invoice review')}
                              </h3>
                              <p className="mt-1 text-sm text-slate-500">
                                {selectedReviewDocument?.consumerCustomId || selectedReview.userId} | {selectedReviewDocument?.sellerName || String(selectedReview.extractedFields?.vendor || 'Vendor missing')}
                              </p>
                            </div>
                            <button
                              onClick={() => router.push(`/document/${selectedReview.documentId}`)}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <Eye className="h-4 w-4" />
                              Open document
                            </button>
                          </div>

                          <div className="mt-5 grid gap-4 md:grid-cols-2">
                            {(['bill_id', 'vendor', 'date', 'total_amount', 'product_name', 'serial_number'] as const).map((fieldKey) => (
                              <label key={fieldKey} className="space-y-2">
                                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                  {formatReviewFieldLabel(fieldKey)}
                                </span>
                                <input
                                  type={fieldKey === 'total_amount' ? 'number' : fieldKey === 'date' ? 'date' : 'text'}
                                  value={reviewDraft[fieldKey]}
                                  onChange={(event) =>
                                    setReviewDraft((current) => ({ ...current, [fieldKey]: event.target.value }))
                                  }
                                  className="dashboard-input"
                                />
                              </label>
                            ))}
                            <label className="space-y-2 md:col-span-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Review notes</span>
                              <textarea
                                value={reviewDraft.notes}
                                onChange={(event) => setReviewDraft((current) => ({ ...current, notes: event.target.value }))}
                                placeholder="Explain what was corrected or why this review is rejected."
                                className="min-h-[112px] w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                              />
                            </label>
                          </div>

                          <div className="mt-5 flex flex-wrap gap-2">
                            <button
                              onClick={() => void saveExtractionReview('confirmed')}
                              disabled={reviewSaveLoading}
                              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                              {reviewSaveLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                              Confirm OCR correction
                            </button>
                            <button
                              onClick={() => void saveExtractionReview('rejected')}
                              disabled={reviewSaveLoading}
                              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <AlertCircle className="h-4 w-4" />
                              Reject and escalate
                            </button>
                          </div>
                        </>
                      ) : (
                        <EmptyPanel
                          title="No OCR review selected"
                          description="Pick a pending extraction review from the left to inspect mapped fields and push corrections back into the document."
                        />
                      )}
                    </div>
                  </div>
                </div>
                ) : null}

                {activeWorkspacePanel === 'inventory' ? (
                <div ref={inventoryPanelRef} className="dashboard-card scroll-mt-28 p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Bill inventory</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Merchant-assigned invoices</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-500">Search, review, open, or reassign any bill already linked to this merchant workspace.</p>
                    </div>
                    <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
                      <button
                        onClick={() => setActiveWorkspacePanel('inventory')}
                        className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-sm"
                      >
                        <Package className="h-4 w-4" />
                        Inventory
                      </button>
                      <button
                        onClick={() => setActiveWorkspacePanel('review')}
                        className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:text-slate-900"
                      >
                        <ShieldCheck className="h-4 w-4" />
                        OCR review
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{reviewQueue.length}</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <p className="text-sm text-slate-500">Showing {filteredDocuments.length} of {documents.length} invoices</p>
                    <div className="flex w-full flex-col gap-3 sm:flex-row lg:max-w-[520px] lg:justify-end">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={inventoryQuery}
                          onChange={(event) => setInventoryQuery(event.target.value)}
                          placeholder="Search product, invoice, vendor, consumer"
                          className="dashboard-input h-12 !pl-11 pr-4"
                        />
                      </div>
                      {workspaceLoading ? (
                        <div className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-500">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Syncing merchant data
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4 xl:grid-cols-2">
                    {filteredDocuments.length === 0 ? (
                      <div className="xl:col-span-2">
                        <EmptyPanel
                          title="No merchant invoices match this search"
                          description="Upload a new invoice, create a manual bill, or clear your search terms to see more merchant-owned documents."
                          actionLabel={documents.length === 0 ? 'Open upload flow' : 'Clear search'}
                          onAction={() => {
                            if (documents.length === 0) {
                              setActiveTab('upload')
                              window.scrollTo({ top: 0, behavior: 'smooth' })
                            } else {
                              setInventoryQuery('')
                            }
                          }}
                        />
                      </div>
                    ) : filteredDocuments.map((document) => {
                      const primaryItem = getPrimaryItem(document)
                      const latestActivity = activityByDocumentId.get(document.docId)
                      const currentConsumerLabel = document.consumerCustomId || latestActivity?.consumerCustomId || document.userId || 'Unassigned'
                      const currentConsumerName = latestActivity?.consumerName || 'Consumer'
                      const statusTone = getStatusTone(document)
                      const documentSelected = document.docId === selectedDocumentId
                      const canAssignToActiveConsumer = selectedConsumer && selectedConsumer.userId !== document.userId

                      return (
                        <article
                          key={document.docId}
                          className={`rounded-[28px] border bg-white p-5 shadow-sm transition ${
                            documentSelected ? 'border-blue-300 ring-4 ring-blue-100' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                                <Package className="h-5 w-5" />
                              </div>
                              <div>
                                <h3 className="line-clamp-2 text-lg font-semibold tracking-tight text-slate-950">{document.title}</h3>
                                <p className="mt-1 text-sm text-slate-500">{document.sellerName || primaryItem?.model || 'Vendor not captured'}</p>
                              </div>
                            </div>
                            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusChipClass(statusTone)}`}>
                              {getStatusLabel(document)}
                            </span>
                          </div>

                          <div className="mt-5 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Invoice</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">{getDocumentInvoice(document)}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Amount</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">{formatCurrency(getDocumentAmount(document))}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Current consumer</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">{currentConsumerLabel}</p>
                              <p className="mt-1 text-xs text-slate-500">{currentConsumerName}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Updated</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">{formatDate(document.updatedAt)}</p>
                              <p className="mt-1 text-xs text-slate-500">{formatRelativeTime(document.updatedAt)}</p>
                            </div>
                          </div>

                          <div className="mt-5 flex flex-wrap gap-2">
                            <button
                              onClick={() => router.push(`/document/${document.docId}`)}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <Eye className="h-4 w-4" />
                              View
                            </button>
                            <button
                              onClick={() => {
                                setSelectedDocumentId(document.docId)
                                setActiveTab('reassign')
                                window.scrollTo({ top: 0, behavior: 'smooth' })
                              }}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <Link2 className="h-4 w-4" />
                              Reassign
                            </button>
                            {canAssignToActiveConsumer ? (
                              <button
                                onClick={() => void assignDocumentToConsumer(document.docId, selectedConsumer || undefined)}
                                disabled={assignBusyDocId === document.docId}
                                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                {assignBusyDocId === document.docId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                Assign to active consumer
                              </button>
                            ) : (
                              <div className="inline-flex items-center rounded-xl border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-500">
                                {selectedConsumer ? 'Already assigned to active consumer' : 'Resolve a consumer to enable quick assign'}
                              </div>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
                ) : null}
              </div>

              <div className="space-y-6">
                {activeNav === 'workspace' ? (
                  <>
                    <div className="dashboard-card overflow-hidden">
                      <div className="border-b border-slate-100 px-5 py-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Active recipient</p>
                        <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Assignment context</h2>
                      </div>
                      <div className="p-5">
                        {selectedConsumer ? (
                          <div className="rounded-[28px] border border-blue-100 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_100%)] p-5">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="text-lg font-semibold text-slate-950">{selectedConsumer.fullName}</p>
                                <p className="mt-1 text-sm text-slate-500">{selectedConsumer.customId}</p>
                                <p className="mt-1 text-sm text-slate-500">{selectedConsumer.email || 'No email on record'}</p>
                              </div>
                              <div className="rounded-2xl border border-white bg-white p-3 text-blue-600 shadow-sm">
                                <UserCheck className="h-5 w-5" />
                              </div>
                            </div>
                            <div className="mt-5 space-y-3">
                              <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Active workflow</p>
                                <p className="mt-1 text-sm font-semibold text-slate-900">{getWorkspaceTabLabel(activeTab)}</p>
                              </div>
                              <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Selected bill</p>
                                <p className="mt-1 text-sm font-semibold text-slate-900">{selectedDocument?.title || 'No invoice selected'}</p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <EmptyPanel
                            title="No active consumer selected"
                            description="Resolve a consumer with their SafeBill ID to unlock upload, manual issue, and fast reassignment actions."
                          />
                        )}
                      </div>
                    </div>

                    <div className="dashboard-card overflow-hidden">
                      <div className="border-b border-slate-100 px-5 py-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Workspace summary</p>
                        <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">What needs attention</h2>
                      </div>
                      <div className="grid gap-3 p-5">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Assignments awaiting response</p>
                          <p className="mt-2 text-2xl font-semibold text-slate-950">{pendingAuditCount}</p>
                          <p className="mt-1 text-xs text-slate-500">Consumer acceptance and escalations continue in Merchant Activity.</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Unread merchant notifications</p>
                          <p className="mt-2 text-2xl font-semibold text-slate-950">{unreadNotifications.length}</p>
                          <p className="mt-1 text-xs text-slate-500">The bell icon switches to the activity feed when you need the details.</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">OCR queue</p>
                          <p className="mt-2 text-2xl font-semibold text-slate-950">{reviewQueue.length}</p>
                          <p className="mt-1 text-xs text-slate-500">Switch the secondary panel to OCR review when extraction confidence needs correction.</p>
                        </div>
                      </div>
                    </div>

                    <div className="dashboard-action-card p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-100/65">Merchant guidance</p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Keep assignments clean</h2>
                      <div className="mt-5 space-y-3 text-sm text-blue-50/90">
                        <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">Verify the consumer ID before uploading, so every locker assignment lands on the correct account.</div>
                        <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">Use reassign only when the invoice already exists in this merchant workspace and the owner needs to change.</div>
                        <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">Open the document after assignment if OCR, amount, or verification status needs a final review.</div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="dashboard-card overflow-hidden">
                    <div ref={activityPanelRef} className="scroll-mt-28">
                      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Consumer sync</p>
                          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Assignment and notification state</h2>
                        </div>
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                          {unreadNotifications.length} unread
                        </span>
                      </div>
                      <div className="p-5">
                        {unreadNotifications.length === 0 && assignmentAudits.length === 0 ? (
                          <EmptyPanel
                            title="No sync events yet"
                            description="Unread notifications, consumer acknowledgments, and escalations will appear here as the assignment workflow progresses."
                          />
                        ) : (
                          <div className="space-y-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Assignments awaiting response</p>
                                <p className="mt-2 text-2xl font-semibold text-slate-950">{pendingAuditCount}</p>
                                <p className="mt-1 text-xs text-slate-500">Accepted or escalated status from consumers updates the audit trail automatically.</p>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Unread merchant notifications</p>
                                <p className="mt-2 text-2xl font-semibold text-slate-950">{unreadNotifications.length}</p>
                                <p className="mt-1 text-xs text-slate-500">Notifications are scheduled from the same assignment and document workflow.</p>
                              </div>
                            </div>

                            {unreadNotifications.length ? (
                              <div className="space-y-3">
                                {unreadNotifications.slice(0, 4).map((notification) => (
                                  <article key={notification.notificationId} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                    <p className="text-sm font-semibold text-slate-950">{notification.title}</p>
                                    <p className="mt-1 text-xs leading-5 text-slate-500">{notification.message}</p>
                                    <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
                                      {notification.eventType || notification.type} | {formatRelativeTime(notification.triggerAt)}
                                    </p>
                                  </article>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                    </div>

                    <div className="dashboard-card overflow-hidden">
                      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Assignment audit</p>
                          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Latest assignment history</h2>
                        </div>
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                          {pendingAuditCount} open
                        </span>
                      </div>
                      <div className="max-h-[420px] overflow-y-auto">
                        {auditTrail.length === 0 ? (
                          <div className="p-5">
                            <EmptyPanel
                              title="No assignment audit yet"
                              description="Every upload, manual issue, and reassignment will create a merchant audit record here."
                            />
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-100">
                            {auditTrail.map((audit) => {
                              const document = documentById.get(audit.documentId)
                              const currentActivity = activityByDocumentId.get(audit.documentId)
                              return (
                                <button
                                  key={audit.assignmentId}
                                  onClick={() => router.push(`/document/${audit.documentId}`)}
                                  className="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
                                >
                                  <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                                    <Receipt className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="truncate text-sm font-semibold text-slate-900">{document?.title || currentActivity?.title || 'Untitled invoice'}</p>
                                      <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${getAuditTone(audit.status)}`}>
                                        {formatAuditStatus(audit.status)}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {formatAssignmentSource(audit.assignmentSource)} | {currentActivity?.consumerCustomId || audit.consumerUserId}
                                    </p>
                                    <p className="mt-2 text-xs text-slate-400">{formatDate(audit.createdAt)} | {formatRelativeTime(audit.createdAt)}</p>
                                  </div>
                                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="dashboard-card overflow-hidden">
                      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Merchant activity</p>
                          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Latest locker assignments</h2>
                        </div>
                        <button
                          onClick={loadWorkspace}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                          aria-label="Refresh merchant activity"
                        >
                          <RefreshCw className={`h-4 w-4 ${workspaceLoading ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                      <div className="max-h-[560px] overflow-y-auto">
                        {recentActivity.length === 0 ? (
                          <div className="p-5">
                            <EmptyPanel
                              title="No merchant activity yet"
                              description="As soon as you upload or assign a bill, the latest merchant activity will appear here with the consumer and invoice context."
                            />
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-100">
                            {recentActivity.slice(0, 12).map((activity) => (
                              <button
                                key={activity.activityId}
                                onClick={() => router.push(`/document/${activity.documentId}`)}
                                className="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
                              >
                                <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                                  <FileText className="h-4 w-4" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="truncate text-sm font-semibold text-slate-900">{activity.title || 'Untitled invoice'}</p>
                                    <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">{activity.action || 'updated'}</span>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-500">{activity.vendor || 'Unknown vendor'} | {activity.consumerName || activity.consumerCustomId || activity.consumerUserId || 'Consumer not captured'}</p>
                                  <p className="mt-2 text-xs text-slate-400">{formatDate(activity.createdAt)} | {formatRelativeTime(activity.createdAt)}</p>
                                </div>
                                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-80 max-w-[88vw] flex-col bg-[linear-gradient(180deg,#0f1f52_0%,#0a1538_45%,#08112f_100%)] text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
              <div>
                <p className="text-lg font-semibold">Merchant menu</p>
                <p className="text-xs uppercase tracking-[0.22em] text-blue-100/45">SafeBill</p>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5"
                aria-label="Close merchant menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 px-4 py-6">
              <div className="space-y-1.5">
                <SidebarNavItem icon={LayoutDashboard} label="Assignment Console" active={activeNav === 'workspace'} onClick={navigateToWorkspace} />
                <SidebarNavItem icon={Clock3} label="Merchant Activity" active={activeNav === 'activity'} onClick={navigateToActivity} />
                <SidebarNavItem icon={Settings} label="Settings" active={false} onClick={() => { setSidebarOpen(false); router.push('/settings') }} />
              </div>
            </div>
            <div className="border-t border-white/10 p-4">
              <button
                onClick={handleLogout}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
