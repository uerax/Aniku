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
 */
function resolveWebRootRel(): string | null {
  const env = process.env.WEB_DIST?.trim()
  const candidates = [
    env ? resolve(process.cwd(), env) : '',
    env && !env.startsWith('.') ? resolve(env) : '',
    resolve(process.cwd(), 'public'),
    resolve(process.cwd(), 'apps/web/dist'),
    resolve(process.cwd(), '../web/dist'),
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
serve({ fetch: app.fetch, port: config.port, hostname: config.host })
