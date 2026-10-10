import type { TeamRole } from './github/oauth'
import { DomainError } from './errors'
import { actorAllowed, type OwnerAuth } from './owner'
import type { TeamStore } from './store/team-store'

/**
 * Who is looking at the console. Operators run bon travail and see every team;
 * everyone else sees exactly the repos GitHub says they can reach.
 */
export interface Viewer {
  /** Recorded on every decision ("github:octocat", or "owner" for the access token). */
  actor: string
  operator: boolean
  /** Team (GitHub account, lowercase) to the strongest role this person has in it. */
  teams: ReadonlyMap<string, TeamRole>
  /** Repo ("owner/name", lowercase) to this person's role on it. */
  repos: ReadonlyMap<string, TeamRole>
}

/**
 * How long a team membership read from GitHub at sign-in is trusted. Someone
 * removed from an org on GitHub loses access here within this window, then
 * signs in again to be checked afresh.
 */
export const MEMBERSHIP_TTL_MS = 12 * 60 * 60 * 1000

const repoKey = (owner: string, name: string) => `${owner}/${name}`.toLowerCase()

/** Operators by list; everyone else by the teams and repos GitHub reported at a recent sign-in. Null: not allowed in. */
export async function resolveViewer(
  actor: string,
  auth: OwnerAuth,
  teams: Pick<TeamStore, 'membershipsOf'>,
  now: number,
): Promise<Viewer | null> {
  if (actorAllowed(actor, auth)) return { actor, operator: true, teams: new Map(), repos: new Map() }
  if (!actor.startsWith('github:')) return null
  const memberships = await teams.membershipsOf(actor.slice('github:'.length), now - MEMBERSHIP_TTL_MS)
  return memberships.teams.size > 0 ? { actor, operator: false, teams: memberships.teams, repos: memberships.repos } : null
}

/** See a repo and decide on its findings: keep, dismiss, watch, release a claim. */
export function canSeeRepo(viewer: Viewer, owner: string, name: string): boolean {
  return viewer.operator || viewer.repos.has(repoKey(owner, name))
}

/** Put money behind work on a repo: operators, or admins of that very repo on GitHub. */
export function canFund(viewer: Viewer, owner: string, name: string): boolean {
  return viewer.operator || viewer.repos.get(repoKey(owner, name)) === 'admin'
}

/** Manage a team's money (funding wallet, deposits): operators, or someone who is an admin somewhere in that team. */
export function canManageTeamFunds(viewer: Viewer, team: string): boolean {
  return viewer.operator || viewer.teams.get(team.toLowerCase()) === 'admin'
}

/** Fails closed with the same answer whether the repo exists or not, so teams cannot probe each other. */
export function requireRepoAccess(viewer: Viewer, owner: string, name: string, what: string): void {
  if (!canSeeRepo(viewer, owner, name)) throw new DomainError('NOT_FOUND', `${what} not found`)
}

/** A filter for lists: which repos this viewer may see. */
export function visibleTo(viewer: Viewer): (owner: string, name: string) => boolean {
  return (owner, name) => canSeeRepo(viewer, owner, name)
}
