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
    <div ref={rootRef} className="min-h-screen bg-base-200 flex flex-col">
      {/* Navbar */}
      <div data-gsap="hero" className="navbar bg-primary text-primary-content shadow-lg sticky top-0 z-50">
        <div className="navbar-start">
          <button onClick={() => router.back()} className="btn btn-ghost btn-circle text-primary-content">
            <ArrowLeft className="w-5 h-5" />
          </button>
        </div>
        <div className="navbar-center gap-2">
          <div className="avatar placeholder">
            <div className="bg-primary-content/20 rounded-full w-9">
              <Bot className="w-5 h-5" />
            </div>
          </div>
          <div>
            <p className="font-bold text-sm">Warranty Assistant</p>
            <p className="text-xs opacity-70">Powered by AI</p>
          </div>
        </div>
        <div className="navbar-end"></div>
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
              <div className={`w-8 rounded-full ${message.role === 'user' ? 'bg-primary/10' : 'bg-base-300'}`}>
                {message.role === 'user' ? (
                  <User className="w-4 h-4 text-primary" />
                ) : (
                  <Bot className="w-4 h-4 text-base-content/60" />
                )}
              </div>
            </div>
            <div className={`chat-bubble text-sm ${message.role === 'user'
                ? 'chat-bubble-primary'
                : 'bg-base-100 text-base-content'
              }`}>
              {message.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="chat chat-start">
            <div className="chat-image avatar placeholder">
              <div className="w-8 rounded-full bg-base-300">
                <Bot className="w-4 h-4 text-base-content/60" />
              </div>
            </div>
            <div className="chat-bubble bg-base-100 text-base-content">
              <span className="loading loading-dots loading-sm"></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} data-gsap="panel" className="p-4 bg-base-100 border-t border-base-300">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about warranties, claims..."
            className="input input-bordered flex-1"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            data-gsap-hover="lift"
            className="btn btn-primary btn-circle"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  )
}
