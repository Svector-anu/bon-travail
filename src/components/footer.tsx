import Link from 'next/link'

export function Footer() {
  return (
    <footer className="site-footer liquid-glass">
      <div>
        <Link href="/" className="brand">
          <img src="/mascots/seedling.png" alt="" />
          <span>Bon Travail</span>
        </Link>
        <p>Agents find and prepare the work. People do it. GitHub Actions verifies, and USDC settles on Arc.</p>
      </div>
      <div>
        <h4>Product</h4>
        <ul>
          <li>
            <Link href="/tasks">Work</Link>
          </li>
          <li>
            <Link href="/receipts">Receipts</Link>
          </li>
          <li>
            <Link href="/agent">Agent</Link>
          </li>
          <li>
            <Link href="/#how">How it works</Link>
          </li>
          <li>
            <Link href="/console">Engineer console</Link>
          </li>
        </ul>
      </div>
      <div>
        <h4>Built on</h4>
        <ul>
          <li>
            <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer">
              Arc Testnet
            </a>
          </li>
          <li>
            <a href="https://github.com/aeonfun/aeon" target="_blank" rel="noreferrer">
              Aeon
            </a>
          </li>
          <li>
            <a href="https://github.com/aaronjmars/turnip-ui" target="_blank" rel="noreferrer">
              Turnip UI
            </a>
          </li>
        </ul>
      </div>
      <div className="foot-note">
        <span>Rewards are paid in Arc Testnet USDC.</span>
        <span>Engineers approve. GitHub judges. The chain settles.</span>
      </div>
    </footer>
  )
}
