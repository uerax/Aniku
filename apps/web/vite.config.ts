import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** Monorepo root (…/aniku) — where `.env` / `.env.example` live */
const repoRoot = path.resolve(__dirname, '../..')

function envInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export default defineConfig(({ mode }) => {
  // Merge: shell env > apps/web/.env* > repo-root/.env* (later loadEnv does not override)
  const fileEnv = {
    ...loadEnv(mode, repoRoot, ''),
    ...loadEnv(mode, __dirname, ''),
  }
  const get = (key: string) => process.env[key] ?? fileEnv[key]

  const webPort = envInt(get('WEB_DEV_PORT'), 5173)
  // Bind address (0.0.0.0 = all interfaces). Default loopback for safer local dev.
  const webHost = get('WEB_HOST') || '127.0.0.1'
  // HMR websocket must be a host the browser can open — not 0.0.0.0
  const hmrHost =
    get('WEB_HMR_HOST') ||
    (webHost === '0.0.0.0' || webHost === '::' ? '127.0.0.1' : webHost)

  const apiPort = envInt(get('PORT'), 8787)
  // Proxy connects to the API process; 0.0.0.0 is not a valid client target
  const apiProxyHost = get('API_PROXY_HOST') || '127.0.0.1'
  const apiProxyTarget =
    get('API_PROXY_TARGET') || `http://${apiProxyHost}:${apiPort}`

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        // Workspace package exports raw TS; pin path so Vite always finds it
        // even if node_modules links are stale after rename/reinstall.
        '@aniku/shared': path.resolve(repoRoot, 'packages/shared/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (id.includes('hls.js')) return 'hls'
            if (id.includes('@ironkinoko/danmaku')) return 'danmaku'
            if (id.includes('anime4k-webgpu')) return 'anime4k'
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/') ||
              id.includes('react-router')
            ) {
              return 'react-vendor'
            }
            if (id.includes('@tanstack/react-query') || id.includes('zustand')) {
              return 'data-vendor'
            }
          },
        },
      },
    },
    server: {
      host: webHost,
      port: webPort,
      strictPort: true,
      // Explicit HMR so the client always targets the same host:port as the page
      // (avoids wrong websocket host when opened via localhost vs 127.0.0.1)
      hmr: {
        protocol: 'ws',
        host: hmrHost,
        port: webPort,
        clientPort: webPort,
      },
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: webHost,
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
