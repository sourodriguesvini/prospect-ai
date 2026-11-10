import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * Build para a instalação local (scripts/app/instalar.mjs, `pnpm app:install`): servidor
 * autônomo que roda fora do repositório. Fora disso, `next dev`/`next start` seguem iguais.
 */
const standalone = process.env.PROSPECTOR_STANDALONE === '1';
const monorepoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Cabeçalhos de segurança estáticos. A Content-Security-Policy usa nonce por requisição e
 * é montada no proxy (src/proxy.ts), que também recusa hosts não locais. Sem HSTS: o app
 * roda em http://127.0.0.1 e não é publicado (ADR-0007).
 */
const securityHeaders = [
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
  ...(standalone ? { output: 'standalone' as const, outputFileTracingRoot: monorepoRoot } : {}),
  // Pacotes internos são publicados como código-fonte TypeScript (ADR-0001).
  transpilePackages: [
    '@prospector/agents',
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
