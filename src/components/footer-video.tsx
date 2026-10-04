'use client'

import { Play, Volume2, VolumeX } from 'lucide-react'
import { motion, type MotionValue } from 'motion/react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

const REDUCE = '(prefers-reduced-motion: reduce)'

/** Reduced motion or data saver: no autoplay. Read as a store so it follows the setting and renders the same on the server. */
function subscribeCalm(onChange: () => void) {
  const query = window.matchMedia(REDUCE)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
function readCalm() {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
  return window.matchMedia(REDUCE).matches || saveData
}

/**
 * The footer's final scene: the Macintosh in the meadow booting into a paid
 * fix, with its own soundtrack. Browsers only autoplay silent video, so it
 * starts muted while on screen and pauses when it leaves; the corner control
 * turns the real audio on. Reduced-motion and data-saver visitors get the
 * poster and a play control instead of autoplay.
 */
export function FooterVideo({ scale }: { scale?: MotionValue<number> }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const wantsSound = useRef(false)
  const [playing, setPlaying] = useState(false)
  const calm = useSyncExternalStore(subscribeCalm, readCalm, () => false)
  const wantsPlay = useRef(true)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    // React does not always serialise `muted`, and browsers only autoplay silent video.
    video.muted = !wantsSound.current
    wantsPlay.current = wantsPlay.current && !calm

    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && wantsPlay.current) {
          video.play().catch(() => {
            // Autoplay refused (low-power mode): the poster stays up and the control still works.
          })
        } else if (!entry?.isIntersecting) {
          video.pause()
        }
      },
      { threshold: 0.25 },
    )
    observer.observe(video)
    return () => {
      observer.disconnect()
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [calm])

  const toggleSound = () => {
    const video = ref.current
    if (!video) return
    wantsPlay.current = true
    if (video.paused) {
      video.muted = false
      wantsSound.current = true
      setMuted(false)
      video.play().catch(() => {
        video.muted = true
        wantsSound.current = false
        setMuted(true)
      })
      return
    }
    video.muted = !video.muted
    wantsSound.current = !video.muted
    setMuted(video.muted)
  }

  const waiting = calm && !playing

  return (
    <>
      <motion.video
        ref={ref}
        className="foot-video"
        style={scale ? { scale } : undefined}
        muted
        loop
        playsInline
        preload="none"
        poster="/scenes/footer-macintosh.jpg"
        aria-label="A beige Macintosh in a meadow boots up, finds work, verifies a fix and pays for it."
      >
        <source src="/scenes/footer-macintosh.mp4" type="video/mp4" />
      </motion.video>
      <button
        type="button"
        className="foot-sound"
        onClick={toggleSound}
        aria-pressed={waiting ? undefined : !muted}
        aria-label={waiting ? 'Play the video with sound' : 'Sound'}
      >
        {waiting ? <Play size={14} aria-hidden /> : muted ? <VolumeX size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
        <span aria-hidden>{waiting ? 'Play' : muted ? 'Sound off' : 'Sound on'}</span>
      </button>
    </>
  )
}
