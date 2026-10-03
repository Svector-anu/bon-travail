'use client'

import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { useEffect } from 'react'

/**
 * Wheel and trackpad scrolling glide to rest instead of stepping, the same
 * Lenis easing coorda.framer.website uses. Off for people who ask for less
 * motion; touch scrolling stays native.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const lenis = new Lenis({ autoRaf: true, anchors: true, lerp: 0.075 })
    return () => lenis.destroy()
  }, [])
  return null
}
