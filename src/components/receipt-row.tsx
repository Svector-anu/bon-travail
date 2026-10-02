import Link from 'next/link'
import { shortAddress } from '@/domain/address'
import type { ReceiptSummary } from '@/server/queries'
import { LocalTime } from './clock'
import { StatusPill } from './status-pill'

export function ReceiptRow({ receipt }: { receipt: ReceiptSummary }) {
  const paid = receipt.outcome === 'PAID'
  return (
    <Link href={`/receipt/${receipt.taskId}`} className="card row-card">
      <div className="row-top">
        <StatusPill state={paid ? 'PAID' : 'REFUNDED'} />
        <h3>{receipt.displayId}</h3>
      </div>
      <div className="amount">
        {receipt.reward} USDC
        {receipt.simulated && <span className="sim">Simulated</span>}
      </div>
      <div className="row-meta">
        <span>{receipt.title}</span>
        <span>{paid && receipt.worker ? `Paid to ${shortAddress(receipt.worker)}` : 'Returned to treasury'}</span>
        <LocalTime ts={receipt.settledAt} full />
      </div>
    </Link>
  )
}
