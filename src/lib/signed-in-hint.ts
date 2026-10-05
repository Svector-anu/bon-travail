/**
 * A readable cookie that only tells the header to say "console" instead of
 * "for teams". It grants nothing: the console still checks the signed,
 * HttpOnly session on the server. Keeping the check out of the root layout
 * lets every public page be cached instead of rendered per request.
 */
export const SIGNED_IN_HINT = 'pw_signed_in'

export function signedInHintCookie(maxAgeSeconds: number, secure: boolean): string {
  return `${SIGNED_IN_HINT}=1; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`
}
