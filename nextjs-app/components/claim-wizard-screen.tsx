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
        params: { userId: user?.userId || 'anonymous', limit: 200 },
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
      <div className="min-h-screen bg-base-200 flex items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary"></span>
      </div>
    )
  }

  if (documents.length === 0) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center">
        <div className="text-center">
          <p className="text-base-content/60">Add a document first.</p>
        </div>
      </div>
    )
  }

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
          <span className="font-bold text-lg">Claim Wizard</span>
        </div>
        <div className="navbar-end"></div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div data-gsap="card" className="card bg-base-100 border border-base-300 shadow-sm">
          <div className="card-body gap-6">
            {/* Document Select */}
            <div data-gsap="card" className="form-control">
              <label className="label">
                <span className="label-text font-medium">Document</span>
              </label>
              <select
                value={selectedDoc?.docId || ''}
                onChange={(e) => {
                  const doc = documents.find((d) => d.docId === e.target.value)
                  setSelectedDoc(doc || null)
                  setDraft(null)
                }}
                className="select select-bordered w-full"
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
                <span className="label-text font-medium">Issue description</span>
              </label>
              <textarea
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                placeholder="Describe the defect or support experience"
                rows={4}
                className="textarea textarea-bordered w-full"
              />
            </div>

            {/* Generate Button */}
            <button onClick={generateDraft} data-gsap-hover="lift" className="btn btn-primary gap-2">
              <Sparkles className="w-5 h-5" />
              Generate claim letter
            </button>

            {/* Draft Output */}
            {draft && (
              <div data-gsap="panel">
                <h3 className="text-lg font-bold mb-3">Draft email</h3>
                <div className="card bg-base-200 border border-base-300">
                  <div className="card-body">
                    <pre className="text-sm whitespace-pre-wrap font-sans">{draft}</pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
