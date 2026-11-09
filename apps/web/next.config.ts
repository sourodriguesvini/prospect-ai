import type { NextConfig } from 'next';

/**
 * Cabeçalhos de segurança estáticos. A Content-Security-Policy usa nonce por requisição e
 * é montada no proxy (src/proxy.ts).
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pacotes internos são publicados como código-fonte TypeScript (ADR-0001).
  transpilePackages: [
    '@prospector/application',
    '@prospector/contracts',
    '@prospector/db',
    '@prospector/domain',
    '@prospector/ui',
  ],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
