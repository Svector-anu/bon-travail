import Link from 'next/link'

export function Footer() {
  return (
    <footer className="site-footer">
      <Link href="/">Tasks</Link>
      <Link href="/receipts">Receipts</Link>
      <Link href="/agent">Agent</Link>
      <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer">
        Arcscan
      </a>
      <a href="https://github.com/aeonfun/aeon" target="_blank" rel="noreferrer">
        Aeon
      </a>
      <a href="https://github.com/aaronjmars/turnip-ui" target="_blank" rel="noreferrer">
        Turnip UI
      </a>
    </footer>
  )
}
