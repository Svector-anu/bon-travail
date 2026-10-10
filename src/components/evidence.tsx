import { ArrowUpRight } from 'lucide-react'
import { CopyButton } from './copy-button'
import type { RegressionWindow } from '@/domain/findings'
import type { ReceiptInvestigation } from '@/domain/views'

export interface EvidenceFacts {
  repo: string
  workflowName: string
  jobName: string
  stepName: string
  failureCount: number
  firstFailedSha: string
  lastFailedRunUrl: string
  errorExcerpt: string | null
  regression: RegressionWindow | null
}

const CONFIDENCE = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' } as const

export function EvidenceFailure({ facts }: { facts: EvidenceFacts }) {
  const window = facts.regression
  const commits = window?.commits ?? []
  const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '?')
  return (
    <section className="evidence-block">
      <div className="panel-title">
        <span className="label">What failed · from GitHub</span>
        <a className="text-link" href={facts.lastFailedRunUrl} target="_blank" rel="noreferrer">
          Latest failing run <ArrowUpRight size={13} />
        </a>
      </div>
      <p className="evidence-lead">
        <strong>{facts.jobName}</strong> › <strong>{facts.stepName}</strong> in {facts.workflowName} failed{' '}
        <span className="tnum">{facts.failureCount}</span> {facts.failureCount === 1 ? 'time' : 'times'} in a row on {facts.repo}.
      </p>
      {facts.errorExcerpt && <pre className="log">{facts.errorExcerpt}</pre>}
      {window && (
        <div className="regression">
          <p className="muted">
            {window.lastGreenSha ? (
              <>
                Last green at <span className="mono">{short(window.lastGreenSha)}</span>, first red at{' '}
                <span className="mono">{short(window.firstRedSha)}</span>.{' '}
                {commits.length === 1
                  ? 'One commit landed in between, so it is the change to look at.'
                  : `${commits.length}${window.truncated ? '+' : ''} commits landed in between.`}
              </>
            ) : (
              <>
                First red at <span className="mono">{short(window.firstRedSha)}</span>. No green run was observed before it.
              </>
            )}
            {window.compareUrl && (
              <>
                {' '}
                <a href={window.compareUrl} target="_blank" rel="noreferrer">
                  Compare
                </a>
              </>
            )}
          </p>
          {commits.length > 0 && (
            <ul className="commits">
              {commits.map((c) => (
                <li key={c.sha}>
                  <a className="mono" href={c.url} target="_blank" rel="noreferrer">
                    {short(c.sha)}
                  </a>
                  <span>{c.message}</span>
                  {c.author && <small>{c.author}</small>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export function EvidenceInvestigation({ investigation }: { investigation: ReceiptInvestigation | null }) {
  const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '?')
  return (
    <section className="evidence-block">
      <div className="panel-title">
        <span className="label">Why · Aeon&apos;s investigation</span>
        {investigation?.runUrl && (
          <a className="text-link" href={investigation.runUrl} target="_blank" rel="noreferrer">
            Aeon run <ArrowUpRight size={13} />
          </a>
        )}
      </div>
      {investigation ? (
        <>
          <p className="evidence-lead">{investigation.summary}</p>
          <p className="muted">{investigation.rootCause}</p>
          <p className="evidence-meta">
            <span className="chip">{CONFIDENCE[investigation.confidence]}</span>
            {investigation.firstBadSha && (
              <span>
                First bad commit <span className="mono">{short(investigation.firstBadSha)}</span>
              </span>
            )}
          </p>
        </>
      ) : (
        <p className="muted">Aeon has not attached an investigation. The facts above come straight from GitHub.</p>
      )}
    </section>
  )
}

/**
 * What failed and why the machines think so. The observer's facts (runs,
 * logs, commits) are labeled apart from Aeon's reading of them, so a reader
 * always knows which part is GitHub's record and which part is a model's.
 */
export function Evidence({ facts, investigation }: { facts: EvidenceFacts; investigation: ReceiptInvestigation | null }) {
  return (
    <div className="evidence">
      <EvidenceFailure facts={facts} />
      <EvidenceInvestigation investigation={investigation} />
    </div>
  )
}

export interface BugFacts {
  issueNumber: number
  issueTitle: string
  issueUrl: string
  testPath: string
  testContent: string
  testCommand: string
}

/** The reported bug and the test Aeon wrote for it, which a fix must add unchanged. */
export function BugEvidence({ bug, failingOutput }: { bug: BugFacts; failingOutput?: string | null }) {
  return (
    <section className="evidence-block">
      <div className="panel-title">
        <span className="label">The bug · reported on GitHub</span>
        <a className="text-link" href={bug.issueUrl} target="_blank" rel="noreferrer">
          issue #{bug.issueNumber} <ArrowUpRight size={12} aria-hidden />
        </a>
      </div>
      <p className="evidence-lead">{bug.issueTitle}</p>
      <div className="panel-title">
        <span className="label">The test that proves it · written by Aeon</span>
        <CopyButton value={bug.testContent} label="Copy the test" />
      </div>
      <p className="muted">
        Add it as <span className="mono">{bug.testPath}</span>, unchanged. It fails today; your fix makes it pass when you run{' '}
        <span className="mono">{bug.testCommand}</span>.
      </p>
      <pre className="log">{bug.testContent}</pre>
      {failingOutput && (
        <>
          <span className="label">How it fails today</span>
          <pre className="log">{failingOutput}</pre>
        </>
      )}
    </section>
  )
}
