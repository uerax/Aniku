import type { Road } from '@animaku/shared'

/** Align with server PLUGIN_CACHE_TTL.chapters (12h). */
export const ROADS_CLIENT_TTL_MS = 12 * 60 * 60_000

/** sessionStorage payload for episode lists (per bangumi + plugin). */
export type RoadsCachePayload = {
  /** source detail URL → roads (+ savedAt for TTL) */
  bySource: Record<string, Road[] | RoadsSourceEntry>
}

type RoadsSourceEntry = { roads: Road[]; savedAt: number }

function key(bangumiId: number, pluginName: string): string {
  return `roads:${bangumiId}:${pluginName}`
}

function empty(): RoadsCachePayload {
  return { bySource: {} }
}

function isEntry(v: unknown): v is RoadsSourceEntry {
  return (
    Boolean(v) &&
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as RoadsSourceEntry).roads) &&
    typeof (v as RoadsSourceEntry).savedAt === 'number'
  )
}

function roadsFromStored(
  stored: Road[] | RoadsSourceEntry | undefined,
  now: number,
): Road[] | null {
  if (!stored) return null
  if (Array.isArray(stored)) {
    // Legacy: no savedAt — treat as expired so we refresh once
    return null
  }
  if (!isEntry(stored)) return null
  if (now - stored.savedAt > ROADS_CLIENT_TTL_MS) return null
  return stored.roads?.length ? stored.roads : null
}

/** Migrate legacy `Road[]` JSON to multi-source map. */
function parsePayload(raw: string): RoadsCachePayload {
  try {
    const data = JSON.parse(raw) as unknown
    if (Array.isArray(data)) {
      // Legacy: single list without source identity
      return { bySource: { __legacy__: data as Road[] } }
    }
    if (data && typeof data === 'object' && data !== null && 'bySource' in data) {
      const bySource = (data as RoadsCachePayload).bySource
      if (bySource && typeof bySource === 'object') {
        return { bySource: bySource as RoadsCachePayload['bySource'] }
      }
    }
  } catch {
    /* ignore */
  }
  return empty()
}

export function readRoadsCache(
  bangumiId: number,
  pluginName: string,
): RoadsCachePayload {
  if (!pluginName || !Number.isFinite(bangumiId)) return empty()
  try {
    const raw = sessionStorage.getItem(key(bangumiId, pluginName))
    if (!raw) return empty()
    return parsePayload(raw)
  } catch {
    return empty()
  }
}

export function writeRoadsForSource(
  bangumiId: number,
  pluginName: string,
  sourceUrl: string,
  roads: Road[],
): void {
  if (!pluginName || !sourceUrl) return
  try {
    const cur = readRoadsCache(bangumiId, pluginName)
    const next: RoadsCachePayload = {
      bySource: {
        ...cur.bySource,
        [sourceUrl]: { roads, savedAt: Date.now() },
      },
    }
    // Cap sources per bangumi+plugin to avoid sessionStorage bloat
    const keys = Object.keys(next.bySource)
    if (keys.length > 12) {
      for (const k of keys.slice(0, keys.length - 12)) {
        if (k !== sourceUrl) delete next.bySource[k]
      }
    }
    sessionStorage.setItem(key(bangumiId, pluginName), JSON.stringify(next))
  } catch {
    /* ignore quota */
  }
}

/** Drop one source (or all) so next read refetches. */
export function invalidateRoadsCache(
  bangumiId: number,
  pluginName: string,
  sourceUrl?: string,
): void {
  if (!pluginName || !Number.isFinite(bangumiId)) return
  try {
    if (!sourceUrl) {
      sessionStorage.removeItem(key(bangumiId, pluginName))
      return
    }
    const cur = readRoadsCache(bangumiId, pluginName)
    if (!(sourceUrl in cur.bySource)) return
    const next = { bySource: { ...cur.bySource } }
    delete next.bySource[sourceUrl]
    sessionStorage.setItem(key(bangumiId, pluginName), JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

/** True if any episode URL in roads matches (normalize trailing slash). */
function roadsContainPageUrl(roads: Road[], pageUrl: string): boolean {
  if (!pageUrl) return false
  const norm = (u: string) => u.replace(/\/+$/, '')
  const target = norm(pageUrl)
  for (const road of roads) {
    for (const u of road.data || []) {
      if (norm(u) === target) return true
    }
  }
  return false
}

/**
 * Resolve roads for a play page:
 * 1) exact source entry if `sourceUrl` provided (and not TTL-expired)
 * 2) any cached source whose episode list contains `pageUrl`
 * 3) sole non-legacy source / legacy list as weak fallback
 */
export function findRoadsForPlay(opts: {
  bangumiId: number
  pluginName: string
  pageUrl?: string
  sourceUrl?: string
}): Road[] | null {
  const cache = readRoadsCache(opts.bangumiId, opts.pluginName)
  const entries = Object.entries(cache.bySource)
  if (!entries.length) return null
  const now = Date.now()

  if (opts.sourceUrl) {
    const roads = roadsFromStored(cache.bySource[opts.sourceUrl], now)
    if (roads?.length) return roads
  }

  if (opts.pageUrl) {
    for (const [, stored] of entries) {
      const roads = roadsFromStored(stored, now)
      if (roads?.length && roadsContainPageUrl(roads, opts.pageUrl)) {
        return roads
      }
    }
  }

  // Weak fallback: only one real non-expired source
  const real: Road[][] = []
  for (const [k, stored] of entries) {
    if (k === '__legacy__') continue
    const roads = roadsFromStored(stored, now)
    if (roads?.length) real.push(roads)
  }
  if (real.length === 1) return real[0]
  // Legacy arrays have no TTL — do not use as fresh after migration policy
  return null
}
