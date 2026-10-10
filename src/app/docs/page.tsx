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
    id: 'bugs',
    label: 'Reported bugs',
    title: 'a bug becomes a test, then paid work.',
    body: [
      'Broken CI is not the only thing worth fixing. Label an open issue bug on a repository you connected, and Aeon picks it up: it reads the issue and the code, writes one test that fails because of the bug, and runs your test command with and without it to show the test is what fails.',
      'You read the bug, the test and how it fails, and decide like any other finding. If it goes to a human, the fix is paid only when it adds that exact test and your whole workflow passes on it. A fix that edits or skips the test is not paid. Once it is, the test stays in your repository, so your CI guards against the bug from then on.',
    ],
  },
  {
    id: 'engineers',
    label: 'For teams',
    title: 'install, sign in, decide.',
    body: [
      'A GitHub admin installs the bon travail app on the repositories your team wants watched. It only reads workflow runs, logs, issues, contents and pull requests, and it never writes. Then sign in with GitHub. GitHub decides who is on your team: you see exactly the repositories you can reach there, and nobody outside your team sees them.',
      'When a finding needs you, open it: what failed, the evidence, and Aeon\u2019s investigation. Anyone with write access can keep it internal or dismiss it. Putting money behind it takes an admin of that repository, who sets the reward, the deadline, the acceptance condition, the scope and who may take it. The reward is set aside in escrow the moment you approve.',
      'Your team pays from its own balance. In the console, an admin saves the wallet you pay from, sends USDC from it to the deposit address shown there, and pastes the transaction hash. bon travail reads that transfer from the chain before crediting it, and open work holds its reward until it is paid or refunded.',
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
    id: 'own-aeon',
    label: 'Optional: run Aeon yourself',
    title: 'bring your own aeon.',
    body: [
      'This is optional. bon travail already runs Aeon for every repository you connect, and nothing here needs you to run anything.',
      'If you would rather run the agent on your own GitHub Actions and model keys, fork Aeon, then add the bon travail Pack from your instance with bin/install-skill-pack Svector-anu/bon-travail --path aeon. It adds three skills: proofwork-loop sweeps the loop every ten minutes, proofwork-investigate reproduces a failure and writes down why, and proofwork-reproduce turns a reported bug into a failing test. Enable them in aeon.yml with var set to https://bontravail.xyz.',
      'The skills need an agent token for the bon travail they talk to. For bontravail.xyz, write to hello@bontravail.xyz and we will send one; a self-hosted bon travail uses its own AGENT_API_TOKEN. Your Aeon can investigate and describe. It cannot approve work, choose who is paid, or move money.',
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
