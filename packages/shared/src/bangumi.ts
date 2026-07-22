/** Local collect type — Kazumi CollectType (const object for better ESM interop) */
export const CollectType = {
  none: 0,
  watching: 1,
  planToWatch: 2,
  onHold: 3,
  watched: 4,
  abandoned: 5,
} as const
export type CollectType = (typeof CollectType)[keyof typeof CollectType]

export const CollectTypeLabel: Record<CollectType, string> = {
  [CollectType.none]: '未收藏',
  [CollectType.watching]: '在看',
  [CollectType.planToWatch]: '想看',
  [CollectType.onHold]: '搁置',
  [CollectType.watched]: '看过',
  [CollectType.abandoned]: '抛弃',
}

/** Bangumi official CollectionType */
export const BangumiCollectionType = {
  unknown: 0,
  planToWatch: 1,
  watched: 2,
  watching: 3,
  onHold: 4,
  abandoned: 5,
} as const
export type BangumiCollectionType =
  (typeof BangumiCollectionType)[keyof typeof BangumiCollectionType]

export function toBangumiCollectionType(
  local: CollectType,
): BangumiCollectionType | null {
  switch (local) {
    case CollectType.planToWatch:
      return BangumiCollectionType.planToWatch
    case CollectType.watched:
      return BangumiCollectionType.watched
    case CollectType.watching:
      return BangumiCollectionType.watching
    case CollectType.onHold:
      return BangumiCollectionType.onHold
    case CollectType.abandoned:
      return BangumiCollectionType.abandoned
    default:
      return null
  }
}

export function fromBangumiCollectionType(
  remote: number,
): CollectType {
  switch (remote) {
    case BangumiCollectionType.planToWatch:
      return CollectType.planToWatch
    case BangumiCollectionType.watched:
      return CollectType.watched
    case BangumiCollectionType.watching:
      return CollectType.watching
    case BangumiCollectionType.onHold:
      return CollectType.onHold
    case BangumiCollectionType.abandoned:
      return CollectType.abandoned
    default:
      return CollectType.none
  }
}

export interface BangumiTag {
  name: string
  count?: number
}

export interface BangumiItem {
  id: number
  type: number
  name: string
  nameCn: string
  summary: string
  airDate: string
  airWeekday: number
  rank: number
  images: Record<string, string>
  tags: BangumiTag[]
  alias: string[]
  ratingScore: number
  votes: number
  info?: string
}

export interface BangumiEpisode {
  id: number
  type: number
  sort: number
  name: string
  nameCn: string
  airdate: string
  ep?: number
}

export interface BangumiUser {
  id: number
  username: string
  nickname: string
  avatar?: Record<string, string>
}

export interface BangumiCollectionEntry {
  subjectId: number
  type: CollectType
  updatedAt?: string
  subject?: BangumiItem
  epStatus?: number
  rate?: number
  comment?: string
}

export function parseBangumiItem(json: Record<string, unknown>): BangumiItem {
  const rating = (json.rating as Record<string, unknown>) || {}
  const imagesRaw = json.images as Record<string, string> | undefined
  const image = typeof json.image === 'string' ? json.image : ''
  const nameCnRaw =
    (json.name_cn as string) ||
    (json.nameCN as string) ||
    (json.name as string) ||
    ''
  const airDate =
    (typeof json.date === 'string' && json.date) ||
    (json.airtime &&
      typeof (json.airtime as { date?: string }).date === 'string' &&
      (json.airtime as { date: string }).date) ||
    ''

  const tagsRaw = Array.isArray(json.tags) ? json.tags : []
  const tags: BangumiTag[] = tagsRaw
    .map((t) => {
      if (typeof t === 'string') return { name: t }
      if (t && typeof t === 'object') {
        const o = t as Record<string, unknown>
        return { name: String(o.name ?? o), count: Number(o.count ?? 0) }
      }
      return null
    })
    .filter(Boolean) as BangumiTag[]

  return {
    id: Number(json.id),
    type: Number(json.type ?? 2),
    name: String(json.name ?? ''),
    nameCn: String(nameCnRaw),
    summary: String(json.summary ?? ''),
    airDate: String(airDate),
    airWeekday: dateToWeekday(String(airDate)),
    rank: Number(rating.rank ?? 0),
    images: imagesRaw
      ? { ...imagesRaw }
      : {
          large: image,
          common: image,
          medium: image,
          small: image,
          grid: image,
        },
    tags,
    // Kazumi: parse 「别名」 from infobox (api.bgm.tv / next.bgm.tv)
    alias: parseBangumiAliases(json),
    ratingScore: Number(Number(rating.score ?? 0).toFixed(1)),
    votes: Number(rating.total ?? 0),
    info: String(json.info ?? ''),
  }
}

/**
 * Extract 别名 from Bangumi subject infobox (same as Kazumi BangumiItem.fromJson).
 * api.bgm.tv uses `value`; next.bgm.tv /p1 may use `values`.
 */
export function parseBangumiAliases(
  json: Record<string, unknown>,
): string[] {
  const infobox = json.infobox
  if (!Array.isArray(infobox)) return []
  for (const item of infobox) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (String(row.key ?? '') !== '别名') continue
    const raw = row.values ?? row.value
    if (raw == null) return []
    if (Array.isArray(raw)) {
      return raw
        .map((element) => {
          if (element && typeof element === 'object' && 'v' in element) {
            return String((element as { v: unknown }).v ?? '').trim()
          }
          return String(element ?? '').trim()
        })
        .filter((a) => a.length > 0)
    }
    const text = String(raw).trim()
    return text ? [text] : []
  }
  return []
}

function dateToWeekday(dateStr: string): number {
  if (!dateStr) return 0
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return 0
  // JS: 0=Sun..6=Sat → Bangumi-ish Mon=1..Sun=7
  const day = d.getDay()
  return day === 0 ? 7 : day
}

/** Prefer smaller sizes for list/grid cards (less decode cost). */
export function coverOf(
  item: Pick<BangumiItem, 'images'>,
  size: 'thumb' | 'large' = 'thumb',
): string {
  const images = item.images || {}
  if (size === 'large') {
    return (
      images.large ||
      images.common ||
      images.medium ||
      images.small ||
      images.grid ||
      ''
    )
  }
  return (
    images.common ||
    images.medium ||
    images.small ||
    images.grid ||
    images.large ||
    ''
  )
}
