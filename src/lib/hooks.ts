import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toast.tsx'
import { refreshAll } from './live.ts'
import { supabase } from './supabase.ts'

/** The current time, updated on an interval. For countdowns. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * How far this device's clock is from the database's, in milliseconds. Add it
 * to Date.now() to get the database's time. Phones can be off by seconds,
 * which matters when everyone is watching the same pick clock.
 */
export function useServerOffset() {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    let cancelled = false
    const measure = async () => {
      const sent = Date.now()
      const { data, error } = await supabase.rpc('server_time')
      const received = Date.now()
      if (cancelled || error || !data) return
      // Assume the answer was produced halfway through the round trip.
      setOffset(new Date(data).getTime() - (sent + received) / 2)
    }
    void measure()
    return () => {
      cancelled = true
    }
  }, [])

  return offset
}

/**
 * Runs an action, shows what happened, and reports whether it's in progress.
 * Returns true if the action succeeded.
 */
export function useAction() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const running = useRef(false)

  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string): Promise<boolean> => {
      // A double tap must not send the same move twice.
      if (running.current) return false
      running.current = true
      setBusy(true)
      try {
        await action()
        if (success) toast.good(success)
        return true
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        // Whether it worked or was refused, what's on screen may be out of date.
        refreshAll()
        running.current = false
        setBusy(false)
      }
    },
    [toast],
  )

  return { run, busy }
}

/** A value that follows its input after a pause, for search-as-you-type. */
export function useDebounced<T>(value: T, delayMs = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
