// Live updates. One Realtime subscription covers every table; screens say
// which tables they care about and refetch when one of them changes.

import type { RealtimeChannel } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { friendlyMessage, supabase } from './supabase.ts'

type Listener = (table: string) => void

const EVERYTHING = '*'
const listeners = new Set<Listener>()
let channel: RealtimeChannel | null = null

let connected = false
const connectionListeners = new Set<() => void>()

function setConnected(next: boolean) {
  if (connected === next) return
  connected = next
  for (const listener of connectionListeners) listener()
}

const announce = (table: string) => {
  for (const listener of listeners) listener(table)
}

/**
 * Refetches everything on screen. Called after the person using the app does
 * something, so they see the result at once instead of waiting for the change
 * to come back through Realtime.
 */
export const refreshAll = () => announce(EVERYTHING)

export function startRealtime() {
  if (channel) return
  channel = supabase
    .channel('league-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => announce(payload.table))
    .subscribe((status) => {
      setConnected(status === 'SUBSCRIBED')
      // Anything could have changed while we were disconnected.
      if (status === 'SUBSCRIBED') announce(EVERYTHING)
    })
}

export function stopRealtime() {
  if (!channel) return
  void supabase.removeChannel(channel)
  channel = null
  setConnected(false)
}

/** Whether live updates are flowing. Screens fall back to polling when not. */
export function useConnected() {
  return useSyncExternalStore(
    (onChange) => {
      connectionListeners.add(onChange)
      return () => connectionListeners.delete(onChange)
    },
    () => connected,
  )
}

export type Live<T> = {
  data: T | undefined
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
}

type Options = {
  /** Also refetch on a timer. Used where a missed update would really hurt. */
  pollMs?: number
  /** Skip fetching, e.g. until an id is known. */
  paused?: boolean
}

/**
 * Loads data and keeps it fresh: refetches when `deps` change, when any of
 * `tables` changes in the database, when the tab comes back into view, and
 * optionally on a timer.
 */
export function useLive<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
  tables: readonly string[],
  options: Options = {},
): Live<T> {
  const { pollMs, paused = false } = options
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({
    data: undefined,
    error: null,
    loading: !paused,
  })

  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const latest = useRef(0)
  const tableKey = tables.join(',')

  const refresh = useCallback(async () => {
    const request = ++latest.current
    try {
      const data = await fetcherRef.current()
      // A slower, older request must not overwrite a newer answer.
      if (request === latest.current) setState({ data, error: null, loading: false })
    } catch (error) {
      if (request !== latest.current) return
      const message = friendlyMessage(error instanceof Error ? error.message : String(error))
      setState((previous) => ({ data: previous.data, error: message, loading: false }))
    }
  }, [])

  useEffect(() => {
    if (paused) return
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, refresh, ...deps])

  useEffect(() => {
    if (paused) return
    const watching = tableKey.split(',')
    let timer: ReturnType<typeof setTimeout> | undefined

    // A burst of changes (a trade moves several rows) becomes one refetch.
    const onChange: Listener = (table) => {
      if (table !== EVERYTHING && !watching.includes(table)) return
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 120)
    }
    listeners.add(onChange)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)

    const poll = pollMs ? setInterval(onVisible, pollMs) : undefined

    return () => {
      listeners.delete(onChange)
      clearTimeout(timer)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [paused, pollMs, refresh, tableKey])

  return { ...state, refresh }
}
