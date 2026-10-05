import { ArrowLeft, ArrowRight } from 'lucide-react'
import Link from 'next/link'

/** "1–12 of 40" with previous and next. Renders nothing when everything fits on one page. */
export function Pager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  if (total <= pageSize) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(total, page * pageSize)
  const pages = Math.ceil(total / pageSize)
  return (
    <nav className="pager" aria-label="Pages">
      <span className="tnum">
        {first}–{last} of {total}
      </span>
      <div>
        {page > 1 ? (
          <Link className="action-pill" href={href(page - 1)} aria-label="Previous page">
            <ArrowLeft size={14} aria-hidden /> Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link className="action-pill" href={href(page + 1)} aria-label="Next page">
            Next <ArrowRight size={14} aria-hidden />
          </Link>
        ) : null}
      </div>
    </nav>
  )
}
