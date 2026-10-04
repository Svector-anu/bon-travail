import type { Metadata } from 'next'
import Link from 'next/link'
import { Reveal } from '@/components/reveal'

export const metadata: Metadata = { title: 'Docs' }

const SECTIONS = [
  {
    id: 'loop',
    label: 'The loop',
    title: 'machines find the work. humans finish it.',
    body: [
      'bon travail watches the GitHub Actions workflow of each repository your team connects. When the same job and step fail twice in a row on the default branch, it records a finding with GitHub’s evidence: the failing log, the step’s command, and the commits between the last green run and the first red one.',
      'Our agent, Aeon, then reproduces the failure in its own runner, finds the first bad commit, and writes down why it fails. An engineer reads that and decides whether the fix stays in the team or goes to humans they name. An approved contributor opens a pull request; when the project’s tests pass on it, the reward is paid from escrow on Arc. If the deadline passes first, the reward goes back. Either way a receipt is sealed, and Aeon keeps watching for the failure to come back.',
    ],
  },
  {
    id: 'engineers',
    label: 'For engineers',
    title: 'connect, read, decide.',
    body: [
      'Sign in to the console with GitHub. Install the bon travail GitHub App on the repositories you want watched; it can only read workflow runs, logs, contents and pull requests, and it never writes. Pick a repository and the workflow to watch.',
      'When a finding needs you, open it: you will see what failed, the evidence, and Aeon’s investigation. Keep it internal, dismiss it, or externalize it. Externalizing means you set the reward, the deadline, the acceptance condition, the scope, the protected paths and the GitHub logins (with the wallet each is paid at) allowed to take it. The reward is escrowed the moment you approve.',
    ],
  },
  {
    id: 'contributors',
    label: 'For contributors',
    title: 'no account. your pull request is your identity.',
    body: [
      'If an engineer named you, open a pull request against the repository’s default branch that mentions the work package id (for example WORK-003), paste its link on the work page and claim. When it is ready, press “Done: check my fix”. By default the fix has to be merged and the acceptance job has to pass on the default branch. The reward goes to the wallet the engineer approved for your GitHub login.',
    ],
  },
  {
    id: 'verification',
    label: 'Verification',
    title: 'the tests decide.',
    body: [
      'The verdict comes from GitHub’s own records: the pull request has to target the right repository and branch, be opened by the contributor holding the claim, leave the workflow, .github/ and every protected path untouched, and the acceptance job has to conclude “success” on the exact commit. Nothing a contributor, an engineer’s browser or Aeon says can change that verdict.',
    ],
  },
  {
    id: 'why',
    label: 'Why it works this way',
    title: 'agents recommend. humans decide. the chain settles.',
    body: [
      'Engineers approve every work package because handing work outside the team is a judgment about scope, secrets and trust that belongs to the humans who own the code.',
      'The project’s own tests are the judge because they already define what “working” means for that code, and they run outside both the contributor’s and the agent’s control.',
      'Rewards sit in an escrow contract on Arc: a payout can only go to the approved wallet, a task can never be both paid and refunded, and every payment is idempotent, so a retry never pays twice.',
    ],
  },
] as const

export default function DocsPage() {
  return (
    <Reveal className="docs">
      <div className="page-head">
        <div>
          <span className="label">Docs</span>
          <h1>how bon travail works</h1>
        </div>
      </div>
      <nav className="docs-toc" aria-label="On this page">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.label}
          </a>
        ))}
      </nav>
      {SECTIONS.map((section) => (
        <section key={section.id} id={section.id} className="docs-section">
          <span className="label">{section.label}</span>
          <h2>{section.title}</h2>
          {section.body.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </section>
      ))}
      <p className="muted docs-foot">
        Running your own deployment? The repository’s README covers setup, environment variables and Vercel. Start at{' '}
        <Link href="/console">the console</Link>.
      </p>
    </Reveal>
  )
}
