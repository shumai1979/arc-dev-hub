import { defineConfig } from 'vite';

// IMPORTANT: Change 'arc-hub' below to match your GitHub repository name.
// If your repo is github.com/shumai1979/arc-hub, keep it as 'arc-hub'.
// If you rename the repo, update this constant.
const REPO_NAME = 'arc-dev-hub';

export default defineConfig(({ command }) => ({
  // Dev server uses '/', production build uses '/REPO_NAME/' for GitHub Pages
  base: command === 'build' ? `/${REPO_NAME}/` : '/',

  server: {
    port: 5173,
    open: true,
    // Dev-only reverse proxy for Circle's Stablecoin Kits REST API.
    // Browser → /circle-proxy/v1/... → https://api.circle.com/v1/...
    // This sidesteps CORS because all requests are same-origin in dev.
    // In production you'll need a real backend proxy (Vercel fn, Cloudflare worker, etc.)
    proxy: {
      '/circle-proxy': {
        target: 'https://api.circle.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/circle-proxy/, '')
      }
    }
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  },
  define: {
    'process.env': {},
    global: 'globalThis'
  },
  resolve: {
    alias: {
      buffer: 'buffer',
      stream: 'stream-browserify',
      util: 'util'
    }
  }
}));
