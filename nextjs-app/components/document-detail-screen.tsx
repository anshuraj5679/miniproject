'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ShieldCheck,
  Calendar,
  DollarSign,
  Hash,
  Store,
  Package,
  Send,
  Bot,
  User,
  Trash2,
  MessageSquare,
  CalendarPlus,
  Download,
  BadgeCheck,
  AlertTriangle,
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { useGsapReveal } from '@/lib/gsap-helpers'
import { getCurrentLocation } from '@/lib/location'
import { useAuthStore } from '@/lib/store/auth-store'
import type { Document } from '@/lib/types'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface CalendarLinksResponse {
  docId: string
  googleCalendarUrl: string
  icsDownloadUrl: string
}

interface ClaimPacketResponse {
  docId: string
  generatedAt: string
  facts: Record<string, unknown>
  timeline: string[]
  issueSummaryTemplate: string
  emailTemplate: string
  attachmentChecklist: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const ACTION_NOW_DAYS = 7
const COMING_UP_DAYS = 30

type DeadlineLevel = 'action_now' | 'coming_up' | 'on_track' | 'expired'

interface DeadlineMeta {
  level: DeadlineLevel
  label: string
  hint: string
  countdown: string
  badgeClass: string
  textClass: string
}

function formatCountdown(msLeft: number): string {
  const absolute = Math.abs(msLeft)
  const days = Math.floor(absolute / DAY_MS)
  const hours = Math.floor((absolute % DAY_MS) / HOUR_MS)
  const minutes = Math.floor((absolute % HOUR_MS) / MINUTE_MS)

  if (msLeft <= 0) {
    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    return `${Math.max(minutes, 1)}m ago`
  }

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${Math.max(minutes, 1)}m`
}

function getDeadlineMeta(warrantyEnd: string | undefined, nowMs: number): DeadlineMeta | null {
  if (!warrantyEnd) return null
  const endMs = Date.parse(warrantyEnd)
  if (!Number.isFinite(endMs)) return null

  const msLeft = endMs - nowMs
  const daysLeft = Math.ceil(msLeft / DAY_MS)
  const countdown = formatCountdown(msLeft)

  if (daysLeft <= 0) {
    return { level: 'expired', label: 'Expired', hint: 'Warranty period ended', countdown, badgeClass: 'badge-ghost', textClass: 'text-base-content/50' }
  }
  if (daysLeft <= ACTION_NOW_DAYS) {
    return { level: 'action_now', label: 'Action required', hint: 'Act now', countdown, badgeClass: 'badge-error', textClass: 'text-error' }
  }
  if (daysLeft <= COMING_UP_DAYS) {
    return { level: 'coming_up', label: 'Coming up', hint: 'Plan this week', countdown, badgeClass: 'badge-warning', textClass: 'text-warning' }
  }
  return { level: 'on_track', label: 'On track', hint: 'No rush yet', countdown, badgeClass: 'badge-success', textClass: 'text-success' }
}

function complianceTone(status?: string) {
  if (status === 'pass') return { alertClass: 'alert-success', label: 'Compliant' }
  if (status === 'risk') return { alertClass: 'alert-error', label: 'Attention Needed' }
  return { alertClass: 'alert-warning', label: 'Review Suggested' }
}

export function DocumentDetailScreen({ docId }: { docId: string }) {
  const router = useRouter()
  const { user } = useAuthStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const [document, setDocument] = useState<Document | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [calendarLinks, setCalendarLinks] = useState<CalendarLinksResponse | null>(null)
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [claimPacket, setClaimPacket] = useState<ClaimPacketResponse | null>(null)
  const [claimPacketLoading, setClaimPacketLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const loadDocument = useCallback(async () => {
    try {
      setIsLoading(true)
      const payload = await apiClient.get<Document>(`/documents/${docId}`, {
        params: { userId: user?.userId || 'anonymous' },
      })
      setDocument(payload)
    } catch (error) {
      console.error('Failed to load document:', error)
      setDocument(null)
    } finally {
      setIsLoading(false)
    }
  }, [docId, user?.userId])

  useEffect(() => { loadDocument() }, [loadDocument])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => {
    const timerId = window.setInterval(() => setNowMs(Date.now()), 60000)
    return () => window.clearInterval(timerId)
  }, [])
  useGsapReveal(rootRef, [isLoading, Boolean(document), showChat, messages.length])

  const handleDelete = async () => {
    if (!document || !window.confirm('Are you sure you want to delete this warranty?')) return
    setIsDeleting(true)
    try {
      await apiClient.delete(`/documents/${docId}`, { params: { userId: user?.userId || 'anonymous' } })
      router.push('/locker')
    } catch (error) {
      console.error('Delete failed:', error)
      alert('Failed to delete. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  const loadCalendarLinks = useCallback(async () => {
    if (!document) return null
    try {
      setCalendarLoading(true)
      const payload = await apiClient.get<CalendarLinksResponse>(`/documents/${docId}/calendar-links`, {
        params: { userId: user?.userId || 'anonymous' },
      })
      setCalendarLinks(payload)
      return payload
    } catch (error) {
      console.error('Failed to load calendar links:', error)
      return null
    } finally {
      setCalendarLoading(false)
    }
  }, [docId, document, user?.userId])

  const handleOpenGoogleCalendar = async () => {
    const payload = calendarLinks || (await loadCalendarLinks())
    if (!payload?.googleCalendarUrl) { alert('Warranty date is not available for calendar sync yet.'); return }
    window.open(payload.googleCalendarUrl, '_blank', 'noopener,noreferrer')
  }

  const handleDownloadIcs = async () => {
    const payload = calendarLinks || (await loadCalendarLinks())
    if (!payload?.icsDownloadUrl) { alert('Warranty date is not available for calendar sync yet.'); return }
    const query = new URLSearchParams({ userId: user?.userId || 'anonymous' }).toString()
    const target = `${payload.icsDownloadUrl}${payload.icsDownloadUrl.includes('?') ? '&' : '?'}${query}`
    window.open(target, '_blank', 'noopener,noreferrer')
  }

  const handleGenerateClaimPacket = async () => {
    try {
      setClaimPacketLoading(true)
      const payload = await apiClient.get<ClaimPacketResponse>(`/documents/${docId}/claim-packet`, {
        params: { userId: user?.userId || 'anonymous' },
      })
      setClaimPacket(payload)
    } catch (error) {
      console.error('Failed to generate claim packet:', error)
      alert('Unable to generate claim packet right now.')
    } finally {
      setClaimPacketLoading(false)
    }
  }

  const handleAskAI = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!chatInput.trim() || isChatLoading || !document) return

    const item = document.items[0]
    const userMessage: ChatMessage = { id: Date.now().toString(), role: 'user', content: chatInput.trim() }
    setMessages((prev) => [...prev, userMessage])
    setChatInput('')
    setIsChatLoading(true)

    try {
      const location = await getCurrentLocation()
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          userId: user?.userId,
          location: location || undefined,
          docContext: { invoiceNumber: item?.invoiceNo, store: document.sellerName },
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const errorMessage = typeof data?.error === 'string' ? data.error : 'Service-center lookup failed.'
        throw new Error(errorMessage)
      }
      setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: data.answer || 'No response available.' }])
    } catch (error) {
      const errorMessage = error instanceof Error && error.message ? error.message : 'Sorry, I encountered an error.'
      setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: errorMessage }])
    } finally {
      setIsChatLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary"></span>
      </div>
    )
  }

  if (!document) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center">
        <div className="text-center">
          <p className="text-base-content/60 mb-4">Document not found</p>
          <button onClick={() => router.push('/locker')} className="btn btn-primary">Back to Locker</button>
        </div>
      </div>
    )
  }

  const item = document.items[0]
  const deadline = getDeadlineMeta(item?.warrantyEnd, nowMs)
  const compliance = document.compliance
  const complianceUi = complianceTone(compliance?.status)

  return (
    <div ref={rootRef} className="min-h-screen bg-base-200">
      {/* Navbar */}
      <div data-gsap="hero" className="navbar bg-base-100 border-b border-base-300 sticky top-0 z-50">
        <div className="navbar-start">
          <button onClick={() => router.back()} className="btn btn-ghost btn-sm gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </div>
        <div className="navbar-end">
          <button onClick={handleDelete} disabled={isDeleting} className="btn btn-ghost btn-sm text-error gap-1">
            <Trash2 className="w-4 h-4" />
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-3xl">
        {/* Main Card */}
        <div data-gsap="card" className="card bg-base-100 border border-base-300 shadow-lg">
          <div className="card-body gap-6">
            {/* Title & Badge */}
            <div className="flex items-start justify-between gap-4">
              <h1 className="card-title text-2xl">{item?.productName || document.title || 'Untitled'}</h1>
              {deadline ? (
                <span className={`badge ${deadline.badgeClass}`}>{deadline.label}</span>
              ) : (
                <span className="badge badge-primary badge-outline">Saved</span>
              )}
            </div>

            {/* Deadline Countdown */}
            {deadline && (
              <div className="alert shadow-sm">
                <div>
                  <p className={`text-sm font-semibold ${deadline.textClass}`}>
                    {deadline.level === 'expired' ? `Ended ${deadline.countdown}` : `${deadline.countdown} left`}
                  </p>
                  <p className="text-xs text-base-content/50">{deadline.hint}</p>
                </div>
              </div>
            )}

            {/* Review Required */}
            {document.reviewRequired && (
              <div className="alert alert-warning shadow-sm">
                <AlertTriangle className="w-4 h-4" />
                <div>
                  <p className="text-sm font-semibold">Verification recommended</p>
                  <p className="text-xs">Low confidence in: {(document.lowConfidenceFields || []).join(', ') || 'invoice fields'}</p>
                </div>
              </div>
            )}

            {/* Claim Readiness */}
            {document.claimReadiness && (
              <div className="flex items-center justify-between p-4 bg-base-200 rounded-xl">
                <div>
                  <p className="text-sm font-semibold">Claim Readiness</p>
                  <p className="text-xs text-base-content/50 mt-1">{document.claimReadiness.summary}</p>
                </div>
                <div className="radial-progress text-primary text-sm" style={{ '--value': Math.round(document.claimReadiness.score * 100), '--size': '3.5rem' } as React.CSSProperties} role="progressbar">
                  {Math.round(document.claimReadiness.score * 100)}%
                </div>
              </div>
            )}

            {/* Compliance */}
            {compliance && (
              <div className={`alert ${complianceUi.alertClass} shadow-sm`}>
                {compliance.status === 'pass' ? <BadgeCheck className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                <div className="flex-1">
                  <p className="text-sm font-semibold">GST + e-Invoice: {complianceUi.label} ({compliance.score}/100)</p>
                  <p className="text-xs mt-1">GSTIN: {compliance.gstin?.value || 'Not detected'} {compliance.gstin?.valid_checksum ? '(validated)' : '(verify manually)'}</p>
                  {compliance.alerts?.length ? (
                    <p className="text-xs mt-1">Alerts: {compliance.alerts.slice(0, 2).map((a) => a.message).join(' | ')}</p>
                  ) : null}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div data-gsap="card" className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <button onClick={handleOpenGoogleCalendar} disabled={calendarLoading} data-gsap-hover="lift" className="btn btn-outline btn-sm gap-2">
                <CalendarPlus className="w-4 h-4" /> Calendar
              </button>
              <button onClick={handleDownloadIcs} disabled={calendarLoading} data-gsap-hover="lift" className="btn btn-outline btn-sm gap-2">
                <Download className="w-4 h-4" /> ICS Export
              </button>
              <button onClick={handleGenerateClaimPacket} disabled={claimPacketLoading} data-gsap-hover="lift" className="btn btn-primary btn-sm gap-2">
                {claimPacketLoading ? <span className="loading loading-spinner loading-xs"></span> : null}
                Claim Packet
              </button>
            </div>

            {/* Claim Packet Result */}
            {claimPacket && (
              <div className="alert alert-info shadow-sm">
                <div>
                  <p className="text-sm font-semibold">Claim Packet Ready</p>
                  <p className="text-xs">Generated at {new Date(claimPacket.generatedAt).toLocaleString()}</p>
                  <p className="text-xs mt-1">Checklist: {claimPacket.attachmentChecklist.slice(0, 3).join(' | ')}</p>
                </div>
              </div>
            )}

            {/* Product Info */}
            <div data-gsap="card">
              <h2 className="text-lg font-bold mb-4">Product Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InfoItem icon={Package} label="Product Name" value={item?.productName || 'N/A'} />
                <InfoItem icon={Package} label="Brand/Model" value={item?.model || 'N/A'} />
                <InfoItem icon={Hash} label="Category" value={document.category || 'Others'} />
                <InfoItem icon={Hash} label="Serial Number" value={item?.serialNumber || 'N/A'} />
                <InfoItem icon={Hash} label="Invoice No" value={item?.invoiceNo || 'N/A'} />
                <InfoItem icon={Store} label="Store / Seller" value={document.sellerName || 'N/A'} />
              </div>
            </div>

            <div className="divider"></div>

            {/* Purchase Info */}
            <div data-gsap="card">
              <h2 className="text-lg font-bold mb-4">Purchase Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InfoItem icon={Calendar} label="Purchase Date" value={item?.purchaseDate || 'N/A'} />
                <InfoItem icon={DollarSign} label="Amount" value={item?.purchasePrice != null ? `Rs ${item.purchasePrice}` : 'N/A'} />
              </div>
            </div>

            <div className="divider"></div>

            {/* Warranty Info */}
            <div data-gsap="panel">
              <h2 className="text-lg font-bold mb-4">Warranty Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InfoItem icon={ShieldCheck} label="Warranty Period" value={item?.warrantyMonths ? `${item.warrantyMonths} months` : 'N/A'} />
                <InfoItem icon={Calendar} label="Warranty Start" value={item?.warrantyStart || 'N/A'} />
                <InfoItem icon={Calendar} label="Warranty End" value={item?.warrantyEnd || 'N/A'} />
                <InfoItem icon={ShieldCheck} label="Deadline Status" value={deadline?.label || 'N/A'} />
                <InfoItem icon={ShieldCheck} label="Time Remaining" value={deadline ? (deadline.level === 'expired' ? `Ended ${deadline.countdown}` : `${deadline.countdown} left`) : 'N/A'} />
              </div>
            </div>
          </div>
        </div>

        {/* AI Chat Section */}
        <div data-gsap="panel" className="mt-6">
          <button
            onClick={() => {
              setShowChat(!showChat)
              if (!showChat && messages.length === 0) {
                setMessages([{ id: '1', role: 'assistant', content: `Hi! I can answer questions about your ${item?.productName || 'warranty'}.` }])
              }
            }}
            data-gsap-hover="lift"
            className="btn btn-primary w-full gap-2 shadow-lg"
          >
            <MessageSquare className="w-5 h-5" />
            {showChat ? 'Hide AI Chat' : 'Ask AI About This Warranty'}
          </button>

          {showChat && (
            <div className="card bg-base-100 border border-base-300 shadow-lg mt-4 overflow-hidden">
              {/* Chat Header */}
              <div className="bg-primary text-primary-content p-3 flex items-center gap-3">
                <div className="avatar placeholder">
                  <div className="bg-primary-content/20 rounded-full w-9">
                    <Bot className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-sm">Warranty Assistant</h3>
                  <p className="text-xs opacity-70">Grounded on your documents</p>
                </div>
              </div>

              {/* Messages */}
              <div className="h-[300px] overflow-y-auto p-4 space-y-1">
                {messages.map((message) => (
                  <div key={message.id} className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'}`}>
                    <div className="chat-image avatar placeholder">
                      <div className={`w-8 rounded-full ${message.role === 'user' ? 'bg-primary/10' : 'bg-base-300'}`}>
                        {message.role === 'user' ? <User className="w-4 h-4 text-primary" /> : <Bot className="w-4 h-4 text-base-content/60" />}
                      </div>
                    </div>
                    <div className={`chat-bubble text-sm ${message.role === 'user' ? 'chat-bubble-primary' : 'bg-base-200 text-base-content'}`}>
                      {message.content}
                    </div>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="chat chat-start">
                    <div className="chat-image avatar placeholder">
                      <div className="w-8 rounded-full bg-base-300"><Bot className="w-4 h-4 text-base-content/60" /></div>
                    </div>
                    <div className="chat-bubble bg-base-200 text-base-content">
                      <span className="loading loading-dots loading-sm"></span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <form onSubmit={handleAskAI} className="p-3 border-t border-base-300">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about this warranty..."
                    className="input input-bordered input-sm flex-1"
                  />
                  <button type="submit" disabled={!chatInput.trim() || isChatLoading} className="btn btn-primary btn-sm btn-circle">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoItem({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  const isAvailable = value !== 'N/A'
  return (
    <div data-gsap="list-item" className="flex items-start gap-3">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isAvailable ? 'text-primary' : 'text-base-content/30'}`} />
      <div>
        <p className="text-xs text-base-content/50 font-medium">{label}</p>
        <p className={`text-sm font-semibold ${isAvailable ? '' : 'text-base-content/30 italic'}`}>{value}</p>
      </div>
    </div>
  )
}
