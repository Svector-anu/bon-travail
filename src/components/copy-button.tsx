'use client'

import { useState } from 'react'

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          setCopied(false)
        }
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}
