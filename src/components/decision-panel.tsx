'use client'

import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ActionButton, postJson, useAction } from './owner-actions'
import { Roll } from './roll'

interface Props {
  findingId: string
  canDecide: boolean
  canExternalize: boolean
  maxReward: string
  simulatedPayments: boolean
  defaults: {
    acceptance: string
    scope: string
    protectedPaths: string[]
    workflowPath: string
  }
}

interface Row {
  login: string
  wallet: string
}

/**
 * The engineer's decision. Aeon's proposal arrives pre-filled and editable;
 * the reward and the people are left blank on purpose, because those are
 * never a machine's call.
 */
export function DecisionPanel({ findingId, canDecide, canExternalize, maxReward, simulatedPayments, defaults }: Props) {
  const { busy, error, run, router } = useAction()
  const [open, setOpen] = useState(false)
  const [reward, setReward] = useState('')
  const [hours, setHours] = useState('48')
  const [rows, setRows] = useState<Row[]>([{ login: '', wallet: '' }])
  const [acceptance, setAcceptance] = useState(defaults.acceptance)
  const [scope, setScope] = useState(defaults.scope)
  const [paths, setPaths] = useState(defaults.protectedPaths.join('\n'))
  const [requireMerge, setRequireMerge] = useState(true)

  function update(i: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void run(
      () =>
        postJson(`/api/owner/findings/${findingId}/externalize`, {
          reward: reward.trim(),
          deadlineHours: Number(hours),
          contributors: rows.filter((r) => r.login.trim() || r.wallet.trim()).map((r) => ({ login: r.login.trim(), wallet: r.wallet.trim() })),
          acceptance,
          scope,
          protectedPaths: paths
            .split('\n')
            .map((p) => p.trim())
            .filter(Boolean),
          requireMerge,
        }),
      (result) => {
        const task = (result as { task?: { id?: string } }).task
        router.push(task?.id ? `/task/${task.id}` : '/console')
        router.refresh()
      },
    )
  }

  if (!canDecide && !canExternalize) return null

  return (
    <section className="cand-decide" aria-label="Your decision">
      <span className="label">Your decision</span>
      {!open ? (
        <>
          <div className="cand-choices">
            {canDecide && (
              <div className="cand-choice">
                <h2>Keep it internal</h2>
                <p>Your team fixes it. Nothing leaves the company, no money moves, and Aeon tells you when it is green again.</p>
                <ActionButton url={`/api/owner/findings/${findingId}/internal`}>Keep it internal</ActionButton>
              </div>
            )}
            {canExternalize && (
              <div className="cand-choice primary">
                <h2>Hand it to a human</h2>
                <p>You set the reward and the deadline and name who may take it. The money is held until your tests pass, and comes back if they do not.</p>
                <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
                  <Roll>
                    Externalize this work <ArrowRight size={15} aria-hidden />
                  </Roll>
                </button>
              </div>
            )}
          </div>
          {canDecide && (
            <div className="cand-dismiss">
              <ActionButton url={`/api/owner/findings/${findingId}/dismiss`} className="text-link" confirmText="Dismiss this finding?">
                Not worth fixing: dismiss
              </ActionButton>
            </div>
          )}
        </>
      ) : (
        <form className="externalize" onSubmit={onSubmit}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="reward">Reward (USDC, up to {maxReward})</label>
              <input id="reward" className="input tnum" inputMode="decimal" placeholder="0.50" value={reward} onChange={(e) => setReward(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="hours">Deadline (hours)</label>
              <input id="hours" className="input tnum" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
          </div>

          <fieldset className="field allowlist">
            <legend>Who may take it</legend>
            {rows.map((row, i) => (
              <div key={i} className="allow-row">
                <input
                  aria-label={`GitHub login ${i + 1}`}
                  className="input mono"
                  placeholder="github-login"
                  value={row.login}
                  onChange={(e) => update(i, { login: e.target.value })}
                />
                <input
                  aria-label={`Payout wallet ${i + 1}`}
                  className="input mono"
                  placeholder="0x payout wallet"
                  value={row.wallet}
                  onChange={(e) => update(i, { wallet: e.target.value })}
                />
                {rows.length > 1 && (
                  <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="text-link" onClick={() => setRows([...rows, { login: '', wallet: '' }])}>
              <Plus size={13} /> Add a human
            </button>
            <small className="muted">The reward can only ever be paid to the wallet you enter for the login that opens the PR.</small>
          </fieldset>

          <div className="field">
            <label htmlFor="acceptance">Acceptance condition</label>
            <textarea id="acceptance" className="input" rows={3} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="scope">Scope</label>
            <textarea id="scope" className="input" rows={5} value={scope} onChange={(e) => setScope(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="paths">Protected paths (one per line)</label>
            <textarea id="paths" className="input mono" rows={3} value={paths} onChange={(e) => setPaths(e.target.value)} />
            <small className="muted">
              <span className="mono">.github/</span> and <span className="mono">{defaults.workflowPath}</span> are always protected.
            </small>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={requireMerge} onChange={(e) => setRequireMerge(e.target.checked)} />
            Pay only after I merge the fix and the job passes on the default branch
          </label>

          <div className="decision-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !reward.trim()}>
              <Roll>{busy ? 'Escrowing...' : `Approve and escrow${reward.trim() ? ` ${reward.trim()} USDC` : ''}`}</Roll>
            </button>
            <button type="button" className="btn btn-glass" disabled={busy} onClick={() => setOpen(false)}>
              <Roll>Cancel</Roll>
            </button>
          </div>
          {simulatedPayments && <p className="muted">Payments are simulated in this environment; no USDC will move.</p>}
          {error && <p className="form-error">{error}</p>}
        </form>
      )}
    </section>
  )
}
