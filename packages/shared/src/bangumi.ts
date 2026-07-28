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
  /**
   * Planned episode count (wiki `eps`, or parsed from next.bgm `info` like `12话`).
   * 0 when unknown.
   */
  eps: number
  /** Chapter rows in Bangumi DB (`total_episodes`); may include SP. 0 when unknown. */
  totalEpisodes: number
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

/**
 * next.bgm.tv list payloads often only expose `info` like
 * `12话 / 2026年7月6日 / 監督…` — pull eps + air date from it.
 */
export function parseBangumiInfoMeta(info: string): {
  eps: number
  airDate: string
} {
  const text = String(info || '').trim()
  if (!text) return { eps: 0, airDate: '' }

  let eps = 0
  const epsM = text.match(/(\d+)\s*话/)
  if (epsM) {
    const n = Number(epsM[1])
    if (Number.isFinite(n) && n > 0) eps = n
  }

  let airDate = ''
  const cn = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (cn) {
    airDate = `${cn[1]}-${cn[2].padStart(2, '0')}-${cn[3].padStart(2, '0')}`
  } else {
    const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)
    if (iso) airDate = iso[1]
  }
  return { eps, airDate }
}

export type BangumiAirStatus = 'upcoming' | 'airing' | 'finished' | 'unknown'

export interface BangumiAirProgress {
  status: BangumiAirStatus
  /** Estimated main-story episodes already aired (weekly from airDate). */
  airedEpisodes: number
  eps: number
}

/**
 * Estimate broadcast progress from first air date + planned eps.
 * Bangumi has no official airing/finished enum on subjects — weekly TV is assumed.
 * Prefer computing at render time from cached `airDate`/`eps` so list TTL does not
 * freeze the badge across week boundaries.
 */
export function estimateAirProgress(
  item: Pick<BangumiItem, 'airDate' | 'eps'>,
  now: Date = new Date(),
): BangumiAirProgress {
  const eps = item.eps > 0 ? Math.trunc(item.eps) : 0
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(item.airDate || '').trim())
  if (!m) {
    return { status: 'unknown', airedEpisodes: 0, eps }
  }

  // Local calendar days — matches viewer “今天更到哪” better than UTC.
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(start.getTime())) {
    return { status: 'unknown', airedEpisodes: 0, eps }
  }
  const startDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  ).getTime()
  const todayDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()

  if (startDay > todayDay) {
    return { status: 'upcoming', airedEpisodes: 0, eps }
  }

  const days = Math.floor((todayDay - startDay) / 86_400_000)
  // Ep 1 on airDate, then +1 each 7 days (common weekly slot).
  let aired = Math.floor(days / 7) + 1
  if (aired < 1) aired = 1

  if (eps > 0) {
    if (aired >= eps) {
      return { status: 'finished', airedEpisodes: eps, eps }
    }
    return { status: 'airing', airedEpisodes: aired, eps }
  }

  // Unknown total (long-runner / unfilled wiki): still show 更新至 N 集.
  return { status: 'airing', airedEpisodes: aired, eps: 0 }
}

/** Card / meta badge text: `已完结` | `更新至03集` | `未开播` | null. */
export function airProgressLabel(
  item: Pick<BangumiItem, 'airDate' | 'eps'>,
  now: Date = new Date(),
): string | null {
  const p = estimateAirProgress(item, now)
  if (p.status === 'finished') return '已完结'
  if (p.status === 'upcoming') return '未开播'
  if (p.status === 'airing' && p.airedEpisodes > 0) {
    return `更新至${String(p.airedEpisodes).padStart(2, '0')}集`
  }
  return null
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
  const info = String(json.info ?? '')
  const fromInfo = parseBangumiInfoMeta(info)

  let airDate =
    (typeof json.date === 'string' && json.date) ||
    (json.airtime &&
      typeof (json.airtime as { date?: string }).date === 'string' &&
      (json.airtime as { date: string }).date) ||
    ''
  if (!airDate && fromInfo.airDate) airDate = fromInfo.airDate

  const epsRaw = Number(json.eps ?? 0)
  const epsFromApi = Number.isFinite(epsRaw) && epsRaw > 0 ? Math.trunc(epsRaw) : 0
  const eps = epsFromApi || fromInfo.eps || 0

  const totalRaw = Number(json.total_episodes ?? json.totalEpisodes ?? 0)
  const totalEpisodes =
    Number.isFinite(totalRaw) && totalRaw > 0 ? Math.trunc(totalRaw) : 0

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
    info,
    eps,
    totalEpisodes,
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
  // Prefer UTC calendar day so "YYYY-MM-DD" is timezone-stable across hosts
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim())
  let day: number
  if (m) {
    // Date.UTC month is 0-based
    day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  } else {
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return 0
    day = d.getUTCDay()
  }
  // JS: 0=Sun..6=Sat → Bangumi-ish Mon=1..Sun=7
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
