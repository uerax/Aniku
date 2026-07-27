/**
 * Tiny in-process TTL cache for public / discardable responses.
 * No Redis — single-process Hono is enough for Bangumi lists + plugin results.
 */

import { createHash } from 'node:crypto'
import type { PluginRule } from '@animaku/shared'

type Entry = { value: unknown; exp: number }

const store = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()

/** Bangumi public list TTLs (see docs/CONTEXT.md). */
export const BANGUMI_CACHE_TTL = {
  /** Calendar changes ~seasonally; 1d caps stale risk near season flips. */
  calendar: 24 * 60 * 60_000,
  /** Trending moves slowly (days); half-day is plenty. */
  trending: 12 * 60 * 60_000,
  /** Browse/search can see sudden drops; shorter than trending. */
  browse: 2 * 60 * 60_000,
} as const

/** Plugin exec result TTLs (search/chapters long; resolve classified). */
export const PLUGIN_CACHE_TTL = {
  search: 4 * 60 * 60_000,
  chapters: 12 * 60 * 60_000,
  /** HLS playlists — relatively stable. */
  resolveStable: 30 * 60_000,
  /** Plain progressive mp4 without obvious signing. */
  resolveFragile: 2 * 60_000,
  /** Signed / cookie-gated — do not cache (0). */
  resolveSigned: 0,
} as const

const DEFAULT_MAX_ENTRIES = 200
const PLUGIN_MAX_ENTRIES = 400

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

/**
 * Cache read with single-flight loader. On miss (or bypass), one loader runs;
 * concurrent waiters share the same promise.
 */
export async function cacheGetOrSet<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  opts?: { bypass?: boolean; maxEntries?: number },
): Promise<{ value: T; hit: boolean }> {
  if (opts?.bypass) {
    cacheDelete(key)
  } else {
    const hit = cacheGet<T>(key)
    if (hit !== undefined) return { value: hit, hit: true }
  }

  const existing = inflight.get(key)
  if (existing) {
    const value = (await existing) as T
    return { value, hit: false }
  }

  const p = (async () => {
    try {
      const value = await loader()
      if (ttlMs > 0) {
        cacheSet(key, value, ttlMs, opts?.maxEntries ?? DEFAULT_MAX_ENTRIES)
      }
      return value
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  const value = (await p) as T
  return { value, hit: false }
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

export function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12)
}

/**
 * Stable rule identity for cache keys — name@version + hash of fields that
 * affect fetch/parse (so xpath edits without version bump still miss).
 */
export function ruleCacheId(rule: PluginRule): string {
  const parts = [
    rule.name,
    rule.version || '',
    rule.baseURL || '',
    rule.searchURL || '',
    rule.searchMode || '',
    rule.chapterMode || '',
    rule.searchList || '',
    rule.searchName || '',
    rule.searchResult || '',
    rule.chapterRoads || '',
    rule.chapterResult || '',
    rule.usePost ? '1' : '0',
    rule.adBlocker ? '1' : '0',
    JSON.stringify(rule.searchApiConfig ?? null),
    JSON.stringify(rule.chapterApiConfig ?? null),
  ]
  return `${rule.name}@${rule.version || '0'}:${shortHash(parts.join('\0'))}`
}

export function pluginCacheKey(
  op: 'search' | 'chapters' | 'resolve',
  rule: PluginRule,
  payload: string,
): string {
  return `plugin:${op}:${ruleCacheId(rule)}:${shortHash(payload)}`
}

/**
 * Resolve result TTL from playUrl / proxyUrl shape.
 * Cookie-gated and signed progressive URLs must not be shared long-lived.
 */
export function resolveCacheTtlMs(result: {
  playUrl?: string
  proxyUrl?: string
}): number {
  const play = result.playUrl || ''
  const proxy = result.proxyUrl || ''
  if (/[?&]cookie=/.test(proxy)) return PLUGIN_CACHE_TTL.resolveSigned
  // Prefer HLS even with query strings (often longer-lived than signed mp4)
  if (/\.m3u8(\?|$)/i.test(play)) return PLUGIN_CACHE_TTL.resolveStable
  if (
    /groupvideo\.photo\.qq\.com|dis_k=|dis_t=/i.test(play) ||
    /[?&](?:sign|signature|auth_key|expires|expire|token|t\d+)=/i.test(play)
  ) {
    return PLUGIN_CACHE_TTL.resolveSigned
  }
  if (/\.mp4(\?|$)/i.test(play)) return PLUGIN_CACHE_TTL.resolveFragile
  return PLUGIN_CACHE_TTL.resolveFragile
}

export { PLUGIN_MAX_ENTRIES }
