import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="page">
      <img className="hero-mark" src="/mascots/turtle.png" alt="" />
      <h1>Nothing here</h1>
      <p className="lede">That task or receipt does not exist. Task ids look like task_001.</p>
      <div className="slip-actions">
        <Link className="btn primary" href="/">
          See live tasks
        </Link>
      </div>
    </div>
  )
}
