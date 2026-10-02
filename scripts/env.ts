import { existsSync } from 'node:fs'

/** Scripts read the same env files as `next dev`; real env vars win. */
export function loadLocalEnv(): void {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) process.loadEnvFile(file)
  }
}
