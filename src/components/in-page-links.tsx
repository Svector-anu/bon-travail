'use client'

import { useEffect } from 'react'

/**
 * Contents links and citations on a long page. A plain "#id" link makes the
 * browser fire popstate, which the app router treats as a navigation and
 * which cuts the scroll short; here the jump is done directly and the address
 * updated without one. The element landed on is marked so it can be lit.
 */
export function InPageLinks({ within }: { within: string }) {
  useEffect(() => {
    const root = document.querySelector(within)
    if (!root) return
    const onClick = (event: Event) => {
      const mouse = event as MouseEvent
      if (mouse.defaultPrevented || mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
      const id = link?.getAttribute('href')?.slice(1)
      const target = id ? document.getElementById(id) : null
      if (!target) return
      event.preventDefault()
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      window.history.replaceState(window.history.state, '', `#${id}`)
      root.querySelectorAll('[data-landed]').forEach((el) => el.removeAttribute('data-landed'))
      target.setAttribute('data-landed', '')
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [within])
  return null
}
