/**
 * Omofun / 211dm adapter (isolated from generic XPath rules).
 *
 * Why dedicated:
 * - HTML search is gated by a click-through 「系统安全验证」 (verify_check + PHPSESSID)
 * - Detail URLs are `/anime/{24-hex}.html` (not suggest numeric id)
 * - Detail pages have multiple `#playlistN` roads; generic cheerio fallback
 *   merges them into one dirty list (duplicate ep labels / dead mixed URLs)
 *
 * Resolve stays on the generic engine (`player_aaaa` encrypt=1).
 *
 * Match only omofun/211dm hosts or exact rule names — never other plugins.
 */
import type {
  PluginChapterResult,
  PluginRule,
  PluginSearchResult,
  Road,
  SearchItem,
} from '@aniku/shared'
import { config } from '../config'
import { assertPublicHttpUrl, fetchPublic } from './private-host'

const DEFAULT_HOSTS = ['cn.211dm.com', 'www.omofuns.com', 'omofuns.com', '211dm.com']

/** XOR key embedded in site captcha page `refresh()` */
const VERIFY_XOR_KEY = new Uint8Array([
  0x4e, 0x3f, 0xa9, 0xc2, 0x12, 0x7d, 0x88, 0xef, 0x55, 0xaa, 0x0b, 0xcd, 0xde,
  0xad, 0xbe, 0xef,
])

export function isOmofunRule(rule: PluginRule): boolean {
  const name = (rule.name || '').toLowerCase().trim()
  if (name === 'omofun' || name === '211dm' || name === 'omofuns') return true
  try {
    const host = new URL(rule.baseURL).hostname.toLowerCase()
    return (
      host === 'cn.211dm.com' ||
      host === 'www.omofuns.com' ||
      host === 'omofuns.com' ||
      host === '211dm.com' ||
      host === 'www.211dm.com' ||
      host.endsWith('.211dm.com') ||
      host.endsWith('.omofuns.com')
    )
  } catch {
    const base = (rule.baseURL || '').toLowerCase()
    return DEFAULT_HOSTS.some((h) => base.includes(h))
  }
}

function siteOrigin(rule: PluginRule): string {
  try {
    return new URL(rule.baseURL).origin
  } catch {
    return 'https://cn.211dm.com'
  }
}

/** Same algorithm as captcha page `refresh()` → field `i` for verify_check */
export function omofunVerifyToken(nowMs = Date.now()): string {
  const stamp = String(nowMs)
  const bytes = Buffer.from(stamp, 'utf8')
  const out = Buffer.alloc(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ VERIFY_XOR_KEY[i % VERIFY_XOR_KEY.length]
  }
  return out.toString('base64')
}

function mergeSetCookie(
  existing: string,
  setCookie: string[] | undefined,
): string {
  const map = new Map<string, string>()
  const put = (pair: string) => {
    const part = pair.split(';')[0]?.trim()
    if (!part || !part.includes('=')) return
    const name = part.slice(0, part.indexOf('='))
    map.set(name, part)
  }
  for (const p of existing.split(';')) put(p.trim())
  for (const c of setCookie || []) put(c)
  return [...map.values()].join('; ')
}

function getSetCookieList(res: Response): string[] {
  const anyHeaders = res.headers as Headers & {
    getSetCookie?: () => string[]
  }
  if (typeof anyHeaders.getSetCookie === 'function') {
    return anyHeaders.getSetCookie()
  }
  const single = res.headers.get('set-cookie')
  return single ? [single] : []
}

function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** Parse search result cards → unique /anime/{hash}.html items */
export function parseOmofunSearchHtml(
  html: string,
  origin: string,
): SearchItem[] {
  const items: SearchItem[] = []
  const seen = new Set<string>()

  const push = (href: string, name: string) => {
    const title = decodeHtml(name).replace(/\s+/g, ' ').trim()
    if (!title || title.length < 1) return
    let abs: string
    try {
      abs = new URL(href, origin).toString()
    } catch {
      return
    }
    // only detail pages, not play subpaths
    if (!/\/anime\/[a-f0-9]{16,}\.html(?:\?|$)/i.test(abs)) return
    if (/\/play\//i.test(abs)) return
    const key = abs.replace(/\/$/, '').toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    items.push({ name: title, src: abs })
  }

  // <a href="/anime/hash.html" title="片名">
  const reTitle =
    /href=["'](\/anime\/[a-f0-9]+\.html)["'][^>]*\btitle=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = reTitle.exec(html))) {
    push(m[1], m[2])
  }

  // title before href
  const reTitle2 =
    /\btitle=["']([^"']+)["'][^>]*href=["'](\/anime\/[a-f0-9]+\.html)["']/gi
  while ((m = reTitle2.exec(html))) {
    push(m[2], m[1])
  }

  // text content fallback
  if (items.length < 2) {
    const reText =
      /href=["'](\/anime\/[a-f0-9]+\.html)["'][^>]*>([^<]{1,80})</gi
    while ((m = reText.exec(html))) {
      const text = m[2].replace(/\s+/g, ' ').trim()
      if (text && !/^立即播放|播放|详情/.test(text)) push(m[1], text)
    }
  }

  return items
}

async function fetchWithCookie(
  url: string,
  opts: {
    method?: string
    headers?: Record<string, string>
    body?: string
    cookie?: string
    timeoutMs?: number
  } = {},
): Promise<{ res: Response; cookie: string; text: string }> {
  assertPublicHttpUrl(url, 'Omofun URL')
  const headers: Record<string, string> = {
    'User-Agent': config.defaultUserAgent,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(opts.headers || {}),
  }
  if (opts.cookie) headers.Cookie = opts.cookie

  const res = await fetchPublic(
    url,
    {
      method: opts.method || 'GET',
      headers,
      body: opts.body,
      redirect: 'follow',
    },
    { timeoutMs: opts.timeoutMs ?? 15_000 },
  )
  const cookie = mergeSetCookie(opts.cookie || '', getSetCookieList(res))
  const text = await res.text()
  return { res, cookie, text }
}

/**
 * Pass search gate: POST /index.php/ajax/verify_check?type=search with token `i`.
 * Idempotent if already cleared for this PHPSESSID.
 */
async function ensureSearchVerified(
  origin: string,
  searchUrl: string,
  cookie: string,
  diagnostics: string[],
): Promise<string> {
  const i = omofunVerifyToken()
  const verifyUrl = `${origin}/index.php/ajax/verify_check?type=search`
  try {
    const { res, cookie: next, text } = await fetchWithCookie(verifyUrl, {
      method: 'POST',
      cookie,
      headers: {
        Referer: searchUrl,
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
      body: new URLSearchParams({ i }).toString(),
      timeoutMs: 12_000,
    })
    let code = 0
    try {
      code = Number((JSON.parse(text) as { code?: number }).code ?? 0)
    } catch {
      /* ignore */
    }
    diagnostics.push(
      code === 1
        ? '搜索验证已通过'
        : `搜索验证响应 ${res.status}: ${text.slice(0, 80)}`,
    )
    return next || cookie
  } catch (e) {
    diagnostics.push(
      `搜索验证请求失败: ${e instanceof Error ? e.message : String(e)}`,
    )
    return cookie
  }
}

export async function searchOmofun(
  rule: PluginRule,
  keyword: string,
): Promise<PluginSearchResult> {
  const diagnostics: string[] = []
  const origin = siteOrigin(rule)
  const kw = (keyword || '').trim()
  if (!kw) {
    return { pluginName: rule.name, items: [], diagnostics: ['缺少关键词'] }
  }

  const searchUrl = `${origin}/search/-------------.html?wd=${encodeURIComponent(kw)}`
  diagnostics.push(`Omofun 搜索 ${searchUrl}`)

  try {
    // 1) first hit — usually captcha HTML + PHPSESSID
    let { cookie, text, res } = await fetchWithCookie(searchUrl, {
      headers: { Referer: `${origin}/` },
    })
    if (!res.ok) {
      return {
        pluginName: rule.name,
        items: [],
        diagnostics: [...diagnostics, `搜索页 HTTP ${res.status}`],
      }
    }

    // 2) pass gate if needed, reload
    if (/系统安全验证/.test(text) || /verify_check|mac_verify|btnverify/i.test(text)) {
      diagnostics.push('检测到搜索安全验证，尝试自动放行')
      cookie = await ensureSearchVerified(origin, searchUrl, cookie, diagnostics)
      ;({ cookie, text, res } = await fetchWithCookie(searchUrl, {
        cookie,
        headers: { Referer: `${origin}/` },
      }))
      if (!res.ok) {
        return {
          pluginName: rule.name,
          items: [],
          diagnostics: [...diagnostics, `验证后搜索页 HTTP ${res.status}`],
        }
      }
    }

    if (/系统安全验证/.test(text)) {
      return {
        pluginName: rule.name,
        items: [],
        diagnostics: [
          ...diagnostics,
          '搜索仍被安全验证拦截（token/会话可能已变）',
        ],
      }
    }

    const items = parseOmofunSearchHtml(text, origin)
    diagnostics.push(`解析到 ${items.length} 条结果`)
    return {
      pluginName: rule.name,
      items,
      diagnostics: diagnostics.slice(0, 12),
    }
  } catch (e) {
    return {
      pluginName: rule.name,
      items: [],
      diagnostics: [
        ...diagnostics,
        e instanceof Error ? e.message : String(e),
      ].slice(0, 12),
    }
  }
}

function absUrl(origin: string, href: string): string {
  try {
    return new URL(href, origin).toString()
  } catch {
    return href
  }
}

/**
 * Parse detail HTML into one road per play source id.
 * Prefer tab labels (天堂 / 精品 / 暴风); fall back to 线路{sid}.
 */
export function parseOmofunChaptersHtml(
  html: string,
  origin: string,
): { roads: Road[]; diagnostics: string[] } {
  const diagnostics: string[] = []

  // <a href="#playlist3" data-toggle="tab">天堂<span>28</span></a>
  const tabLabels = new Map<string, string>()
  const tabRe =
    /href=["']#playlist(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let tm: RegExpExecArray | null
  while ((tm = tabRe.exec(html))) {
    const sid = tm[1]
    // Prefer text before <span>count</span>; drop trailing pure counts (天堂28)
    const rawInner = tm[2] || ''
    const beforeSpan = rawInner.split(/<span[\s>]/i)[0] || rawInner
    let label = decodeHtml(beforeSpan.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .replace(/\d+\s*$/g, '')
      .trim()
    if (!label) {
      label = decodeHtml(rawInner.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim()
    }
    if (sid && label) tabLabels.set(sid, label)
  }
  if (tabLabels.size) {
    diagnostics.push(
      `线路标签: ${[...tabLabels.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`,
    )
  }

  // href="/anime/{hash}/play/{sid}/{nid}.html" title="第01集"
  type Ep = { sid: string; nid: number; url: string; name: string }
  const bySid = new Map<string, Map<string, Ep>>()

  const playRe =
    /href=["'](\/anime\/[a-f0-9]+\/play\/(\d+)\/(\d+)\.html)["']([^>]*)>/gi
  let pm: RegExpExecArray | null
  while ((pm = playRe.exec(html))) {
    const path = pm[1]
    const sid = pm[2]
    const nid = Number(pm[3])
    if (!sid || !Number.isFinite(nid)) continue
    const attrs = pm[4] || ''
    const title =
      (attrs.match(/\btitle=["']([^"']+)["']/i) || [])[1] ||
      (attrs.match(/\bdata-num=["']([^"']+)["']/i) || [])[1] ||
      ''
    const name =
      decodeHtml(title).replace(/\s+/g, ' ').trim() || `第${nid}集`
    const url = absUrl(origin, path)
    if (!bySid.has(sid)) bySid.set(sid, new Map())
    // first wins (page order); skip exact URL dupes inside same sid
    const bag = bySid.get(sid)!
    if (!bag.has(url)) bag.set(url, { sid, nid, url, name })
  }

  if (!bySid.size) {
    diagnostics.push('详情页未匹配到 /anime/.../play/{sid}/{nid}.html')
    return { roads: [], diagnostics }
  }

  // Preserve tab order when possible, then remaining sids numeric
  const orderedSids: string[] = []
  for (const sid of tabLabels.keys()) {
    if (bySid.has(sid)) orderedSids.push(sid)
  }
  for (const sid of [...bySid.keys()].sort(
    (a, b) => Number(a) - Number(b) || a.localeCompare(b),
  )) {
    if (!orderedSids.includes(sid)) orderedSids.push(sid)
  }

  const roads: Road[] = []
  for (const sid of orderedSids) {
    const eps = [...(bySid.get(sid)?.values() || [])].sort(
      (a, b) => a.nid - b.nid || a.url.localeCompare(b.url),
    )
    if (!eps.length) continue
    const label =
      tabLabels.get(sid) ||
      (orderedSids.length === 1 ? '默认' : `线路${sid}`)
    roads.push({
      name: label,
      data: eps.map((e) => e.url),
      identifier: eps.map((e) => e.name),
    })
  }

  diagnostics.push(
    `解析 ${roads.length} 条线路 / ${roads.reduce((n, r) => n + r.data.length, 0)} 集`,
  )
  return { roads, diagnostics }
}

export async function chaptersOmofun(
  rule: PluginRule,
  source: string,
): Promise<PluginChapterResult> {
  const diagnostics: string[] = []
  const origin = siteOrigin(rule)
  let pageUrl: string
  try {
    pageUrl = new URL(source, origin).toString()
  } catch {
    return {
      pluginName: rule.name,
      roads: [],
      diagnostics: ['详情 URL 无效'],
    }
  }

  // Detail pages are not behind the search captcha in practice.
  try {
    const { res, text } = await fetchWithCookie(pageUrl, {
      headers: {
        Referer: rule.referer || `${origin}/`,
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
    })
    if (!res.ok) {
      return {
        pluginName: rule.name,
        roads: [],
        diagnostics: [`详情页 HTTP ${res.status}`],
      }
    }
    if (/系统安全验证/.test(text)) {
      diagnostics.push('详情页出现安全验证（少见），尝试放行后重试')
      // best-effort: same verify endpoint sometimes clears session broadly
      let cookie = ''
      const first = await fetchWithCookie(pageUrl, {
        headers: { Referer: `${origin}/` },
      })
      cookie = first.cookie
      cookie = await ensureSearchVerified(origin, pageUrl, cookie, diagnostics)
      const retry = await fetchWithCookie(pageUrl, {
        cookie,
        headers: { Referer: `${origin}/` },
      })
      if (!retry.res.ok || /系统安全验证/.test(retry.text)) {
        return {
          pluginName: rule.name,
          roads: [],
          diagnostics: [
            ...diagnostics,
            '详情页仍被验证拦截',
          ].slice(0, 12),
        }
      }
      const parsed = parseOmofunChaptersHtml(retry.text, origin)
      return {
        pluginName: rule.name,
        roads: parsed.roads,
        diagnostics: [...diagnostics, ...parsed.diagnostics].slice(0, 12),
      }
    }

    const parsed = parseOmofunChaptersHtml(text, origin)
    return {
      pluginName: rule.name,
      roads: parsed.roads,
      diagnostics: [...diagnostics, ...parsed.diagnostics].slice(0, 12),
    }
  } catch (e) {
    return {
      pluginName: rule.name,
      roads: [],
      diagnostics: [
        ...diagnostics,
        e instanceof Error ? e.message : String(e),
      ].slice(0, 12),
    }
  }
}
