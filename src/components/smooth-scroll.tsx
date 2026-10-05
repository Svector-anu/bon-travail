'use client'

import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/** Long reading pages keep the browser's own scrolling, so contents links and citations land exactly where they point. */
const NATIVE_SCROLL_ROUTES = ['/introducing']

/**
 * Wheel and trackpad scrolling glide to rest instead of stepping, the same
 * Lenis easing coorda.framer.website uses. Off for people who ask for less
 * motion; touch scrolling stays native.
 */
export function SmoothScroll() {
  const pathname = usePathname()
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (NATIVE_SCROLL_ROUTES.some((route) => pathname.startsWith(route))) return
    const lenis = new Lenis({ autoRaf: true, anchors: true, lerp: 0.075 })
    return () => lenis.destroy()
  }, [pathname])
  return null
}
