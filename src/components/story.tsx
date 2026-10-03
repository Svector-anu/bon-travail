import { ArrowRight, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { shortAddress } from '@/domain/address'
import type { ReceiptView } from '@/domain/views'
import { FadeIn } from './fade-in'
import { Roll } from './roll'

interface Chapter {
  key: string
  title: string
  lead: string
  detail?: React.ReactNode
  image?: { src: string; alt: string }
}

/** Without a settled fix yet, the same chapters describe the loop without inventing any numbers. */
const GENERIC: Chapter[] = [
  { key: 'discover', title: 'agents discover work', lead: 'Our agent, Aeon, watches the tests of the repositories you connect. One failed run is noise; the same test failing twice is work.' },
  { key: 'investigate', title: 'aeon investigates', lead: 'Aeon reruns the failure in its own runner, finds the commit that broke it, and writes down why.' },
  { key: 'decide', title: 'an engineer decides', lead: 'You read the evidence and choose: keep it in the team, or hand it to people you name, for a reward you set.' },
  { key: 'contribute', title: 'a human fixes it', lead: 'An approved contributor opens a pull request inside the scope you wrote. The tests and workflow are off limits.' },
  { key: 'verify', title: 'the tests decide', lead: 'Not a person, not the agent: once you merge, the same test that was failing has to pass.' },
  { key: 'pay', title: 'proofwork pays', lead: 'The reward leaves escrow on Arc for the wallet you approved. A missed deadline refunds you.' },
  { key: 'proof', title: 'the receipt stays', lead: 'Every outcome is sealed with a digest, and Aeon keeps watching for the failure to come back.' },
]

function fromReceipt(r: ReceiptView): Chapter[] {
  const ci = r.task.ci!
  const finding = r.finding
  const investigation = r.investigation
  const attempt = r.attempts.find((a) => a.verification?.valid) ?? r.attempts.at(-1)
  const verification = attempt?.verification?.kind === 'ci-fix' ? attempt.verification : null
  const who = r.workerHandle ? `@${r.workerHandle}` : r.worker ? shortAddress(r.worker) : 'the contributor'
  // The line that says what was wrong, not the log's scaffolding ("error: |-").
  const lines = finding?.errorExcerpt?.split('\n').map((line) => line.trim()) ?? []
  const firstLine = lines.find((line) => line.includes('!==')) ?? lines.find((line) => /\w+Error:|expected .+ (got|received)/i.test(line))
  return [
    {
      key: 'discover',
      title: 'agents discover work',
      lead: finding
        ? `“${finding.jobName} › ${finding.stepName}” failed ${finding.failureCount} times in a row on ${finding.repo}. Twice is a pattern, so it became a finding.`
        : GENERIC[0]!.lead,
      detail: firstLine ? <code className="story-code">{firstLine}</code> : undefined,
    },
    {
      key: 'investigate',
      title: 'aeon investigates',
      lead: investigation ? investigation.summary : GENERIC[1]!.lead,
      detail: investigation ? (
        <p className="story-meta">
          {investigation.firstBadSha ? `first bad commit ${investigation.firstBadSha.slice(0, 7)} · ` : ''}
          {investigation.confidence} confidence
          {investigation.runUrl && (
            <>
              {' · '}
              <a href={investigation.runUrl} target="_blank" rel="noreferrer">
                the run <ArrowUpRight size={12} />
              </a>
            </>
          )}
        </p>
      ) : undefined,
      image: { src: '/scenes/monolith-close.jpg', alt: '' },
    },
    {
      key: 'decide',
      title: 'an engineer decides',
      lead: `The team handed it out for ${r.task.reward} USDC, open only to ${ci.contributors.map((c) => `@${c}`).join(', ')}${ci.requireMerge ? ', paid only after they merge the fix' : ''}.`,
      detail: <p className="story-quote">{ci.acceptance}</p>,
    },
    {
      key: 'contribute',
      title: 'a human fixes it',
      lead: verification ? `${who} opened pull request #${verification.evidence.prNumber} inside that scope.` : `${who} opened a pull request inside that scope.`,
      detail: verification ? (
        <a className="story-link" href={verification.evidence.prUrl} target="_blank" rel="noreferrer">
          {verification.evidence.prUrl.replace('https://github.com/', '')} <ArrowUpRight size={12} />
        </a>
      ) : undefined,
    },
    {
      key: 'verify',
      title: 'the tests decide',
      lead: verification ? verification.reason : GENERIC[4]!.lead,
    },
    {
      key: 'pay',
      title: 'proofwork pays',
      lead: `${r.payout?.amount ?? r.task.reward} USDC left escrow for ${who}${r.payout?.simulated ? ' (simulated)' : ' on Arc'}.`,
      detail: r.payout?.explorerTxUrl ? (
        <a className="story-link" href={r.payout.explorerTxUrl} target="_blank" rel="noreferrer">
          {shortAddress(r.payout.txHash ?? '')} on Arcscan <ArrowUpRight size={12} />
        </a>
      ) : undefined,
      image: { src: '/scenes/glass-ring.jpg', alt: '' },
    },
    {
      key: 'proof',
      title: 'the receipt stays',
      lead: 'Failure, investigation, decision, fix, verdict and payment, sealed together. Aeon keeps watching for it to come back.',
      detail: (
        <Link className="btn btn-glass" href={`/receipt/${r.task.id}`}>
          <Roll>
            Open {r.task.displayId}&apos;s receipt <ArrowRight size={15} />
          </Roll>
        </Link>
      ),
    },
  ]
}

/**
 * The scroll story under the hero. With a settled fix on record it narrates
 * that fix chapter by chapter from its sealed receipt; otherwise it explains
 * the loop. It never shows a number the system did not produce.
 */
export function Story({ receipt }: { receipt: ReceiptView | null }) {
  const chapters = receipt?.task.ci ? fromReceipt(receipt) : GENERIC
  return (
    <section className="story" id="how" aria-labelledby="story-title">
      <FadeIn className="story-head">
        <span className="label">{receipt ? `One real fix · ${receipt.task.displayId}` : 'How it works'}</span>
        <h2 id="story-title">
          every fix leaves
          <br />
          a receipt.
        </h2>
      </FadeIn>
      <div className="story-chapters">
        {chapters.map((chapter, i) => (
          <FadeIn key={chapter.key} className={`story-chapter${chapter.image ? ' with-image' : ''}${i % 2 ? ' flip' : ''}`}>
            <article>
              <div className="story-marker">
                <span className="story-index">0{i + 1}</span>
                <h3>{chapter.title}</h3>
              </div>
              <div className="story-body">
                <p className="story-lead">{chapter.lead}</p>
                {chapter.detail}
              </div>
              {chapter.image && (
                <div className="story-image" aria-hidden>
                  <img src={chapter.image.src} alt={chapter.image.alt} loading="lazy" decoding="async" />
                </div>
              )}
            </article>
          </FadeIn>
        ))}
      </div>
    </section>
  )
}
