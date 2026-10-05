import { ArrowUpRight, Link2 } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { InPageLinks } from '@/components/in-page-links'

export const metadata: Metadata = {
  title: 'Introducing bon travail',
  description: 'Agents find broken code and pay humans to fix it. How it works, who decides what, and the first live run.',
}

const REPO = 'https://github.com/Svector-anu/bon-travail'
const ARCSCAN = 'https://testnet.arcscan.app'

const SECTIONS = [
  { id: 'introduction', title: 'Introduction' },
  { id: 'how-it-works', title: 'How it works' },
  { id: 'authority', title: 'Who decides what' },
  { id: 'verification', title: 'Verification' },
  { id: 'payments', title: 'Payments and escrow' },
  { id: 'first-run', title: 'First live run' },
  { id: 'why', title: 'Why this matters' },
  { id: 'with-us', title: 'Build it with us' },
  { id: 'references', title: 'References' },
]

const REFERENCES = [
  {
    id: 1,
    text: 'S. Altman, post on X, May 1, 2026, on building tools that elevate people rather than replace them.',
    href: 'https://x.com/sama/status/2050229058425045178',
  },
  {
    id: 2,
    text: 'M. Suleyman, “Towards Humanist Superintelligence,” Microsoft AI, November 2025.',
    href: 'https://www.axios.com/2025/11/06/microsoft-mustafa-suleyman-superintelligence',
  },
  {
    id: 3,
    text: 'S. Nadella, “Looking Ahead to 2026,” sn scratchpad, December 2025.',
    href: 'https://www.businesstoday.in/technology/news/story/from-ai-slop-to-substance-satya-nadella-says-2026-will-be-a-pivotal-point-for-artificial-intelligence-509335-2026-01-04',
  },
  {
    id: 4,
    text: 'A. Karpathy, on autonomous research and removing yourself as the bottleneck, March 2026.',
    href: 'https://the-decoder.com/andrej-karpathy-says-humans-are-now-the-bottleneck-in-ai-research-with-easy-to-measure-results',
  },
  {
    id: 5,
    text: 'J. Allaire, “The Agentic Economy: The Convergence of Intelligence and the Economy,” July 2026.',
    href: 'https://mpost.io/intelligence-meets-settlement-why-jeremy-allaire-argues-ai-agents-and-blockchain-are-one-economic-system/',
  },
  {
    id: 6,
    text: 'Circle launches Arc public mainnet, with USDC as gas, September 16, 2026.',
    href: 'https://crypto.news/circle-arc-mainnet-launches-with-usdc-gas/',
  },
  {
    id: 7,
    text: 'J. Micco, “Flaky Tests at Google and How We Mitigate Them,” Google Testing Blog, May 2016.',
    href: 'https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html',
  },
  {
    id: 8,
    text: 'CISQ, “The Cost of Poor Software Quality in the US: A 2022 Report,” December 2022.',
    href: 'https://www.it-cisq.org/press-releases/12-06-22',
  },
  {
    id: 9,
    text: 'Stripe, “The Developer Coefficient,” 2018.',
    href: 'https://stripe.com/files/reports/the-developer-coefficient.pdf',
  },
]

function Section({ n, id, title, children }: { n: number; id: string; title: string; children: ReactNode }) {
  return (
    <section className="card-section" id={id} aria-labelledby={`${id}-title`}>
      <header>
        <h2 id={`${id}-title`}>
          {n}. {title}
        </h2>
        <a className="card-anchor" href={`#${id}`} aria-label={`Link to ${title}`}>
          <Link2 size={16} aria-hidden />
        </a>
      </header>
      {children}
    </section>
  )
}

function Ref({ n }: { n: number }) {
  return (
    <sup className="card-ref">
      <a href={`#ref-${n}`} id={`cite-${n}`}>
        {n}
      </a>
    </sup>
  )
}

export default function IntroducingPage() {
  return (
    <div className="card-page">
      <InPageLinks within=".card-page" />
      <nav className="card-crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden>›</span>
        <span>Introducing bon travail</span>
      </nav>

      <div className="card-layout">
        <aside className="card-toc" aria-label="Contents">
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </aside>

        <article className="card-body">
          <div className="card-meta">
            <a className="btn btn-primary" href={REPO} target="_blank" rel="noreferrer">
              View source <ArrowUpRight size={15} aria-hidden />
            </a>
            <span>Published October 5, 2026</span>
          </div>
          <h1>Introducing bon travail</h1>
          <p className="card-lede">Agents find broken code and pay humans to fix it.</p>

          <Section n={1} {...SECTIONS[0]!}>
            <p>Today, we are making agents pay humans.</p>
            <p>
              bon travail is an open-source system in which an agent finds broken tests and a human is paid to fix them. The agent,
              Aeon, watches a team’s CI. When the same test fails twice, it works out why. The engineer decides whether the fix stays in
              the team or goes to a human. The repository’s own tests decide whether the fix works. The human is paid in USDC from an
              escrow on Arc testnet, with a sealed receipt.
            </p>
            <p>
              We ran this end to end on October 4, 2026. A regression was traced, handed out, fixed, merged, verified on the default
              branch, and paid onchain. A second task was refunded when its deadline passed.
            </p>
          </Section>

          <Section n={2} {...SECTIONS[1]!}>
            <p>
              The GitHub App reads workflow runs, logs, contents, and pull requests on the repositories a team connects. It never writes.
              A job and step that fail twice in a row become a finding, with GitHub’s log and the commits between the last green run and
              the first red one.
            </p>
            <p>
              Aeon then reproduces the failure in its own runner, narrows it to the first bad commit, and proposes how a fix should be
              judged. The engineer reads that and keeps the work internal, dismisses it, or hands it out with a reward and a deadline.
              Once handed out, a human claims it by opening a pull request. The tests run. The reward is released or refunded. Aeon keeps
              watching for the failure to come back.
            </p>
          </Section>

          <Section n={3} {...SECTIONS[2]!}>
            <p>Agents describe. People and tests decide. Every decision that moves money belongs to someone other than the agent.</p>
            <div className="card-table">
              <table>
                <thead>
                  <tr>
                    <th>Decision</th>
                    <th>Who decides</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Which repositories are watched</td>
                    <td>The engineer</td>
                  </tr>
                  <tr>
                    <td>Whether a finding leaves the team</td>
                    <td>The engineer</td>
                  </tr>
                  <tr>
                    <td>Reward, deadline, scope, and protected paths</td>
                    <td>The engineer, frozen at approval</td>
                  </tr>
                  <tr>
                    <td>Who may take the work</td>
                    <td>The engineer: named GitHub logins, or anyone on GitHub</td>
                  </tr>
                  <tr>
                    <td>Whether a fix works</td>
                    <td>The repository’s own GitHub Actions</td>
                  </tr>
                  <tr>
                    <td>Releasing or refunding money</td>
                    <td>The escrow contract, only after the verdict</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Aeon can trigger a sweep, read findings, and attach an investigation. Anything it sends about rewards, people, or approval
              is dropped. An agent that could choose recipients or amounts would turn a prompt injection in a log or pull request into a
              payment. Keeping it descriptive means the worst a hostile repository can do is mislead an investigation that an engineer
              then reads.
            </p>
          </Section>

          <Section n={4} {...SECTIONS[3]!}>
            <p>
              The verdict comes from GitHub’s records. The pull request has to target the right repository and branch, come from the
              claimant, and leave <code>.github/</code>, the watched workflow, and every protected path untouched. By default the fix must
              also be merged, and the run that counts is the default branch’s own run on the merge commit.
            </p>
            <p>Nothing a contributor, an engineer’s browser, or Aeon says can change that verdict.</p>
          </Section>

          <Section n={5} {...SECTIONS[4]!}>
            <p>
              Rewards sit in the ProofworkEscrow contract on Arc testnet at{' '}
              <a href={`${ARCSCAN}/address/0xe8165f9eba6f2e26b552146506abd5df05ae4dd8`} target="_blank" rel="noreferrer">
                0xe816…4dd8
              </a>
              . A task is funded when the engineer approves, released to the claimant’s wallet when the verdict passes, and refunded to
              the funder when the deadline passes. Each task can settle once.
            </p>
            <p>
              Before launch, Circle’s Arc Studio reviewed the deployed contract from its bytecode, and each finding was checked against
              the source and the live chain:
            </p>
            <div className="card-table">
              <table>
                <thead>
                  <tr>
                    <th>Finding</th>
                    <th>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Owner and operator are the same key</td>
                    <td>True. Acceptable on testnet; split before mainnet.</td>
                  </tr>
                  <tr>
                    <td>The reward cap is fixed at 1 USDC</td>
                    <td>True. It is immutable; production needs a redeploy.</td>
                  </tr>
                  <tr>
                    <td>A refund may go to the caller</td>
                    <td>False. Refunds pay the stored funder.</td>
                  </tr>
                  <tr>
                    <td>A task could pay twice</td>
                    <td>Not possible. Release and refund both require a funded task and close it first.</td>
                  </tr>
                  <tr>
                    <td>Ownership could be renounced</td>
                    <td>False. It reverts, checked live.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>The server also caps the total held in escrow at once, so a stolen operator key has a bounded blast radius.</p>
          </Section>

          <Section n={6} {...SECTIONS[5]!}>
            <p>
              On October 4, 2026 a regression was pushed to a public sandbox,{' '}
              <a href="https://github.com/Svector-anu/usdc-sdk-examples" target="_blank" rel="noreferrer">
                usdc-sdk-examples
              </a>
              . Aeon traced it to commit <code>4721bb1</code> with high confidence. The work was handed out for 0.25 USDC, fixed in{' '}
              <a href="https://github.com/Svector-anu/usdc-sdk-examples/pull/3" target="_blank" rel="noreferrer">
                pull request #3
              </a>
              , merged, verified by the repository’s tests on main, and paid onchain in{' '}
              <a href={`${ARCSCAN}/tx/0x5c300196c7345f3d387f8dfb82d8c36aea2bd08bfda72918c7b7005b9688fbbc`} target="_blank" rel="noreferrer">
                block 65461543
              </a>
              .
            </p>
            <p>
              The full record is on its <Link href="/receipt/task_004">receipt</Link>. The same loop also exercised a refund, when a
              deadline passed with no fix.
            </p>
          </Section>

          <Section n={7} {...SECTIONS[6]!}>
            <p>
              The usual story is that agents replace the engineer. The systems worth building do the opposite. They watch, explain, and
              pay a person for the work they cannot close. The person keeps the decision.
            </p>
            <p>
              That is how the people building these systems describe the goal. Altman has said the aim is tools that elevate people, not
              entities that replace them
              <Ref n={1} />. Suleyman describes superintelligence that always works in service of people
              <Ref n={2} />. Nadella calls AI a scaffolding for human potential rather than a substitute
              <Ref n={3} />. Karpathy’s version is a computable metric on one side and a human who still has to check on the other
              <Ref n={4} />. Allaire argues that agents and onchain settlement are one economy, in which agents pay for outcomes
              <Ref n={5} />, and Circle opened Arc’s public mainnet in September with USDC as its gas
              <Ref n={6} />.
            </p>
            <p>A failing test is a small instance of that economy.</p>
            <p>
              The work is already large, and it is unowned. At Google, about 1.5% of test runs were flaky, and about 84% of the
              transitions from passing to failing involved a flaky test rather than a real bug. Each one still needed a person to look
              <Ref n={7} />. Poor software quality cost the United States an estimated $2.41 trillion in 2022
              <Ref n={8} />. Developers report about 17 hours a week on maintenance, including about four on bad code, instead of new work
              <Ref n={9} />.
            </p>
            <p>
              Agents are good at finding this and explaining it. Humans are good at fixing it. Tests are good at judging it. bon travail
              connects the three, and the escrow settles the bill only after the repository’s own run passes. The agent does not choose
              the recipient, the amount, or the verdict. It cannot talk a test into passing.
            </p>
          </Section>

          <Section n={8} {...SECTIONS[7]!}>
            <p>
              bon travail is open source and live today. The next stage needs more than code, and we are looking for people to build it
              with.
            </p>
            <ul>
              <li>
                <strong>Teams.</strong> If your team has tests that keep breaking, run the loop on your repositories with us and shape
                what it becomes.
              </li>
              <li>
                <strong>Funding.</strong> Partners and grants to grow the reward pool, so the humans who fix real code are paid in real
                USDC.
              </li>
              <li>
                <strong>Builders.</strong> Engineers and agent builders who want agents that hire people rather than replace them.
              </li>
            </ul>
            <p>
              Write to us at <a href="mailto:hello@bontravail.xyz">hello@bontravail.xyz</a>, or open an issue on{' '}
              <a href={REPO} target="_blank" rel="noreferrer">
                GitHub
              </a>
              .
            </p>
          </Section>

          <Section n={9} {...SECTIONS[8]!}>
            <ol className="card-refs">
              {REFERENCES.map((r) => (
                <li key={r.id} id={`ref-${r.id}`}>
                  {r.text}{' '}
                  <a href={r.href} target="_blank" rel="noreferrer">
                    Source <ArrowUpRight size={12} aria-hidden />
                  </a>{' '}
                  <a href={`#cite-${r.id}`} aria-label={`Back to citation ${r.id}`}>
                    ↩
                  </a>
                </li>
              ))}
            </ol>
          </Section>
        </article>
      </div>
    </div>
  )
}
