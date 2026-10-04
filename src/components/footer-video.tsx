'use client'

import { useEffect, useRef } from 'react'

/**
 * The footer's final scene: the Macintosh in the meadow booting into a paid
 * fix. It loads nothing until the footer is near, plays only while it is on
 * screen, and pauses when it leaves, so a phone never decodes video nobody is
 * watching. Reduced-motion and data-saver visitors keep the poster frame.
 */
export function FooterVideo() {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.muted = true
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || saveData) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          video.play().catch(() => {
            // Autoplay refused (low-power mode): the poster frame stays up.
          })
        } else {
          video.pause()
        }
      },
      { threshold: 0.25 },
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [])

  return (
    <video
      ref={ref}
      className="foot-video"
      muted
      loop
      playsInline
      preload="none"
      poster="/scenes/footer-macintosh.jpg"
      aria-hidden
      tabIndex={-1}
    >
      <source src="/scenes/footer-macintosh.mp4" type="video/mp4" />
    </video>
  )
}
