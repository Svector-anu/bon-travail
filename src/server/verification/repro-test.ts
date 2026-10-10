import { createHash } from 'node:crypto'

/**
 * Line endings and trailing whitespace change when a test is copied from a
 * web page into an editor; the code itself must not. The digest ignores the
 * first and catches the second.
 */
export function normalizeReproTest(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

export function reproTestDigest(content: string): string {
  return createHash('sha256').update(normalizeReproTest(content)).digest('hex')
}
