import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  turbopack: { root: import.meta.dirname },
}

export default nextConfig
