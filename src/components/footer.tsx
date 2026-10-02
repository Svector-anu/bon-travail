import Link from 'next/link'

export function Footer() {
  return (
    <footer className="site-footer">
      <Link href="/">Tasks</Link>
      <Link href="/agent">Agent activity</Link>
      <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer">
        Arc explorer
      </a>
      <a href="https://github.com/aeonfun/aeon" target="_blank" rel="noreferrer">
        Runs on Aeon
      </a>
    </footer>
  )
}
