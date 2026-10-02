'use client'

import { useSyncExternalStore } from 'react'

interface Toast {
  id: number
  text: string
}

let toasts: Toast[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function pushToast(text: string) {
  const id = Date.now() + Math.random()
  toasts = [...toasts, { id, text }]
  emit()
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  }, 3200)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const EMPTY: Toast[] = []

export function Toasts() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => EMPTY)
  if (list.length === 0) return null
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  )
}
