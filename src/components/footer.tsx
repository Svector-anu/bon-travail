import Link from 'next/link'

export function Footer() {
  return (
    <footer className="site-footer liquid-glass">
      <div>
        <Link href="/" className="brand">
          <img src="/mascots/seedling.png" alt="" />
          <span>Proofwork</span>
        </Link>
        <p>Autonomous work, real payments. Tasks posted by an agent, answers checked against the chain.</p>
      </div>
      <div>
        <h4>Product</h4>
        <ul>
          <li>
            <Link href="/tasks">Tasks</Link>
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
        <span>Powered by agents, verified by code.</span>
      </div>
    </footer>
  )
}
