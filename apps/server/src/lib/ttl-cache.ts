/**
 * Tiny in-process TTL cache for public, discardable responses.
 * No Redis / lru-cache — single-process Hono is enough for Bangumi list proxies.
 */

type Entry = { value: unknown; exp: number }

const store = new Map<string, Entry>()

/** Bangumi public list TTLs (see docs/CONTEXT.md). */
export const BANGUMI_CACHE_TTL = {
  /** Calendar changes ~seasonally; 1d caps stale risk near season flips. */
  calendar: 24 * 60 * 60_000,
  /** Trending moves slowly (days); half-day is plenty. */
  trending: 12 * 60 * 60_000,
  /** Browse/search can see sudden drops; shorter than trending. */
  browse: 2 * 60 * 60_000,
} as const

const DEFAULT_MAX_ENTRIES = 200

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key)
  if (!e) return undefined
  if (Date.now() > e.exp) {
    store.delete(key)
    return undefined
  }
  // Refresh insertion order for simple LRU-ish eviction
  store.delete(key)
  store.set(key, e)
  return e.value as T
}

export function cacheSet<T>(
  key: string,
  value: T,
  ttlMs: number,
  maxEntries = DEFAULT_MAX_ENTRIES,
): void {
  if (ttlMs <= 0) return
  if (store.has(key)) store.delete(key)
  store.set(key, { value, exp: Date.now() + ttlMs })
  while (store.size > maxEntries) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

export function cacheDelete(key: string): void {
  store.delete(key)
}

/** Query `refresh=1` / `true` or Cache-Control: no-cache → bypass. */
export function wantsCacheBypass(c: {
  req: {
    query: (n: string) => string | undefined
    header: (n: string) => string | undefined
  }
}): boolean {
  const q = (c.req.query('refresh') || '').toLowerCase()
  if (q === '1' || q === 'true' || q === 'yes') return true
  const cc = (c.req.header('Cache-Control') || '').toLowerCase()
  return cc.includes('no-cache') || cc.includes('no-store')
}
