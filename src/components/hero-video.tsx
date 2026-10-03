'use client'

import { useEffect, useRef } from 'react'

/**
 * Decorative world behind the landing hero. React does not always serialise
 * `muted` on the server, and browsers refuse to autoplay unmuted video, so the
 * flag is forced on the element before play(). Reduced-motion users get the
 * still poster frame.
 */
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.muted = true
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      video.pause()
      return
    }
    video.play().catch(() => {
      // Autoplay blocked (low-power mode, data saver): the poster frame stays up.
    })
  }, [])

  return (
    <video
      ref={ref}
      className="hero-video"
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      poster="/scenes/proofwork-meadow.jpg"
      aria-hidden
      tabIndex={-1}
    >
      <source src="/scenes/proofwork-meadow-sm.mp4" type="video/mp4" media="(max-width: 720px)" />
      <source src="/scenes/proofwork-meadow.mp4" type="video/mp4" />
    </video>
  )
}
