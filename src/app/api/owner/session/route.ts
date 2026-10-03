import { handle, json } from '@/server/http'
import { OWNER_COOKIE } from '@/server/owner'

/** Signs the engineer out. Signing in happens through GitHub at /api/auth/github/start. */
export async function DELETE(request: Request) {
  return handle(async () => {
    const response = json({ ok: true })
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
    response.headers.append('set-cookie', `${OWNER_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`)
    return response
  })
}
