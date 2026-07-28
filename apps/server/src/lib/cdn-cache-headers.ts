/**
 * CDN-oriented cache headers for public GET proxies (danmaku).
 * Origin does not keep large bodies in process memory — Cloudflare (or any
 * shared cache that honors s-maxage / CDN-Cache-Control) holds them at the edge.
 *
 * Requires: orange-cloud proxy + a Cache Rule that allows caching these paths
 * (CF does not cache /api/* by default even with Cache-Control).
 */

/** Edge TTL for danmaku GET success responses (30 minutes). */
export const DANMAKU_CDN_S_MAXAGE_SEC = 30 * 60

type HeaderSetter = {
  header: (name: string, value: string) => unknown
}

/**
 * @param bypass — `?refresh=1` or Cache-Control: no-cache from client
 */
export function setDanmakuCdnHeaders(c: HeaderSetter, bypass: boolean): void {
  if (bypass) {
    c.header('Cache-Control', 'private, no-store')
    c.header('CDN-Cache-Control', 'no-store')
    c.header('Cloudflare-CDN-Cache-Control', 'no-store')
    return
  }
  // Browsers: max-age=0 (revalidate / don't keep multi‑MB bodies).
  // Shared caches (CF): s-maxage + vendor CDN-Cache-Control = 30 min.
  const edge = DANMAKU_CDN_S_MAXAGE_SEC
  c.header('Cache-Control', `public, max-age=0, s-maxage=${edge}`)
  c.header('CDN-Cache-Control', `max-age=${edge}`)
  c.header('Cloudflare-CDN-Cache-Control', `max-age=${edge}`)
}
