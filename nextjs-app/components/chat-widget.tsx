'use client'

import { useState, useEffect, useRef } from 'react'
import { MessageSquare, X, Send, Bot, User } from 'lucide-react'
import { getCurrentLocation } from '@/lib/location'
import { useAuthStore } from '@/lib/store/auth-store'

interface ChatMessage {
    id: string
    role: 'user' | 'assistant'
    content: string
}

export function ChatWidget() {
    const { user } = useAuthStore()
    const [isOpen, setIsOpen] = useState(false)
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            id: '1',
            role: 'assistant',
            content: 'Hi! Need help with a warranty? Ask me anything.',
        },
    ])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

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
            console.error('Chat widget error:', error)
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
        <>
            {/* Chat Window */}
            {isOpen && (
                <div className="fixed bottom-20 right-4 z-50 w-[350px] max-w-[calc(100vw-2rem)]">
                    <div className="card bg-base-100 shadow-2xl border border-base-300 overflow-hidden">
                        {/* Header */}
                        <div className="bg-primary text-primary-content p-3 flex items-center gap-3">
                            <div className="avatar placeholder">
                                <div className="bg-primary-content/20 rounded-full w-9">
                                    <Bot className="w-5 h-5" />
                                </div>
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-sm">Warranty Assistant</h3>
                                <p className="text-xs opacity-70">Ask anything</p>
                            </div>
                            <button onClick={() => setIsOpen(false)} className="btn btn-ghost btn-sm btn-circle text-primary-content">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Messages */}
                        <div className="h-[300px] overflow-y-auto p-3 space-y-1 bg-base-200/50">
                            {messages.map((message) => (
                                <div
                                    key={message.id}
                                    className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'}`}
                                >
                                    <div className="chat-image avatar placeholder">
                                        <div className={`w-7 rounded-full ${message.role === 'user' ? 'bg-primary/10' : 'bg-base-300'}`}>
                                            {message.role === 'user' ? (
                                                <User className="w-3.5 h-3.5 text-primary" />
                                            ) : (
                                                <Bot className="w-3.5 h-3.5 text-base-content/60" />
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
                                        <div className="w-7 rounded-full bg-base-300">
                                            <Bot className="w-3.5 h-3.5 text-base-content/60" />
                                        </div>
                                    </div>
                                    <div className="chat-bubble bg-base-100 text-base-content">
                                        <span className="loading loading-dots loading-xs"></span>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input */}
                        <form onSubmit={handleSend} className="p-3 border-t border-base-300">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder="Type a message..."
                                    className="input input-bordered input-sm flex-1"
                                />
                                <button
                                    type="submit"
                                    disabled={!input.trim() || isLoading}
                                    className="btn btn-primary btn-sm btn-circle"
                                >
                                    <Send className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* FAB */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="fixed bottom-4 right-4 z-50 btn btn-primary btn-circle btn-lg shadow-lg"
            >
                {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
            </button>
        </>
    )
}
