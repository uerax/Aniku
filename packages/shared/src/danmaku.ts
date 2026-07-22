export type DanmakuMode = 'rtl' | 'top' | 'bottom'

export interface DanmakuComment {
  mode: DanmakuMode
  text: string
  time: number
  style?: { color?: string }
  source?: string
}

export interface DanmakuAnime {
  animeId: number
  animeTitle: string
  bangumiId?: string
  episodeCount?: number
  typeDescription?: string
  imageUrl?: string
}

export interface DanmakuEpisode {
  episodeId: number
  episodeTitle: string
}

export interface DanmakuSettings {
  enabled: boolean
  opacity: number
  fontSize: number
  speed: number
  area: number
  showTop: boolean
  showBottom: boolean
  showScroll: boolean
  showColor: boolean
  filters: string[]
  timeOffset: number
}

export const defaultDanmakuSettings: DanmakuSettings = {
  enabled: true,
  opacity: 0.85,
  fontSize: 1,
  speed: 1,
  area: 0.5,
  showTop: true,
  showBottom: false,
  showScroll: true,
  showColor: true,
  filters: [],
  timeOffset: 0,
}

/** Map bilibili / dandan type codes → ironkinoko modes */
const MODE_MAP: Record<string, DanmakuMode> = {
  '1': 'rtl',
  '2': 'rtl',
  '3': 'rtl',
  '4': 'bottom',
  '5': 'top',
  '6': 'rtl',
}

/** Parse dandan raw comment p field */
export function parseDanmakuComments(
  comments: { m: string; p: string }[],
): DanmakuComment[] {
  return comments
    .map((o) => {
      const [time, type, color, source] = o.p.split(',')
      return {
        mode: MODE_MAP[type] || 'rtl',
        text: o.m,
        time: parseFloat(time),
        style: { color: colorToHex(color) },
        source: source || '',
      } satisfies DanmakuComment
    })
    .sort((a, b) => a.time - b.time)
}

/**
 * Parse bilibili / pakku style danmaku XML.
 * Each `<d p="time,mode,fontSize,color,...">text</d>`
 * (same format agefans-enhance `parsePakkuDanmakuXML` expects)
 */
export function parseDanmakuXml(xml: string): DanmakuComment[] {
  const out: DanmakuComment[] = []
  // tolerant: allow attributes order and whitespace
  const re = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const p = m[1]
    const text = decodeXmlEntities(m[2]).trim()
    if (!text) continue
    const parts = p.split(',')
    const time = parseFloat(parts[0] || '0')
    const type = parts[1] || '1'
    const color = parts[3]
    if (!Number.isFinite(time)) continue
    out.push({
      mode: MODE_MAP[type] || 'rtl',
      text,
      time,
      style: { color: colorToHex(color) },
      source: 'xml',
    })
  }
  return out.sort((a, b) => a.time - b.time)
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&amp;/g, '&')
}

function colorToHex(color: string | undefined): string {
  const n = parseInt(color || '16777215', 10)
  if (Number.isNaN(n)) return '#ffffff'
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`
}

/** Extract BV id from raw input (url or bare BV…) */
export function extractBvid(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  const m = s.match(/BV[0-9A-Za-z]+/)
  return m ? m[0] : null
}
