import type { NextConfig } from 'next'

const DOCS_HOST = 'docs.bontravail.xyz'
const SITE = 'https://bontravail.xyz'
const DOCS_SECTIONS: Record<string, string> = {
  aeon: 'own-aeon',
  teams: 'engineers',
  humans: 'contributors',
  verification: 'verification',
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  turbopack: { root: import.meta.dirname },
  // PGlite ships WASM and data files; load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ['@electric-sql/pglite'],
  // docs.bontravail.xyz is a short, shareable door into the docs: each path forwards to its section.
  async redirects() {
    const docsHost = [{ type: 'host' as const, value: DOCS_HOST }]
    return [
      { source: '/', has: docsHost, destination: `${SITE}/docs`, permanent: false },
      ...Object.entries(DOCS_SECTIONS).map(([path, section]) => ({
        source: `/${path}`,
        has: docsHost,
        destination: `${SITE}/docs#${section}`,
        permanent: false,
      })),
    ]
  },
}

export default nextConfig
