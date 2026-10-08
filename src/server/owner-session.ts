import { cookies } from 'next/headers'
import { resolveViewer, type Viewer } from './access'
import { getApp } from './container'
import { OWNER_COOKIE, ownerAuth, verifyOwnerSession } from './owner'

/** For server components: the signed-in operator or team member, or null. */
export async function consoleViewer(): Promise<Viewer | null> {
  const app = await getApp()
  const auth = ownerAuth(app.config)
  if (!auth.sessionSecret) return null
  const actor = verifyOwnerSession(auth.sessionSecret, (await cookies()).get(OWNER_COOKIE)?.value, app.clock.now())
  return actor ? resolveViewer(actor, auth, app.teams) : null
}

export async function isOwnerSession(): Promise<boolean> {
  return (await consoleViewer()) !== null
}
