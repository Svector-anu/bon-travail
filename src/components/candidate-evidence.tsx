'use client'

import { ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import type { InvestigationCommand, RegressionWindow } from '@/domain/findings'

interface Props {
  log: string | null
  stepCommand: string | null
  failingRunUrl: string
  reproduction: string[]
  commands: InvestigationCommand[]
  bisectMethod: string | null
  regression: RegressionWindow | null
  firstBadSha: string | null
  /** Whether Aeon will still pick this finding up; once the engineer has decided, it never will. */
  awaitingAeon: boolean
}

const TABS = [
  { key: 'log', label: 'Log' },
  { key: 'repro', label: 'Reproduction' },
  { key: 'cause', label: 'Likely cause' },
] as const

type Tab = (typeof TABS)[number]['key']

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '?')

/** The evidence behind a candidate, one view at a time: what GitHub logged, how Aeon reproduced it, which change it points at. */
export function CandidateEvidence(props: Props) {
  const [tab, setTab] = useState<Tab>('log')

  return (
    <section className="cand-evidence" aria-label="Evidence">
      <div className="cand-tabs" role="tablist" aria-label="Evidence">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`ev-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`ev-panel-${t.key}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        <a className="cand-tabs-link" href={props.failingRunUrl} target="_blank" rel="noreferrer">
          Latest failing run <ArrowUpRight size={12} aria-hidden />
        </a>
      </div>

      <div className="cand-panel" role="tabpanel" id={`ev-panel-${tab}`} aria-labelledby={`ev-tab-${tab}`}>
        {tab === 'log' &&
          (props.log ? (
            <>
              <pre className="log">{props.log}</pre>
              {props.stepCommand && (
                <p className="cand-note">
                  Failing step runs <code>{props.stepCommand}</code>
                </p>
              )}
            </>
          ) : (
            <p className="muted">GitHub returned no readable log for this step.</p>
          ))}

        {tab === 'repro' &&
          (props.reproduction.length > 0 || props.commands.length > 0 ? (
            <>
              {props.reproduction.length > 0 && (
                <ol className="cand-steps">
                  {props.reproduction.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}
              {props.commands.length > 0 && (
                <ul className="cand-commands">
                  {props.commands.map((c, i) => (
                    <li key={i}>
                      <span className={`status ${c.outcome === 'passed' ? 'paid' : c.outcome === 'failed' ? 'refund' : ''}`}>{c.outcome}</span>
                      <code>{c.command}</code>
                      {c.sha && <span className="mono muted">{short(c.sha)}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {props.bisectMethod && <p className="cand-note">{props.bisectMethod}</p>}
            </>
          ) : (
            <p className="muted">
              {props.awaitingAeon
                ? 'Aeon has not reproduced this yet. It runs the failing step in its own runner on its next pass.'
                : 'Aeon did not reproduce this one: it was decided before Aeon’s pass.'}
            </p>
          ))}

        {tab === 'cause' &&
          (props.regression ? (
            <>
              <p className="cand-note">
                {props.regression.lastGreenSha ? (
                  <>
                    Green at <span className="mono">{short(props.regression.lastGreenSha)}</span>, red from{' '}
                    <span className="mono">{short(props.regression.firstRedSha)}</span>.
                  </>
                ) : (
                  <>
                    Red from <span className="mono">{short(props.regression.firstRedSha)}</span>; no green run before it on record.
                  </>
                )}{' '}
                {props.regression.compareUrl && (
                  <a href={props.regression.compareUrl} target="_blank" rel="noreferrer">
                    Compare <ArrowUpRight size={12} aria-hidden />
                  </a>
                )}
              </p>
              {props.regression.commits.length > 0 && (
                <ul className="cand-commits">
                  {props.regression.commits.map((c) => {
                    const suspect = props.firstBadSha !== null && props.firstBadSha.startsWith(c.sha.slice(0, 7))
                    return (
                      <li key={c.sha} className={suspect ? 'suspect' : undefined}>
                        <a className="mono" href={c.url} target="_blank" rel="noreferrer">
                          {short(c.sha)}
                        </a>
                        <span>{c.message}</span>
                        {suspect && <span className="label">first bad</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          ) : (
            <p className="muted">No regression window yet: the observer needs a green and a red run to compare.</p>
          ))}
      </div>
    </section>
  )
}
