'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, BellOff, Timer, Bell } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { useAuthStore } from '@/lib/store/auth-store'
import { useGsapReveal } from '@/lib/gsap-helpers'
import type { InAppNotification, Reminder } from '@/lib/types'
import { format } from 'date-fns'

export function RemindersScreen() {
  const router = useRouter()
  const { user } = useAuthStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [notifications, setNotifications] = useState<InAppNotification[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadReminders = useCallback(async () => {
    if (!user?.userId) {
      setReminders([])
      setNotifications([])
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      const response = await apiClient.get<{ reminders: Reminder[] }>('/reminders', {
        params: { userId: user.userId, daysAhead: 120, limit: 200 },
      })
      const notificationsResponse = await apiClient.get<{ notifications: InAppNotification[] }>('/notifications', {
        params: { userId: user.userId, includeRead: true, limit: 200 },
      })
      setReminders(response.reminders || [])
      setNotifications(notificationsResponse.notifications || [])
    } catch (error) {
      console.error('Failed to load reminders:', error)
    } finally {
      setIsLoading(false)
    }
  }, [user?.userId])

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      if (!user?.userId) return
      try {
        await apiClient.post(`/notifications/${notificationId}/read`, { userId: user.userId })
        setNotifications((prev) =>
          prev.map((item) =>
            item.notificationId === notificationId ? { ...item, status: 'read' } : item
          )
        )
      } catch (error) {
        console.error('Failed to mark notification as read:', error)
      }
    },
    [user?.userId]
  )

  useEffect(() => { loadReminders() }, [loadReminders])
  useGsapReveal(rootRef, [isLoading, reminders.length, notifications.length])

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
          <span className="font-bold text-lg text-slate-900">Reminders</span>
        </div>
        <div className="flex-none w-10"></div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-4xl">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <span className="loading loading-spinner loading-lg text-primary"></span>
          </div>
        ) : reminders.length === 0 && notifications.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-blue-50 border border-blue-100 mb-4">
              <BellOff className="w-10 h-10 text-blue-300" />
            </div>
            <h2 className="text-xl font-bold mb-2 text-slate-900">No reminders yet</h2>
            <p className="text-slate-500 text-sm max-w-md mx-auto leading-relaxed">
              Schedule reminders from a document to receive push + local alerts before warranties expire.
            </p>
          </div>
        ) : (
          <>
            {/* Notifications */}
            {notifications.length > 0 && (
              <div data-gsap="card" className="mb-6 dashboard-card p-5">
                <h2 className="text-sm font-bold mb-3 text-slate-900">Consumer Alerts</h2>
                <div className="space-y-2">
                  {notifications.map((item) => (
                    <div key={item.notificationId} data-gsap="list-item" className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                      <div className="flex items-center gap-3">
                        <div className="bg-blue-50 p-2 rounded-xl border border-blue-100">
                          <Bell className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-slate-900">{item.title}</p>
                          <p className="text-xs text-slate-500">{item.message}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {format(new Date(item.triggerAt), 'MMM d, yyyy h:mm a')}
                          </p>
                        </div>
                        {item.status === 'unread' ? (
                          <button
                            onClick={() => markNotificationRead(item.notificationId)}
                            data-gsap-hover="lift"
                            className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                          >
                            Mark read
                          </button>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500 font-medium">read</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reminders */}
            {reminders.length > 0 && (
              <div data-gsap="panel" className="dashboard-card p-5">
                <h2 className="text-sm font-bold mb-3 text-slate-900">Warranty Reminders</h2>
                <div className="space-y-2">
                  {reminders.map((reminder) => (
                    <div key={reminder.reminderId} data-gsap="list-item" className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                      <div className="flex items-center gap-3">
                        <div className="bg-blue-50 p-2 rounded-xl border border-blue-100">
                          {reminder.triggerType === 'expiry' ? (
                            <Timer className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Bell className="w-4 h-4 text-blue-600" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-slate-900">{reminder.title}</p>
                          <p className="text-xs text-slate-400">
                            {format(new Date(reminder.triggerAt), 'MMM d, yyyy h:mm a')}
                          </p>
                        </div>
                        <span className="rounded-full bg-blue-50 border border-blue-100 px-2.5 py-1 text-xs text-blue-600 font-medium">{reminder.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
