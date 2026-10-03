import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { Roll } from '@/components/roll'

export default function NotFound() {
  return (
    <div className="page-head" style={{ flexDirection: 'column', alignItems: 'flex-start', minHeight: '40vh' }}>
      <h1>Nothing here</h1>
      <p>That task or receipt does not exist.</p>
      <Link className="btn btn-primary" href="/tasks" style={{ marginTop: 18 }}>
        <Roll>See live tasks <ArrowRight size={16} /></Roll>
      </Link>
    </div>
  )
}
