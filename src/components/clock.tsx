'use client'

import { useSyncExternalStore } from 'react'
import { formatAgo, formatDuration } from '@/lib/format'

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
let nowMs = Date.now()

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    timer = setInterval(() => {
      nowMs = Date.now()
      for (const l of listeners) l()
    }, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** One shared one-second clock. Returns null during server render. */
function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => nowMs,
    () => null,
  )
}

export function Countdown({ to, done = 'now' }: { to: number; done?: string }) {
  const now = useNow()
  if (now === null) return <span className="tnum">--</span>
  return <span className="tnum">{to - now > 0 ? formatDuration(to - now) : done}</span>
}

export function Ago({ ts }: { ts: number }) {
  const now = useNow()
  return <span>{now === null ? '--' : formatAgo(ts, now)}</span>
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Formats in the viewer's timezone, which the server cannot know. */
export function LocalTime({ ts, full = false }: { ts: number; full?: boolean }) {
  return (
    <time dateTime={new Date(ts).toISOString()} suppressHydrationWarning>
      {(full ? dateTimeFormat : timeFormat).format(ts)}
    </time>
  )
}
