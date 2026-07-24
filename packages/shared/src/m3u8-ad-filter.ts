/**
 * HLS discontinuity-based ad filter (Kazumi / FFmpeg hls_ad_filter style).
 * Groups segments by #EXT-X-DISCONTINUITY; drops short non-main groups.
 */

export interface M3u8Segment {
  duration: number
  uri: string
  discontinuityGroup: number
  /** Raw #EXT-X-KEY line for this segment, if any (METHOD=NONE omitted) */
  keyLine?: string
}

export interface M3u8MediaPlaylist {
  segments: M3u8Segment[]
  targetDuration: number
  isVod: boolean
  /** Non-segment header lines we should preserve when rebuilding (best-effort) */
  headerLines: string[]
}

export type M3u8PlaylistKind = 'master' | 'media' | 'unknown'

export function detectM3u8Kind(content: string): M3u8PlaylistKind {
  if (/#EXT-X-STREAM-INF/i.test(content)) return 'master'
  if (/#EXTINF:/i.test(content) || /#EXT-X-TARGETDURATION/i.test(content)) {
    return 'media'
  }
  if (/#EXTM3U/i.test(content)) return 'media'
  return 'unknown'
}

/** Resolve relative URI without DOM `URL` (shared package is ES-only). */
export function resolveM3u8Url(baseUrl: string, relativeUrl: string): string {
  if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl
  const base = baseUrl.trim()
  if (!base) return relativeUrl
  try {
    // protocol-relative
    if (relativeUrl.startsWith('//')) {
      const proto = base.match(/^(https?:)/i)?.[1] || 'https:'
      return `${proto}${relativeUrl}`
    }
    const m = base.match(/^(https?:\/\/[^/?#]+)/i)
    if (!m) return relativeUrl
    const origin = m[1]!
    if (relativeUrl.startsWith('/')) return `${origin}${relativeUrl}`
    const pathBase = base.replace(/[?#].*$/, '')
    const dir = pathBase.includes('/')
      ? pathBase.slice(0, pathBase.lastIndexOf('/') + 1)
      : `${origin}/`
    // collapse ./ and simple ../
    const joined = `${dir}${relativeUrl}`
    const parts: string[] = []
    const schemeHost = joined.match(/^(https?:\/\/[^/]+)(\/.*)?$/i)
    if (!schemeHost) return relativeUrl
    const path = schemeHost[2] || '/'
    for (const seg of path.split('/')) {
      if (!seg || seg === '.') continue
      if (seg === '..') parts.pop()
      else parts.push(seg)
    }
    return `${schemeHost[1]}/${parts.join('/')}`
  } catch {
    return relativeUrl
  }
}

export function parseMediaPlaylist(
  content: string,
  baseUrl: string,
): M3u8MediaPlaylist {
  const lines = content.split(/\r?\n/)
  const segments: M3u8Segment[] = []
  const headerLines: string[] = []
  let targetDuration = 0
  let hasEndList = false
  let isExplicitVod = false
  let isLiveEvent = false
  let currentDiscontinuityGroup = 0
  let currentKeyLine: string | undefined
  let currentDuration = 0
  let seenSegment = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const n = Number(line.slice('#EXT-X-TARGETDURATION:'.length))
      if (Number.isFinite(n)) targetDuration = n
      if (!seenSegment) headerLines.push(raw)
      continue
    }
    if (line === '#EXT-X-ENDLIST') {
      hasEndList = true
      continue
    }
    if (line === '#EXT-X-PLAYLIST-TYPE:VOD') {
      isExplicitVod = true
      if (!seenSegment) headerLines.push(raw)
      continue
    }
    if (line === '#EXT-X-PLAYLIST-TYPE:EVENT') {
      isLiveEvent = true
      if (!seenSegment) headerLines.push(raw)
      continue
    }
    if (line === '#EXT-X-DISCONTINUITY') {
      currentDiscontinuityGroup++
      continue
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      if (/METHOD=NONE/i.test(line)) {
        currentKeyLine = undefined
      } else {
        // Absolute-ize KEY URI for proxy rewrite later
        currentKeyLine = line.replace(
          /URI=(["'])([^"']+)\1/i,
          (_m, q: string, u: string) => {
            try {
              return `URI=${q}${resolveM3u8Url(baseUrl, u)}${q}`
            } catch {
              return `URI=${q}${u}${q}`
            }
          },
        )
      }
      continue
    }
    if (line.startsWith('#EXTINF:')) {
      const durationStr = line.slice('#EXTINF:'.length).split(',')[0] ?? '0'
      currentDuration = Number(durationStr) || 0
      continue
    }
    if (line.startsWith('#')) {
      // Keep other headers before first segment (VERSION, MEDIA-SEQUENCE, MAP, …)
      if (!seenSegment && !line.startsWith('#EXTINF')) {
        headerLines.push(raw)
      }
      continue
    }

    // URI line
    seenSegment = true
    segments.push({
      duration: currentDuration,
      uri: resolveM3u8Url(baseUrl, line),
      discontinuityGroup: currentDiscontinuityGroup,
      keyLine: currentKeyLine,
    })
    currentDuration = 0
  }

  const isVod =
    hasEndList || isExplicitVod || (!isLiveEvent && segments.length > 0)

  return { segments, targetDuration, isVod, headerLines }
}

/**
 * Filter ad segments. Same thresholds as Kazumi M3u8AdFilter.
 */
export function filterAds(segments: M3u8Segment[]): M3u8Segment[] {
  if (segments.length === 0) return segments

  const groups = new Map<number, M3u8Segment[]>()
  for (const seg of segments) {
    const list = groups.get(seg.discontinuityGroup) || []
    list.push(seg)
    groups.set(seg.discontinuityGroup, list)
  }

  if (groups.size <= 1) return segments

  const groupDurations = new Map<number, number>()
  let maxDuration = 0
  for (const [id, segs] of groups) {
    const d = segs.reduce((sum, s) => sum + s.duration, 0)
    groupDurations.set(id, d)
    if (d > maxDuration) maxDuration = d
  }

  const adGroups = new Set<number>()
  const sortedKeys = [...groups.keys()].sort((a, b) => a - b)
  const first = sortedKeys[0]
  const last = sortedKeys[sortedKeys.length - 1]

  for (const groupId of sortedKeys) {
    const groupDuration = groupDurations.get(groupId) ?? 0
    if (groupDuration === maxDuration) continue

    let isAd = false
    if (groupDuration < maxDuration * 0.3) isAd = true
    if (
      (groupId === first || groupId === last) &&
      groupDuration < 30
    ) {
      isAd = true
    }
    if (groupDuration < 10) isAd = true
    if (isAd) adGroups.add(groupId)
  }

  if (adGroups.size === 0) return segments
  return segments.filter((s) => !adGroups.has(s.discontinuityGroup))
}

export function calculateTargetDuration(segments: M3u8Segment[]): number {
  let max = 0
  for (const s of segments) {
    if (s.duration > max) max = s.duration
  }
  return max
}

/** Rebuild media playlist; URIs left absolute (proxy layer rewrites them). */
export function buildMediaPlaylist(
  segments: M3u8Segment[],
  opts?: { targetDuration?: number; headerLines?: string[] },
): string {
  const target =
    opts?.targetDuration != null && opts.targetDuration > 0
      ? Math.ceil(opts.targetDuration)
      : Math.max(1, Math.ceil(calculateTargetDuration(segments)))

  const out: string[] = ['#EXTM3U']
  const headers = opts?.headerLines || []
  let hasVersion = false
  let hasTarget = false
  let hasSeq = false
  for (const h of headers) {
    const t = h.trim()
    if (t === '#EXTM3U') continue
    if (t.startsWith('#EXT-X-TARGETDURATION')) {
      hasTarget = true
      out.push(`#EXT-X-TARGETDURATION:${target}`)
      continue
    }
    if (t.startsWith('#EXT-X-VERSION')) hasVersion = true
    if (t.startsWith('#EXT-X-MEDIA-SEQUENCE')) hasSeq = true
    // Skip ENDLIST / DISCONTINUITY / KEY / EXTINF — rebuilt below
    if (
      t === '#EXT-X-ENDLIST' ||
      t === '#EXT-X-DISCONTINUITY' ||
      t.startsWith('#EXT-X-KEY:') ||
      t.startsWith('#EXTINF:')
    ) {
      continue
    }
    out.push(h)
  }
  if (!hasVersion) out.push('#EXT-X-VERSION:3')
  if (!hasTarget) out.push(`#EXT-X-TARGETDURATION:${target}`)
  if (!hasSeq) out.push('#EXT-X-MEDIA-SEQUENCE:0')

  let lastGroup = segments[0]?.discontinuityGroup ?? 0
  let lastKey: string | undefined

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    if (i > 0 && seg.discontinuityGroup !== lastGroup) {
      out.push('#EXT-X-DISCONTINUITY')
      lastGroup = seg.discontinuityGroup
    }
    if (seg.keyLine !== lastKey) {
      if (!seg.keyLine) {
        if (lastKey) out.push('#EXT-X-KEY:METHOD=NONE')
      } else {
        out.push(seg.keyLine)
      }
      lastKey = seg.keyLine
    }
    out.push(`#EXTINF:${seg.duration.toFixed(6)},`)
    out.push(seg.uri)
  }
  out.push('#EXT-X-ENDLIST')
  return out.join('\n') + '\n'
}

/**
 * If content is a VOD media playlist with multiple discontinuity groups,
 * drop ad-like groups. Master / live / single-group: return original.
 */
export function filterM3u8AdsIfApplicable(
  content: string,
  baseUrl: string,
): { content: string; filtered: boolean; removed: number } {
  const kind = detectM3u8Kind(content)
  if (kind !== 'media') {
    return { content, filtered: false, removed: 0 }
  }
  const playlist = parseMediaPlaylist(content, baseUrl)
  if (!playlist.isVod || playlist.segments.length === 0) {
    return { content, filtered: false, removed: 0 }
  }
  const before = playlist.segments.length
  const filteredSegs = filterAds(playlist.segments)
  const removed = before - filteredSegs.length
  if (removed <= 0 || filteredSegs.length === 0) {
    return { content, filtered: false, removed: 0 }
  }
  const next = buildMediaPlaylist(filteredSegs, {
    targetDuration: calculateTargetDuration(filteredSegs),
    headerLines: playlist.headerLines,
  })
  return { content: next, filtered: true, removed }
}
