'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { useGsapReveal } from '@/lib/gsap-helpers'
import { useAuthStore } from '@/lib/store/auth-store'
import type { Document } from '@/lib/types'
import { format } from 'date-fns'

export function ClaimWizardScreen() {
  const router = useRouter()
  const { user } = useAuthStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null)
  const [issue, setIssue] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadDocuments = useCallback(async () => {
    try {
      setIsLoading(true)
      const response = await apiClient.get<{ documents: Document[] }>('/documents', {
        params: { userId: user?.userId || undefined, limit: 200 },
      })
      setDocuments(response.documents || [])
    } catch (error) {
      console.error('Failed to load documents:', error)
    } finally {
      setIsLoading(false)
    }
  }, [user?.userId])

  useEffect(() => { loadDocuments() }, [loadDocuments])
  useEffect(() => {
    if (documents.length > 0 && !selectedDoc) {
      setSelectedDoc(documents[0])
    }
  }, [documents, selectedDoc])
  useGsapReveal(rootRef, [isLoading, documents.length, Boolean(draft)])

  const generateDraft = () => {
    if (!selectedDoc) return
    const item = selectedDoc.items[0]
    if (!item) return
    const issueText = issue.trim() || 'Device stopped working unexpectedly'

    const letter = `
To,
${selectedDoc.sellerName || 'Seller'},

Subject: Warranty claim for ${item.productName || 'the product'} (Invoice ${item.invoiceNo || selectedDoc.docId})

I purchased the product on ${item.purchaseDate ? format(new Date(item.purchaseDate), 'MMMM d, yyyy') : 'unknown date'} and the warranty is valid through ${item.warrantyEnd ? format(new Date(item.warrantyEnd), 'MMMM d, yyyy') : 'unknown date'}.

Issue summary:
- ${issueText}

Request:
- Arrange inspection/service at the earliest.
- Provide written acknowledgement as per Consumer Protection Act 2019.

Attached: invoice, warranty card, images/videos evidencing the defect.

Regards,
SafeBill user
    `.trim()

    setDraft(letter)
  }

  if (isLoading) {
    return (
      <div className="dashboard-shell flex items-center justify-center">
        <span className="loading loading-spinner loading-lg text-blue-600"></span>
      </div>
    )
  }

  if (documents.length === 0) {
    return (
      <div className="dashboard-shell flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500">Add a document first.</p>
        </div>
      </div>
    )
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
          <span className="font-bold text-lg text-slate-900">Claim Wizard</span>
        </div>
        <div className="flex-none w-10"></div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div data-gsap="card" className="dashboard-card">
          <div className="p-6 space-y-6">
            {/* Document Select */}
            <div data-gsap="card" className="form-control">
              <label className="label">
                <span className="label-text font-medium text-slate-700">Document</span>
              </label>
              <select
                value={selectedDoc?.docId || ''}
                onChange={(e) => {
                  const doc = documents.find((d) => d.docId === e.target.value)
                  setSelectedDoc(doc || null)
                  setDraft(null)
                }}
                className="dashboard-input"
              >
                {documents.map((doc) => (
                  <option key={doc.docId} value={doc.docId}>
                    {doc.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Issue Description */}
            <div data-gsap="card" className="form-control">
              <label className="label">
                <span className="label-text font-medium text-slate-700">Issue description</span>
              </label>
              <textarea
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                placeholder="Describe the defect or support experience"
                rows={4}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-none"
              />
            </div>

            {/* Generate Button */}
            <button onClick={generateDraft} data-gsap-hover="lift" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-200/60 hover:from-blue-700 hover:to-blue-800 transition-all">
              <Sparkles className="w-5 h-5" />
              Generate claim letter
            </button>

            {/* Draft Output */}
            {draft && (
              <div data-gsap="panel">
                <h3 className="text-lg font-bold mb-3 text-slate-900">Draft email</h3>
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-5">
                  <pre className="text-sm whitespace-pre-wrap font-sans text-slate-700">{draft}</pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
