import { existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { config } from './config'
import { bangumiRoutes } from './routes/bangumi'
import { danmakuRoutes } from './routes/danmaku'
import { bilibiliDanmakuRoutes } from './routes/bilibili-danmaku'
import { pluginRoutes } from './routes/plugin'
import { pluginCatalogRoutes } from './routes/plugin-catalog'
import { mediaRoutes } from './routes/media'

/**
 * Resolve SPA build output. @hono/node-server serveStatic only accepts
 * roots relative to process.cwd(), so we convert absolute → relative.
 *
 * Layouts we must cover:
 * - Docker: WORKDIR /app, SPA at /app/public, but `pnpm --filter @aniku/server start`
 *   sets cwd to /app/apps/server → WEB_DIST=public must still resolve via ../../public
 * - Local prod: cwd apps/server, SPA at apps/web/dist
 * - cwd monorepo root: public/ or apps/web/dist
 */
function resolveWebRootRel(): string | null {
  const env = process.env.WEB_DIST?.trim()
  const isAbs =
    !!env && (env.startsWith('/') || /^[A-Za-z]:[\\/]/.test(env))
  const candidates = [
    // Explicit WEB_DIST (absolute or relative to cwd)
    isAbs ? resolve(env!) : '',
    env ? resolve(process.cwd(), env) : '',
    // Docker / monorepo root public when cwd is apps/server (pnpm filter)
    resolve(process.cwd(), '../../public'),
    resolve(process.cwd(), 'public'),
    resolve(process.cwd(), 'apps/web/dist'),
    resolve(process.cwd(), '../web/dist'),
    // From this file: apps/server/src → …
    resolve(import.meta.dirname, '../../../public'),
    resolve(import.meta.dirname, '../../web/dist'),
  ].filter(Boolean)

  for (const abs of candidates) {
    if (existsSync(join(abs, 'index.html'))) {
      const rel = relative(process.cwd(), abs)
      // serveStatic rejects absolute paths; empty relative means cwd itself
      return rel === '' ? '.' : rel
    }
  }
  return null
}

const app = new Hono()

app.use('*', logger())
app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
)

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    // Server always has a danmaku credential path (env or agefans fallback)
    danmakuConfigured: true,
    danmakuUsingFallback: !(
      config.dandanAppId?.trim() && config.dandanAppSecret?.trim()
    ),
  }),
)

app.route('/api/bangumi', bangumiRoutes)
app.route('/api/danmaku', danmakuRoutes)
app.route('/api/danmaku', bilibiliDanmakuRoutes)
app.route('/api/plugin', pluginRoutes)
app.route('/api/plugin', pluginCatalogRoutes)
app.route('/api/media', mediaRoutes)

// Production: one process serves API + Vite build (same origin → no /api proxy needed)
const webRoot = resolveWebRootRel()
if (webRoot) {
  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api')) return next()
    return serveStatic({ root: webRoot })(c, next)
  })
  // SPA fallback (client routes like /subject/123)
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api')) return next()
    return serveStatic({ root: webRoot, path: 'index.html' })(c, next)
  })
  console.log(`serving web SPA from ${webRoot}/ (cwd=${process.cwd()})`)
} else {
  console.log(
    'no web dist found (set WEB_DIST or build apps/web) — API-only mode',
  )
}

app.onError((err, c) => {
  console.error(err)
  const message = err instanceof Error ? err.message : 'Internal Server Error'
  return c.json({ error: 'internal_error', message }, 500)
})

console.log(`aniku server listening on http://${config.host}:${config.port}`)
const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
})

// @hono/node-server returns Node http.Server — surface bind failures clearly
if (server && typeof (server as { on?: unknown }).on === 'function') {
  ;(server as import('node:http').Server).on('error', (err: NodeJS.ErrnoException) => {
    console.error('[server] listen error:', err.code || err.message, err)
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[server] port ${config.port} is already in use. Stop the other process or change PORT in .env`,
      )
    }
    process.exit(1)
  })
}

// Unbuffered diagnostics if the process is still alive without accepting traffic
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[server] unhandledRejection', err)
})
