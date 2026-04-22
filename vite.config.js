import { defineConfig } from 'vite';
import inject from '@rollup/plugin-inject';

const REPO_NAME = 'arc-dev-hub';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${REPO_NAME}/` : '/',

  plugins: [
    // Inject Buffer as a global in every module that references it.
    // Required because @circle-fin/app-kit uses Buffer as an implicit global
    // (Node.js built-in) which doesn't exist in the browser.
    inject({
      Buffer: ['buffer', 'Buffer'],
    }),
  ],

  server: {
    port: 5173,
    open: true,
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
    },
    include: ['buffer']
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
