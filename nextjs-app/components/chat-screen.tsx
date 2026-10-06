'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Send, Bot, User } from 'lucide-react'
import { useGsapReveal } from '@/lib/gsap-helpers'
import { getCurrentLocation } from '@/lib/location'
import { useAuthStore } from '@/lib/store/auth-store'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function ChatScreen() {
  const router = useRouter()
  const { user } = useAuthStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hi! I\'m your warranty assistant. Ask me anything about your warranties, claims, or consumer rights.',
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])
  useGsapReveal(rootRef, [messages.length, isLoading])

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const location = await getCurrentLocation()
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          userId: user?.userId,
          location: location || undefined,
        }),
      })

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to get response.')
      }

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.answer || 'No response available.',
        },
      ])
    } catch (error) {
      console.error('Chat error:', error)
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: error instanceof Error ? error.message : 'Sorry, something went wrong.',
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div ref={rootRef} className="dashboard-shell flex flex-col">
      {/* Navbar */}
      <div data-gsap="hero" className="dashboard-navbar flex items-center px-4 py-3">
        <div className="flex-none">
          <button onClick={() => router.back()} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-blue-50 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center gap-2">
          <div className="w-9 h-9 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center">
            <Bot className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="font-bold text-sm text-slate-900">Warranty Assistant</p>
            <p className="text-xs text-slate-400">Powered by AI</p>
          </div>
        </div>
        <div className="flex-none w-10"></div>
      </div>

      {/* Messages */}
      <div data-gsap="card" className="flex-1 overflow-y-auto p-4 space-y-1">
        {messages.map((message) => (
          <div
            key={message.id}
            data-gsap="list-item"
            className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'}`}
          >
            <div className="chat-image avatar placeholder">
              <div className={`w-8 rounded-full ${message.role === 'user' ? 'bg-blue-100' : 'bg-slate-200'}`}>
                {message.role === 'user' ? (
                  <User className="w-4 h-4 text-blue-600" />
                ) : (
                  <Bot className="w-4 h-4 text-slate-500" />
                )}
              </div>
            </div>
            <div className={`chat-bubble text-sm ${message.role === 'user'
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-slate-200 text-slate-700'
              }`}>
              {message.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="chat chat-start">
            <div className="chat-image avatar placeholder">
              <div className="w-8 rounded-full bg-slate-200">
                <Bot className="w-4 h-4 text-slate-500" />
              </div>
            </div>
            <div className="chat-bubble bg-white border border-slate-200 text-slate-700">
              <span className="loading loading-dots loading-sm"></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} data-gsap="panel" className="p-4 bg-white/90 backdrop-blur-sm border-t border-slate-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about warranties, claims..."
            className="dashboard-input"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            data-gsap-hover="lift"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-200/60 hover:from-blue-700 hover:to-blue-800 disabled:cursor-not-allowed disabled:opacity-60 transition-all"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  )
}
