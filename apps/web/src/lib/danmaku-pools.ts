import type { DanmakuComment } from '@aniku/shared'

/** Independent comment pools that can be shown / hidden without reloading */
export type DanmakuPoolId = 'dandan' | 'bilibili' | 'upload'

export const DANMAKU_POOL_ORDER: DanmakuPoolId[] = [
  'dandan',
  'bilibili',
  'upload',
]

export const DANMAKU_POOL_LABEL: Record<DanmakuPoolId, string> = {
  dandan: '弹弹',
  bilibili: 'B站',
  upload: '用户上传',
}

export type DanmakuPoolSlice = {
  comments: DanmakuComment[]
  enabled: boolean
  /** short label e.g. file name / bvid */
  meta?: string
}

export type DanmakuPools = Record<DanmakuPoolId, DanmakuPoolSlice>

export type DanmakuSourceChip = {
  id: DanmakuPoolId
  label: string
  count: number
  enabled: boolean
  /** has any comments loaded */
  loaded: boolean
  meta?: string
}

export function emptyDanmakuPools(): DanmakuPools {
  return {
    dandan: { comments: [], enabled: true },
    bilibili: { comments: [], enabled: true },
    upload: { comments: [], enabled: true },
  }
}

function commentKey(c: DanmakuComment): string {
  return `${c.time}\0${c.mode}\0${c.text}\0${c.style?.color || ''}`
}

/** Dedupe by time+mode+text; keep earlier order then sort by time */
export function mergeComments(
  existing: DanmakuComment[],
  incoming: DanmakuComment[],
): DanmakuComment[] {
  if (!incoming.length) return existing
  if (!existing.length) {
    return [...incoming].sort((a, b) => a.time - b.time)
  }
  const seen = new Set(existing.map(commentKey))
  const extra: DanmakuComment[] = []
  for (const c of incoming) {
    const k = commentKey(c)
    if (seen.has(k)) continue
    seen.add(k)
    extra.push(c)
  }
  if (!extra.length) return existing
  return [...existing, ...extra].sort((a, b) => a.time - b.time)
}

export function tagCommentsPool(
  comments: DanmakuComment[],
  pool: DanmakuPoolId,
): DanmakuComment[] {
  return comments.map((c) => ({
    ...c,
    // keep original source if present; pool id is tracked by the pools map
    source: c.source || pool,
  }))
}

/**
 * Write into one pool.
 * - replace: used for 弹弹 re-match / re-pick episode
 * - append: default for B站 / 本地 XML import
 * Newly written pool is auto-enabled.
 */
export function writePool(
  pools: DanmakuPools,
  id: DanmakuPoolId,
  comments: DanmakuComment[],
  mode: 'replace' | 'append',
  meta?: string,
): DanmakuPools {
  const tagged = tagCommentsPool(comments, id)
  const prev = pools[id]
  const nextComments =
    mode === 'append' ? mergeComments(prev.comments, tagged) : tagged
  return {
    ...pools,
    [id]: {
      comments: nextComments,
      enabled: true,
      meta: meta !== undefined ? meta : prev.meta,
    },
  }
}

export function togglePool(
  pools: DanmakuPools,
  id: DanmakuPoolId,
): DanmakuPools {
  const slice = pools[id]
  return {
    ...pools,
    [id]: { ...slice, enabled: !slice.enabled },
  }
}

/** Comments actually drawn on the player (enabled pools only) */
export function flattenEnabledPools(pools: DanmakuPools): DanmakuComment[] {
  const out: DanmakuComment[] = []
  for (const id of DANMAKU_POOL_ORDER) {
    const slice = pools[id]
    if (!slice.enabled || !slice.comments.length) continue
    out.push(...slice.comments)
  }
  return out.sort((a, b) => a.time - b.time)
}

export function totalLoadedCount(pools: DanmakuPools): number {
  let n = 0
  for (const id of DANMAKU_POOL_ORDER) n += pools[id].comments.length
  return n
}

export function enabledCount(pools: DanmakuPools): number {
  return flattenEnabledPools(pools).length
}

export function sourceChips(pools: DanmakuPools): DanmakuSourceChip[] {
  return DANMAKU_POOL_ORDER.map((id) => ({
    id,
    label: DANMAKU_POOL_LABEL[id],
    count: pools[id].comments.length,
    enabled: pools[id].enabled,
    loaded: pools[id].comments.length > 0,
    meta: pools[id].meta,
  }))
}

export function poolsStatusLine(pools: DanmakuPools, fallback = '—'): string {
  const parts = DANMAKU_POOL_ORDER.filter((id) => pools[id].comments.length).map(
    (id) => {
      const s = pools[id]
      const on = s.enabled ? '' : '·关'
      const meta = s.meta ? ` ${s.meta}` : ''
      return `${DANMAKU_POOL_LABEL[id]}${meta} ${s.comments.length}${on}`
    },
  )
  if (!parts.length) return fallback
  const drawn = enabledCount(pools)
  return `${parts.join(' · ')} · 显示 ${drawn}`
}
