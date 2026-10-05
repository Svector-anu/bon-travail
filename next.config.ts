import type { NextConfig } from 'next'

const DOCS_HOST = 'docs.bontravail.xyz'
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
  // docs.bontravail.xyz is the docs page, with a short link per section to share.
  async rewrites() {
    // beforeFiles: '/' is the landing page, so the rewrite has to run before page matching.
    return { beforeFiles: [{ source: '/', has: [{ type: 'host', value: DOCS_HOST }], destination: '/docs' }], afterFiles: [], fallback: [] }
  },
  async redirects() {
    return Object.entries(DOCS_SECTIONS).map(([path, section]) => ({
      source: `/${path}`,
      has: [{ type: 'host' as const, value: DOCS_HOST }],
      destination: `https://${DOCS_HOST}/#${section}`,
      permanent: false,
    }))
  },
}

export default nextConfig
