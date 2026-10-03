import { cookies } from 'next/headers'
import { getApp } from './container'
import { OWNER_COOKIE, actorAllowed, ownerAuth, verifyOwnerSession } from './owner'

/** For server components: the signed-in engineer ("github:octocat"), or null. */
export async function ownerActor(): Promise<string | null> {
  const app = await getApp()
  const auth = ownerAuth(app.config)
  if (!auth.sessionSecret) return null
  const actor = verifyOwnerSession(auth.sessionSecret, (await cookies()).get(OWNER_COOKIE)?.value, app.clock.now())
  return actor && actorAllowed(actor, auth) ? actor : null
}

export async function isOwnerSession(): Promise<boolean> {
  return (await ownerActor()) !== null
}
