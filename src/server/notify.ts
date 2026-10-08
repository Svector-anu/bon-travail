import type { AppConfig } from './config'

/**
 * Sends one line to the operator's Telegram. Best effort: an unset bot, a
 * slow API or a bad token never blocks what triggered it.
 */
export async function notifyOperator(
  config: Pick<AppConfig, 'telegramBotToken' | 'telegramChatId'>,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!config.telegramBotToken || !config.telegramChatId) return false
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegramChatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) console.error('telegram notify failed', response.status)
    return response.ok
  } catch (error) {
    console.error('telegram notify failed', error instanceof Error ? error.message : error)
    return false
  }
}

/** The message for someone who signed in with GitHub but belongs to no team yet. */
export function accessRequestMessage(login: string, attempts: number, people: number): string {
  const tries = attempts === 1 ? 'first time' : `tried ${attempts} times`
  return [
    `@${login} tried to sign in to the bon travail console but is not on a team yet (${tries}).`,
    `${people} ${people === 1 ? 'person has' : 'people have'} asked for access so far.`,
    `https://github.com/${login}`,
  ].join('\n')
}
