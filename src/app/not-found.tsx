import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="page-head" style={{ flexDirection: 'column', alignItems: 'flex-start', minHeight: '40vh' }}>
      <h1>Nothing here</h1>
      <p>That task or receipt does not exist.</p>
      <Link className="btn btn-primary" href="/tasks" style={{ marginTop: 18 }}>
        See live tasks <ArrowRight size={16} />
      </Link>
    </div>
  )
}
