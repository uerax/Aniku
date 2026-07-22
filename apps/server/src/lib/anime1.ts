/**
 * Anime1.me adapter (isolated from generic XPath/static resolve).
 *
 * Flow:
 *  search   → GET /?s= + s2t keywords, group by category
 *  chapters → GET /?cat={id} list of episode posts
 *  resolve  → episode HTML data-apireq → POST https://v.anime1.me/api
 *             → progressive mp4 + path-scoped cookies → media proxy
 */
import type {
  PluginChapterResult,
  PluginRule,
  PluginSearchResult,
  ResolvePlayResult,
  Road,
  SearchItem,
} from '@aniku/shared'
import { config } from '../config'
import { keywordVariantsZh } from './opencc-s2t'

const SITE = 'https://anime1.me'
const API = 'https://v.anime1.me/api'
const UA = config.defaultUserAgent

export function isAnime1Rule(rule: PluginRule): boolean {
  const name = (rule.name || '').toLowerCase()
  const base = (rule.baseURL || '').toLowerCase()
  return (
    name === 'anime1' ||
    name.includes('anime1') ||
    base.includes('anime1.me')
  )
}

function absUrl(href: string, base = SITE): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

async function fetchText(
  url: string,
  opts: { referer?: string; timeoutMs?: number } = {},
): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      ...(opts.referer ? { Referer: opts.referer } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  })
  if (!res.ok) throw new Error(`Anime1 源站 ${res.status}: ${url}`)
  return res.text()
}

/** Parse episode title like "葬送的芙莉蓮 第二季 [38]" */
function parseEpisodeLabel(title: string): { name: string; ep?: number } {
  const t = title.replace(/\s+/g, ' ').trim()
  const m = t.match(/\[(\d+)\]\s*$/)
  if (m) {
    return {
      name: t,
      ep: Number(m[1]),
    }
  }
  const m2 = t.match(/第\s*(\d+)\s*[话話集]/)
  if (m2) return { name: t, ep: Number(m2[1]) }
  return { name: t }
}

function extractCatId(html: string): string {
  // /?cat=1833 or categoryID in dataLayer
  const catLink = html.match(/href=["']\/?\?cat=(\d+)["']/i)
  if (catLink) return catLink[1]
  const dl = html.match(/categoryID['"]\s*:\s*['"]?(\d+)/i)
  if (dl) return dl[1]
  const catPath = html.match(/\/\?cat=(\d+)/)
  if (catPath) return catPath[1]
  return ''
}

function extractSearchHits(html: string): {
  title: string
  url: string
  catId?: string
}[] {
  const hits: { title: string; url: string; catId?: string }[] = []
  // <h2 class="entry-title"><a href="https://anime1.me/28433">title</a>
  const re =
    /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    hits.push({
      url: absUrl(m[1]),
      title: decodeHtml(m[2]),
    })
  }
  if (!hits.length) {
    const re2 =
      /<h2[^>]*>\s*<a[^>]+href=["'](https?:\/\/anime1\.me\/\d+[^"']*)["'][^>]*>([^<]+)<\/a>/gi
    while ((m = re2.exec(html))) {
      hits.push({ url: absUrl(m[1]), title: decodeHtml(m[2]) })
    }
  }
  return hits
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
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** Group episode posts into series SearchItems via category page */
export async function searchAnime1(
  rule: PluginRule,
  keyword: string,
): Promise<PluginSearchResult> {
  const diagnostics: string[] = []
  const variants = keywordVariantsZh(keyword)
  diagnostics.push(`关键词变体: ${variants.join(' / ')}`)

  const seriesMap = new Map<
    string,
    { title: string; src: string; sample: string }
  >()

  for (const kw of variants) {
    const url = `${SITE}/?s=${encodeURIComponent(kw)}`
    try {
      const html = await fetchText(url, { referer: SITE + '/' })
      const hits = extractSearchHits(html)
      diagnostics.push(`「${kw}」命中 ${hits.length} 条`)
      if (!hits.length) continue

      // Resolve category for first few hits (cap network)
      const sample = hits.slice(0, 12)
      await Promise.all(
        sample.map(async (hit) => {
          try {
            const page = await fetchText(hit.url, { referer: url })
            let catId = extractCatId(page)
            if (!catId) {
              const catHref = page.match(
                /href=["'](https?:\/\/anime1\.me\/category\/[^"']+)["']/i,
              )
              if (catHref) {
                // use category URL as src
                const seriesTitle =
                  page.match(
                    /rel=["']category tag["'][^>]*>([^<]+)</i,
                  )?.[1] || hit.title.replace(/\s*\[\d+\]\s*$/, '')
                const key = catHref[1]
                if (!seriesMap.has(key)) {
                  seriesMap.set(key, {
                    title: decodeHtml(seriesTitle),
                    src: catHref[1],
                    sample: hit.url,
                  })
                }
                return
              }
            }
            if (catId) {
              const src = `${SITE}/?cat=${catId}`
              const seriesTitle =
                page.match(
                  /rel=["']category tag["'][^>]*>([^<]+)</i,
                )?.[1] || hit.title.replace(/\s*\[\d+\]\s*$/, '')
              if (!seriesMap.has(src)) {
                seriesMap.set(src, {
                  title: decodeHtml(seriesTitle),
                  src,
                  sample: hit.url,
                })
              }
            }
          } catch (e) {
            diagnostics.push(
              `解析分类失败 ${hit.url}: ${(e as Error).message}`,
            )
          }
        }),
      )
      if (seriesMap.size) break
    } catch (e) {
      diagnostics.push(`搜索失败「${kw}」: ${(e as Error).message}`)
    }
  }

  const items: SearchItem[] = [...seriesMap.values()].map((s) => ({
    name: s.title,
    src: s.src,
  }))

  if (!items.length) {
    diagnostics.push('未找到系列；可尝试繁体关键词或别名')
  }

  return {
    pluginName: rule.name,
    items,
    diagnostics,
  }
}

function extractChapterLinks(html: string): { name: string; url: string }[] {
  const list: { name: string; url: string }[] = []
  const re =
    /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    list.push({ url: absUrl(m[1]), name: decodeHtml(m[2]) })
  }
  if (!list.length) {
    const re2 =
      /<h2[^>]*>\s*<a[^>]+href=["'](https?:\/\/anime1\.me\/\d+[^"']*)["'][^>]*>([^<]+)<\/a>/gi
    while ((m = re2.exec(html))) {
      list.push({ url: absUrl(m[1]), name: decodeHtml(m[2]) })
    }
  }
  // video blocks on category page may list multiple data-apireq articles
  if (!list.length) {
    const articles = html.matchAll(
      /<article[^>]+id="post-(\d+)"[\s\S]*?<h2[^>]*>\s*(?:<a[^>]+href=["']([^"']+)["'][^>]*>)?([^<]+)/gi,
    )
    for (const a of articles) {
      const url = a[2] ? absUrl(a[2]) : `${SITE}/${a[1]}`
      list.push({ url, name: decodeHtml(a[3] || `Post ${a[1]}`) })
    }
  }
  return list
}

export async function chaptersAnime1(
  rule: PluginRule,
  source: string,
): Promise<PluginChapterResult> {
  const diagnostics: string[] = []
  let url = source.trim()
  if (/^\d+$/.test(url)) url = `${SITE}/?cat=${url}`
  else if (url.includes('anime1.me') && !url.includes('cat=') && !url.includes('/category/')) {
    // single episode → promote to cat if possible
    try {
      const html = await fetchText(url, { referer: SITE + '/' })
      const catId = extractCatId(html)
      if (catId) {
        url = `${SITE}/?cat=${catId}`
        diagnostics.push(`从单集提升为 cat=${catId}`)
      }
    } catch {
      /* use original */
    }
  }

  const html = await fetchText(url, { referer: SITE + '/' })
  let links = extractChapterLinks(html)

  // pagination: /page/2 etc.
  const pageUrls = new Set<string>()
  const pageRe = /href=["']([^"']*page\/\d+[^"']*)["']/gi
  let pm: RegExpExecArray | null
  while ((pm = pageRe.exec(html))) {
    pageUrls.add(absUrl(pm[1], url))
  }
  // also ?cat=N&paged=
  const paged = html.match(/[?&]paged=(\d+)/g)
  if (paged) {
    for (let i = 2; i <= 5; i++) {
      try {
        const u = new URL(url)
        u.searchParams.set('paged', String(i))
        pageUrls.add(u.toString())
      } catch {
        /* ignore */
      }
    }
  }

  for (const pu of [...pageUrls].slice(0, 4)) {
    try {
      const ph = await fetchText(pu, { referer: url })
      links.push(...extractChapterLinks(ph))
    } catch (e) {
      diagnostics.push(`分页失败: ${(e as Error).message}`)
    }
  }

  // dedupe by url
  const seen = new Set<string>()
  const episodes: { name: string; url: string; ep: number }[] = []
  for (const l of links) {
    if (seen.has(l.url)) continue
    seen.add(l.url)
    const { name, ep } = parseEpisodeLabel(l.name)
    episodes.push({ name, url: l.url, ep: ep ?? 0 })
  }

  // chronological: smaller ep first; unknown ep keep order reversed (site is newest-first)
  episodes.sort((a, b) => {
    if (a.ep && b.ep) return a.ep - b.ep
    if (a.ep) return -1
    if (b.ep) return 1
    return 0
  })
  // if all ep=0, reverse site order (newest first → oldest first)
  if (episodes.every((e) => !e.ep)) episodes.reverse()

  const road: Road = {
    name: 'Anime1',
    data: episodes.map((e) => e.url),
    identifier: episodes.map((e) =>
      e.ep ? String(e.ep) : e.name.replace(/^.*\[(\d+)\].*$/, '$1') || e.name,
    ),
  }

  diagnostics.push(`分集 ${episodes.length} 条 from ${url}`)

  return {
    pluginName: rule.name,
    roads: episodes.length ? [road] : [],
    diagnostics,
  }
}

function parseSetCookies(header: string | null): string[] {
  if (!header) return []
  // undici/fetch may join multiple set-cookie — Node 20+ getSetCookie()
  return header.split(/,(?=\s*[^;]+=)/).map((s) => s.trim())
}

function cookiesFromResponse(res: Response): string {
  const anyHeaders = res.headers as Headers & {
    getSetCookie?: () => string[]
  }
  const list =
    typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : parseSetCookies(res.headers.get('set-cookie'))

  const pairs: string[] = []
  for (const line of list) {
    const nv = line.split(';')[0]?.trim()
    if (nv && nv.includes('=')) pairs.push(nv)
  }
  // keep e, p, h if present
  return pairs.join('; ')
}

export async function resolveAnime1(
  rule: PluginRule,
  pageUrl: string,
): Promise<ResolvePlayResult> {
  const diagnostics: string[] = []
  const abs = absUrl(pageUrl, rule.baseURL || SITE)
  diagnostics.push(`集页 ${abs}`)

  const html = await fetchText(abs, { referer: SITE + '/' })
  const apireqMatch = html.match(/data-apireq=["']([^"']+)["']/i)
  if (!apireqMatch) {
    throw new Error(
      'Anime1 页面无 data-apireq（可能需登录/结构变更/非正片页）',
    )
  }
  const apireq = apireqMatch[1]
  diagnostics.push('已提取 data-apireq')

  const apiRes = await fetch(API, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: SITE,
      Referer: abs,
      Accept: 'application/json, text/javascript, */*; q=0.01',
    },
    body: `d=${apireq}`,
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  })

  const cookie = cookiesFromResponse(apiRes)
  const text = await apiRes.text()
  if (!apiRes.ok) {
    throw new Error(
      `Anime1 API ${apiRes.status}: ${text.slice(0, 160) || apiRes.statusText}`,
    )
  }

  let data: { s?: { src?: string; type?: string }[] | string; success?: boolean; errors?: string[] }
  try {
    data = JSON.parse(text) as typeof data
  } catch {
    throw new Error(`Anime1 API 非 JSON: ${text.slice(0, 120)}`)
  }

  if (data.success === false) {
    throw new Error(
      `Anime1 鉴权失败: ${(data.errors || []).join(', ') || 'unknown'}`,
    )
  }

  // Response shapes: { s: [{src,type}] } or videojs src list
  let playUrl = ''
  const s = data.s
  if (Array.isArray(s) && s.length) {
    const first = s[0]
    if (typeof first === 'string') playUrl = first
    else if (first?.src) playUrl = first.src
  } else if (typeof s === 'string') {
    playUrl = s
  }

  if (!playUrl) {
    throw new Error(`Anime1 API 无播放地址: ${text.slice(0, 160)}`)
  }
  if (playUrl.startsWith('//')) playUrl = `https:${playUrl}`
  if (!/^https?:\/\//i.test(playUrl)) {
    playUrl = absUrl(playUrl, 'https://v.anime1.me/')
  }

  diagnostics.push(`媒体 ${playUrl.slice(0, 80)}… cookie=${cookie ? 'yes' : 'no'}`)
  if (!cookie) {
    diagnostics.push('警告: 未收到 Set-Cookie，播放可能 403')
  }

  const referer = SITE + '/'
  const params = new URLSearchParams()
  params.set('url', playUrl)
  params.set('referer', referer)
  if (cookie) params.set('cookie', cookie)

  return {
    playUrl,
    proxyUrl: `/api/media/proxy?${params.toString()}`,
    contentType: 'video/mp4',
    referer,
    headers: {
      'User-Agent': UA,
      Referer: referer,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    diagnostics,
  }
}
