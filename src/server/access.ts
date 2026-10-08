import type { TeamRole } from './github/oauth'
import { DomainError } from './errors'
import { actorAllowed, type OwnerAuth } from './owner'
import type { TeamStore } from './store/team-store'

/**
 * Who is looking at the console. Operators run bon travail and see every team;
 * everyone else sees only the teams GitHub says they belong to.
 */
export interface Viewer {
  /** Recorded on every decision ("github:octocat", or "owner" for the access token). */
  actor: string
  operator: boolean
  /** Team (GitHub account, lowercase) to role. */
  teams: ReadonlyMap<string, TeamRole>
}

const teamOf = (repoOwner: string) => repoOwner.toLowerCase()

/** Operators by list; everyone else by the teams GitHub reported at their last sign-in. Null: not allowed in. */
export async function resolveViewer(actor: string, auth: OwnerAuth, teams: Pick<TeamStore, 'membershipsOf'>): Promise<Viewer | null> {
  if (actorAllowed(actor, auth)) return { actor, operator: true, teams: new Map() }
  if (!actor.startsWith('github:')) return null
  const memberships = await teams.membershipsOf(actor.slice('github:'.length))
  return memberships.size > 0 ? { actor, operator: false, teams: memberships } : null
}

export function canSeeRepo(viewer: Viewer, repoOwner: string): boolean {
  return viewer.operator || viewer.teams.has(teamOf(repoOwner))
}

/** Keep a finding internal, dismiss it, watch a repo, release a claim. */
export function canDecide(viewer: Viewer, repoOwner: string): boolean {
  return canSeeRepo(viewer, repoOwner)
}

/** Put money behind work: operators, or the team's own admins (within the team budget). */
export function canFund(viewer: Viewer, repoOwner: string): boolean {
  return viewer.operator || viewer.teams.get(teamOf(repoOwner)) === 'admin'
}

/** Fails closed with the same answer whether the repo exists or not, so teams cannot probe each other. */
export function requireRepoAccess(viewer: Viewer, repoOwner: string, what: string): void {
  if (!canSeeRepo(viewer, repoOwner)) throw new DomainError('NOT_FOUND', `${what} not found`)
}

/** The team ids a viewer is limited to, or null for operators, who see everything. */
export function visibleTeams(viewer: Viewer): ReadonlySet<string> | null {
  return viewer.operator ? null : new Set(viewer.teams.keys())
}

export function visibleTo(viewer: Viewer) {
  const teams = visibleTeams(viewer)
  return (repoOwner: string) => teams === null || teams.has(teamOf(repoOwner))
}
