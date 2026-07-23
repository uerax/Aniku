import type { Road } from '@aniku/shared'

/** sessionStorage payload for episode lists (per bangumi + plugin). */
export type RoadsCachePayload = {
  /** source detail URL → roads */
  bySource: Record<string, Road[]>
}

function key(bangumiId: number, pluginName: string): string {
  return `roads:${bangumiId}:${pluginName}`
}

function empty(): RoadsCachePayload {
  return { bySource: {} }
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
        return { bySource: bySource as Record<string, Road[]> }
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
        [sourceUrl]: roads,
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
 * 1) exact source entry if `sourceUrl` provided
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

  if (opts.sourceUrl && cache.bySource[opts.sourceUrl]?.length) {
    return cache.bySource[opts.sourceUrl]
  }

  if (opts.pageUrl) {
    for (const [, roads] of entries) {
      if (roads?.length && roadsContainPageUrl(roads, opts.pageUrl)) {
        return roads
      }
    }
  }

  // Weak fallback: only one real source
  const real = entries.filter(([k, v]) => k !== '__legacy__' && v?.length)
  if (real.length === 1) return real[0][1]
  if (cache.bySource.__legacy__?.length) return cache.bySource.__legacy__
  return null
}
