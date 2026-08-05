import { useEffect, useRef } from 'react'
import { getToken } from '@/lib/api'

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000
export const SESSION_ACTIVITY_KEY = 'rubber_last_activity_at'

export function markSessionActivity() {
  if (typeof window === 'undefined') return
  localStorage.setItem(SESSION_ACTIVITY_KEY, String(Date.now()))
}

export function clearSessionActivity() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(SESSION_ACTIVITY_KEY)
}

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'wheel'] as const

export function useIdleTimeout(onTimeout: () => void) {
  const onTimeoutRef = useRef(onTimeout)

  useEffect(() => {
    onTimeoutRef.current = onTimeout
  }, [onTimeout])

  useEffect(() => {
    if (!getToken()) return

    const storedActivityAt = Number(localStorage.getItem(SESSION_ACTIVITY_KEY))
    const initialActivityAt = Number.isFinite(storedActivityAt) && storedActivityAt > 0
      ? storedActivityAt
      : Date.now()
    let lastActivityAt = initialActivityAt
    let lastPersistedActivityAt = initialActivityAt
    let timer: ReturnType<typeof setTimeout> | null = null
    let timedOut = false

    const expireIfIdle = () => {
      const idleFor = Date.now() - lastActivityAt
      if (idleFor >= IDLE_TIMEOUT_MS) {
        if (!timedOut) {
          timedOut = true
          onTimeoutRef.current()
        }
        return
      }
      timer = setTimeout(expireIfIdle, IDLE_TIMEOUT_MS - idleFor)
    }

    const scheduleExpiry = () => {
      if (timer) window.clearTimeout(timer)
      timer = setTimeout(expireIfIdle, Math.max(0, IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt)))
    }

    const recordActivity = () => {
      if (timedOut) return
      const now = Date.now()
      lastActivityAt = now
      if (now - lastPersistedActivityAt >= 1000) {
        lastPersistedActivityAt = now
        localStorage.setItem(SESSION_ACTIVITY_KEY, String(now))
      }
      scheduleExpiry()
    }

    const syncActivity = (event: StorageEvent) => {
      if (event.key === 'rubber_token' && !event.newValue) {
        if (!timedOut) {
          timedOut = true
          onTimeoutRef.current()
        }
        return
      }
      if (event.key !== SESSION_ACTIVITY_KEY || !event.newValue) return
      const activityAt = Number(event.newValue)
      if (!Number.isFinite(activityAt) || activityAt <= lastActivityAt) return
      lastActivityAt = activityAt
      lastPersistedActivityAt = activityAt
      scheduleExpiry()
    }

    if (Date.now() - lastActivityAt >= IDLE_TIMEOUT_MS) {
      timedOut = true
      onTimeoutRef.current()
      return
    }

    localStorage.setItem(SESSION_ACTIVITY_KEY, String(lastActivityAt))
    scheduleExpiry()
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, recordActivity, { passive: true }))
    window.addEventListener('storage', syncActivity)

    return () => {
      if (timer) window.clearTimeout(timer)
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, recordActivity))
      window.removeEventListener('storage', syncActivity)
    }
  }, [])
}
