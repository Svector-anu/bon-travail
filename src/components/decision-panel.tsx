'use client'

import { ArrowLeft, ArrowRight, Globe, Plus, Trash2, Users } from 'lucide-react'
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

const STEPS = ['Reward', 'Who', 'Approve'] as const
const DEADLINES = [
  { hours: '24', label: '1 day' },
  { hours: '48', label: '2 days' },
  { hours: '168', label: '1 week' },
]

/**
 * The engineer's decision, three short steps: what it pays, who may take it,
 * then one sentence to approve. Aeon's drafted terms arrive pre-filled and
 * folded away; the reward and the people are left to the engineer, because
 * those are never a machine's call.
 */
export function DecisionPanel({ findingId, canDecide, canExternalize, maxReward, simulatedPayments, defaults }: Props) {
  const { busy, error, run, router } = useAction()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [reward, setReward] = useState('')
  const [hours, setHours] = useState('48')
  const [anyone, setAnyone] = useState(true)
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
    // Enter on an earlier step moves on; only the last step approves and escrows.
    if (step < STEPS.length - 1) {
      if (step === 0 ? reward.trim() : anyone || rows.some((r) => r.login.trim())) setStep(step + 1)
      return
    }
    void run(
      () =>
        postJson(`/api/owner/findings/${findingId}/externalize`, {
          reward: reward.trim(),
          deadlineHours: Number(hours),
          openToAnyone: anyone,
          contributors: anyone
            ? []
            : rows.filter((r) => r.login.trim()).map((r) => ({ login: r.login.trim(), wallet: r.wallet.trim() || undefined })),
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
    <section className="cand-decide" id="decide" aria-label="Your decision">
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
          <ol className="steps" aria-label="Steps">
            {STEPS.map((label, i) => (
              <li key={label} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : undefined}>
                <span className="tnum">{i + 1}</span> {label}
              </li>
            ))}
          </ol>

          {step === 0 && (
            <div className="step-body">
              <div className="field">
                <label htmlFor="reward">What it pays (USDC, up to {maxReward})</label>
                <input id="reward" className="input tnum big" inputMode="decimal" placeholder="0.50" autoFocus value={reward} onChange={(e) => setReward(e.target.value)} />
              </div>
              <div className="field">
                <span className="field-label">Time to fix it</span>
                <div className="chips">
                  {DEADLINES.map((d) => (
                    <button key={d.hours} type="button" className="chip-btn" aria-pressed={hours === d.hours} onClick={() => setHours(d.hours)}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="step-body">
              <div className="who">
                <button type="button" className="who-card" aria-pressed={anyone} onClick={() => setAnyone(true)}>
                  <Globe size={18} aria-hidden />
                  <strong>Anyone on GitHub</strong>
                  <span>First to claim with a PR gets a day to land it.</span>
                </button>
                <button type="button" className="who-card" aria-pressed={!anyone} onClick={() => setAnyone(false)}>
                  <Users size={18} aria-hidden />
                  <strong>People I name</strong>
                  <span>Only the GitHub logins you list.</span>
                </button>
              </div>
              {!anyone && (
                <fieldset className="field allowlist">
                  <legend>GitHub logins (wallet optional)</legend>
                  {rows.map((row, i) => (
                    <div key={i} className="allow-row">
                      <input aria-label={`GitHub login ${i + 1}`} className="input mono" placeholder="github-login" value={row.login} onChange={(e) => update(i, { login: e.target.value })} />
                      <input aria-label={`Payout wallet ${i + 1}`} className="input mono" placeholder="0x… (optional)" value={row.wallet} onChange={(e) => update(i, { wallet: e.target.value })} />
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
                </fieldset>
              )}
              <p className="step-note">They get paid to the wallet in their PR description, unless you set one here.</p>
            </div>
          )}

          {step === 2 && (
            <div className="step-body">
              <p className="step-summary">
                <strong>{reward.trim() || '?'} USDC</strong> to {anyone ? 'anyone on GitHub' : rows.filter((r) => r.login.trim()).map((r) => `@${r.login.trim().replace(/^@/, '')}`).join(', ') || 'the people you name'} who
                fixes this within {DEADLINES.find((d) => d.hours === hours)?.label ?? `${hours} hours`}. Paid when your tests pass
                {requireMerge ? ' after you merge it' : ''}; refunded if nobody does.
              </p>
              <details className="terms">
                <summary>Terms Aeon drafted · edit</summary>
                <div className="field">
                  <label htmlFor="acceptance">How a fix is judged</label>
                  <textarea id="acceptance" className="input" rows={3} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="scope">What they may change</label>
                  <textarea id="scope" className="input" rows={3} value={scope} onChange={(e) => setScope(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="paths">Off limits (one path per line)</label>
                  <textarea id="paths" className="input mono" rows={3} value={paths} onChange={(e) => setPaths(e.target.value)} />
                  <small className="muted">
                    <span className="mono">.github/</span> and <span className="mono">{defaults.workflowPath}</span> are always off limits.
                  </small>
                </div>
                <label className="checkbox">
                  <input type="checkbox" checked={requireMerge} onChange={(e) => setRequireMerge(e.target.checked)} />
                  Pay only after I merge the fix
                </label>
              </details>
              {simulatedPayments && <p className="step-note">Payments are simulated here; no USDC moves.</p>}
            </div>
          )}

          <div className="decision-actions">
            {step > 0 ? (
              <button type="button" className="btn btn-glass" disabled={busy} onClick={() => setStep(step - 1)}>
                <Roll>
                  <ArrowLeft size={15} aria-hidden /> Back
                </Roll>
              </button>
            ) : (
              <button type="button" className="btn btn-glass" disabled={busy} onClick={() => setOpen(false)}>
                <Roll>Cancel</Roll>
              </button>
            )}
            {step < 2 ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={step === 0 ? !reward.trim() : !anyone && !rows.some((r) => r.login.trim())}
                onClick={() => setStep(step + 1)}
              >
                <Roll>
                  Next <ArrowRight size={15} aria-hidden />
                </Roll>
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <Roll>{busy ? 'Escrowing…' : `Approve and escrow ${reward.trim()} USDC`}</Roll>
              </button>
            )}
          </div>
          {error && <p className="form-error">{error}</p>}
        </form>
      )}
    </section>
  )
}
