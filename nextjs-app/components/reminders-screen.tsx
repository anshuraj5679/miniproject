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
    <div ref={rootRef} className="min-h-screen bg-base-200">
      {/* Navbar */}
      <div data-gsap="hero" className="navbar bg-base-100 border-b border-base-300 sticky top-0 z-50">
        <div className="navbar-start">
          <button onClick={() => router.back()} className="btn btn-ghost btn-circle">
            <ArrowLeft className="w-5 h-5" />
          </button>
        </div>
        <div className="navbar-center">
          <span className="font-bold text-lg">Reminders</span>
        </div>
        <div className="navbar-end"></div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-4xl">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <span className="loading loading-spinner loading-lg text-primary"></span>
          </div>
        ) : reminders.length === 0 && notifications.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-base-300 mb-4">
              <BellOff className="w-10 h-10 text-base-content/30" />
            </div>
            <h2 className="text-xl font-bold mb-2">No reminders yet</h2>
            <p className="text-base-content/50 text-sm max-w-md mx-auto">
              Schedule reminders from a document to receive push + local alerts before warranties expire.
            </p>
          </div>
        ) : (
          <>
            {/* Notifications */}
            {notifications.length > 0 && (
            <div data-gsap="card" className="mb-6">
              <h2 className="text-sm font-bold mb-3">Consumer Alerts</h2>
              <div className="space-y-2">
                {notifications.map((item) => (
                    <div key={item.notificationId} data-gsap="list-item" className="card card-compact bg-base-100 border border-base-300 shadow-sm">
                      <div className="card-body flex-row items-center gap-3">
                        <div className="bg-primary/10 p-2 rounded-lg">
                          <Bell className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm">{item.title}</p>
                          <p className="text-xs text-base-content/50">{item.message}</p>
                          <p className="text-xs text-base-content/40 mt-1">
                            {format(new Date(item.triggerAt), 'MMM d, yyyy h:mm a')}
                          </p>
                        </div>
                        {item.status === 'unread' ? (
                          <button
                            onClick={() => markNotificationRead(item.notificationId)}
                            data-gsap-hover="lift"
                            className="btn btn-primary btn-xs"
                          >
                            Mark read
                          </button>
                        ) : (
                          <span className="badge badge-ghost badge-sm">read</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reminders */}
            {reminders.length > 0 && (
              <div data-gsap="panel">
                <h2 className="text-sm font-bold mb-3">Warranty Reminders</h2>
                <div className="space-y-2">
                  {reminders.map((reminder) => (
                    <div key={reminder.reminderId} data-gsap="list-item" className="card card-compact bg-base-100 border border-base-300 shadow-sm">
                      <div className="card-body flex-row items-center gap-3">
                        <div className="bg-primary/10 p-2 rounded-lg">
                          {reminder.triggerType === 'expiry' ? (
                            <Timer className="w-4 h-4 text-primary" />
                          ) : (
                            <Bell className="w-4 h-4 text-primary" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm">{reminder.title}</p>
                          <p className="text-xs text-base-content/50">
                            {format(new Date(reminder.triggerAt), 'MMM d, yyyy h:mm a')}
                          </p>
                        </div>
                        <span className="badge badge-ghost badge-sm">{reminder.status}</span>
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
