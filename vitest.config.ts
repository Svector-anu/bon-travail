import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    // The first in-memory Postgres in each worker loads its WASM build (several seconds).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
