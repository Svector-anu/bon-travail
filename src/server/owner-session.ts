import { cookies } from 'next/headers'
import { getApp } from './container'
import { OWNER_COOKIE, verifyOwnerSession } from './owner'

/** For server components: is the person viewing this page the signed-in engineer? */
export async function isOwnerSession(): Promise<boolean> {
  const app = await getApp()
  const token = app.config.ownerAccessToken
  if (!token) return false
  return verifyOwnerSession(token, (await cookies()).get(OWNER_COOKIE)?.value, app.clock.now())
}
