import type { Context, Next } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { config } from '../config'
import { isPrivateHost } from './private-host'

/** localhost / 127.x / [::1] for browser Origins */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin)
    const h = u.hostname.toLowerCase()
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '[::1]' ||
      h === '::1'
    )
  } catch {
    return false
  }
}

export function isCorsOriginAllowed(origin: string | undefined | null): boolean {
  if (!origin) return true // same-origin / curl / server-to-server
  if (config.corsOpen) return true
  if (isLoopbackOrigin(origin)) return true
  if (config.corsOrigins.includes(origin)) return true
  return false
}

/** Hono cors `origin` callback value */
export function corsOriginDecision(origin: string): string | undefined {
  if (isCorsOriginAllowed(origin)) return origin
  // Disallow: omit ACAO
  return undefined
}

function normalizeRemoteAddress(addr: string | undefined): string {
  if (!addr) return ''
  // Node may give ::ffff:127.0.0.1
  if (addr.startsWith('::ffff:')) return addr.slice(7)
  if (addr.startsWith('[') && addr.endsWith(']')) return addr.slice(1, -1)
  return addr
}

export function clientRemoteAddress(c: Context): string {
  try {
    const info = getConnInfo(c)
    return normalizeRemoteAddress(info.remote.address)
  } catch {
    return ''
  }
}

/**
 * Whether this request may use open-proxy style APIs (media + plugin exec).
 * Default: loopback / private LAN only (safe for local + Docker LAN).
 * PUBLIC_PROXY=1 → all clients.
 * PROXY_TOKEN set → also allow matching header.
 */
export function canUseOpenProxy(c: Context): boolean {
  if (config.publicProxy) return true

  const token = config.proxyToken
  if (token) {
    const hdr =
      c.req.header('x-aniku-proxy-token') ||
      c.req.header('x-proxy-token') ||
      ''
    if (hdr && hdr === token) return true
    const q = c.req.query('proxyToken') || c.req.query('token') || ''
    if (q && q === token) return true
  }

  const ip = clientRemoteAddress(c)
  if (!ip) {
    // Unknown remote — allow only if Origin is allowlisted (browser same-site dev)
    const origin = c.req.header('origin')
    return isCorsOriginAllowed(origin)
  }
  if (isPrivateHost(ip)) return true
  return false
}

/** Middleware for media proxy + plugin search/chapters/resolve */
export async function requireLocalOrToken(c: Context, next: Next) {
  if (canUseOpenProxy(c)) return next()
  return c.json(
    {
      error: 'forbidden',
      message:
        '媒体/规则代理仅允许本机或局域网访问。公网部署请设置 PUBLIC_PROXY=1，或配置 PROXY_TOKEN。',
    },
    403,
  )
}
