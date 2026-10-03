import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  turbopack: { root: import.meta.dirname },
  // PGlite ships WASM and data files; load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ['@electric-sql/pglite'],
}

export default nextConfig
