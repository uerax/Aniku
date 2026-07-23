import type {
  PluginRule,
  SearchItem,
  Road,
  PluginSearchResult,
  PluginChapterResult,
  ResolvePlayResult,
} from '@aniku/shared'
import { parsePluginRule } from '@aniku/shared'
import * as cheerio from 'cheerio'
import { DOMParser } from '@xmldom/xmldom'
import xpath from 'xpath'
import { config } from '../config'
import { assertPublicHttpUrl, fetchPublic } from '../lib/private-host'

const MEDIA_RE =
  /(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?)/gi
const IFRAME_RE = /<iframe[^>]+src=["']([^"']+)["']/gi

export function normalizeEpisodeUrl(baseUrl: string, raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  let resolved: URL | null = null
  try {
    resolved = new URL(trimmed)
  } catch {
    try {
      resolved = new URL(trimmed, baseUrl)
    } catch {
      return trimmed
    }
  }
  try {
    const base = new URL(baseUrl)
    if (
      resolved.host === base.host &&
      (resolved.protocol === 'http:' || resolved.protocol === 'https:') &&
      (base.protocol === 'http:' || base.protocol === 'https:') &&
      resolved.protocol !== base.protocol
    ) {
      resolved.protocol = base.protocol
    }
  } catch {
    /* ignore */
  }
  let path = resolved.pathname
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  resolved.pathname = path
  return resolved.toString()
}

/** Build an XML-ish DOM from HTML so the `xpath` package can run. */
function htmlToXPathDoc(html: string): Document | null {
  try {
    const $ = cheerio.load(html, { xml: { decodeEntities: false } })
    $('script, style, noscript').remove()
    const xml = $.xml()
    const parser = new DOMParser({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      errorHandler: (() => undefined) as any,
    })
    return parser.parseFromString(xml, 'text/xml') as unknown as Document
  } catch (e) {
    console.warn('htmlToXPathDoc failed', e)
    return null
  }
}

function xpathNodes(doc: Document | null, expression: string): Node[] {
  if (!doc || !expression?.trim()) return []
  try {
    const result = xpath.select(expression, doc as unknown as Node)
    if (Array.isArray(result)) return result as Node[]
    if (result) return [result as Node]
    return []
  } catch (e) {
    console.warn('xpath error', expression, e)
    return []
  }
}

function xpathRelative(node: Node, expression: string): Node | null {
  if (!expression?.trim()) return null
  try {
    const result = xpath.select(expression, node)
    if (Array.isArray(result)) return (result[0] as Node) || null
    return (result as Node) || null
  } catch {
    return null
  }
}

function nodeText(node: Node | null | undefined): string {
  if (!node) return ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyNode = node as any
  if (typeof anyNode.textContent === 'string') {
    return anyNode.textContent.replace(/\s+/g, ' ').trim()
  }
  return String(anyNode.nodeValue ?? '').trim()
}

function nodeAttr(node: Node | null | undefined, name: string): string {
  if (!node) return ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyNode = node as any
  if (typeof anyNode.getAttribute === 'function') {
    return String(anyNode.getAttribute(name) || '').trim()
  }
  return ''
}

/** Reject pathological HTML/JSON bodies that would blow Node heap */
const MAX_HTML_BYTES = 2_500_000

async function readTextLimited(
  res: Response,
  maxBytes: number,
  label: string,
): Promise<string> {
  const cl = res.headers.get('content-length')
  if (cl) {
    const n = Number(cl)
    if (Number.isFinite(n) && n > maxBytes) {
      // Consume/cancel body so connection can reuse
      try {
        await res.body?.cancel()
      } catch {
        /* ignore */
      }
      throw new Error(`${label} 响应过大 (${n} > ${maxBytes} bytes)`)
    }
  }

  if (!res.body) return res.text()

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value?.byteLength) continue
    total += value.byteLength
    if (total > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        /* ignore */
      }
      throw new Error(`${label} 响应过大 (>${maxBytes} bytes)`)
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged)
}

export async function fetchHtml(
  url: string,
  rule: PluginRule,
  opts: {
    method?: string
    body?: URLSearchParams | string
    referer?: string
    /** Override default timeout (ms). Search uses shorter; resolve may need more. */
    timeoutMs?: number
    /** Extra retry on transient network / 5xx (default 0) */
    retries?: number
  } = {},
): Promise<string> {
  // SSRF: block private hosts + re-check redirects (see lib/private-host.ts)
  try {
    assertPublicHttpUrl(url, '源站')
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : `源站 URL 无效: ${url}`)
  }

  const headers: Record<string, string> = {
    'User-Agent': rule.userAgent || config.defaultUserAgent,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  }
  if (opts.referer || rule.referer) {
    headers.Referer = opts.referer || rule.referer || rule.baseURL
  }

  const timeoutMs = opts.timeoutMs ?? 12_000
  const retries = Math.max(0, opts.retries ?? 0)
  let lastErr: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchPublic(
        url,
        {
          method: opts.method || 'GET',
          headers,
          body: opts.body,
        },
        { timeoutMs },
      )
      if (!res.ok) {
        // retry on 429 / 5xx once
        if (
          attempt < retries &&
          (res.status === 429 || res.status >= 500)
        ) {
          lastErr = new Error(`源站返回 ${res.status}: ${url}`)
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
          continue
        }
        throw new Error(`源站返回 ${res.status}: ${url}`)
      }
      return await readTextLimited(res, MAX_HTML_BYTES, '源站')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      lastErr = new Error(
        msg.startsWith('源站') ||
          msg.startsWith('无法访问') ||
          msg.includes('内网') ||
          msg.includes('重定向') ||
          msg.includes('响应过大')
          ? msg
          : `无法访问源站: ${msg} (${url})`,
      )
      // Do not retry size limit / SSRF — permanent for this URL
      if (/内网|禁止|响应过大/.test(msg)) break
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
        continue
      }
    }
  }
  throw lastErr || new Error(`无法访问源站: ${url}`)
}

function cleanText(v: string | undefined | null): string {
  return (v || '').replace(/\s+/g, ' ').trim()
}

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const v of values) {
    const t = cleanText(v)
    if (t) return t
  }
  return ''
}

function cheerioSearchFallback(html: string, baseUrl: string): SearchItem[] {
  const $ = cheerio.load(html)
  const items: SearchItem[] = []
  const seen = new Set<string>()

  const push = (name: string, href: string) => {
    const n = cleanText(name)
    if (!n || n.length > 100) return
    if (!href || /javascript:|#|login|register|gbook/i.test(href)) return
    if (
      /vodsearch|vodtype|search\.html|user\//i.test(href) &&
      !/voddetail|detail/i.test(href)
    ) {
      return
    }
    const src = normalizeEpisodeUrl(baseUrl, href)
    if (seen.has(src)) return
    seen.add(src)
    items.push({ name: n, src })
  }

  // Common macCMS / anime site cards
  const cardSelectors = [
    '.video',
    '.module-item',
    '.module-card-item',
    '.public-list-box',
    '.myui-vodlist__box',
    '.stui-vodlist__box',
    'li.hl-list-item',
    '.search-list li',
    '.vodlist li',
  ]
  for (const sel of cardSelectors) {
    $(sel).each((_, el) => {
      const $el = $(el)
      const $a = $el
        .find(
          'a[href*="voddetail"], a[href*="detail"], a[href*="video"], a[href]',
        )
        .first()
      const href = $a.attr('href') || ''
      const name = firstNonEmpty(
        $el.find('.video-by').first().text(),
        $el
          .find(
            // time-title: MacCMS shoutu / otage.cc card titles
            '.time-title, .video-name, .module-item-title, .module-card-item-title, .title, .name, .hl-item-title',
          )
          .first()
          .text(),
        $a.attr('title'),
        $el.find('img').attr('alt'),
        $el.find('img').attr('title'),
        $a.text(),
      )
      push(name, href)
    })
    if (items.length) break
  }

  // Direct detail links anywhere
  if (!items.length) {
    $('a[href*="voddetail"], a[href*="/detail/"]').each((_, el) => {
      const $a = $(el)
      const href = $a.attr('href') || ''
      const $card = $a.closest('.video, .module-item, li, .public-list-box')
      const name = firstNonEmpty(
        $a.attr('title'),
        $card
          .find('.time-title, .video-by, .video-name, .title, .name')
          .first()
          .text(),
        $a.find('img').attr('alt'),
        $card.find('img').attr('alt'),
        $a.text(),
      )
      push(name, href)
    })
  }

  return items.slice(0, 40)
}

/** True if href looks like an episode play page (not detail/search/user). */
function isLikelyPlayHref(href: string): boolean {
  if (!href || /javascript:|^#|void\(0\)/i.test(href)) return false
  if (/login|register|gbook|user\/|search|vodtype|label|map\.html/i.test(href)) {
    return false
  }
  // Prefer explicit play paths used by MacCMS / anime sites
  if (/\/(vod)?play\//i.test(href) || /play\/|\/ep\/|episode/i.test(href)) {
    return true
  }
  // MacCMS style: detail-id-source-ep.html  e.g. xxx-1-1.html
  if (/-\d+-\d+\.html?(?:\?|$)/i.test(href)) return true
  // Reject pure detail pages
  if (/voddetail|\/detail\//i.test(href) && !/play/i.test(href)) return false
  return false
}

const JUNK_EP_NAME =
  /^(详情|评论|下载|收藏|报错|排序|正序|倒序|倒序排列|正序排列|更多|展开|收起|线路\d*|播放|立即播放|加入|分享|追剧|简介|演员|相关|换一换)$/i

function isLikelyEpisodeName(name: string): boolean {
  const n = name.replace(/\s+/g, '').trim()
  if (!n || n.length > 24) return false
  if (JUNK_EP_NAME.test(n)) return false
  // pure navigation noise
  if (/^[<>«»‹›]+$/.test(n)) return false
  return true
}

/** Deduplicate + drop non-play / junk episode entries. */
function cleanRoad(road: Road): Road | null {
  const urls: string[] = []
  const names: string[] = []
  const seenUrl = new Set<string>()

  for (let i = 0; i < road.data.length; i++) {
    const rawUrl = road.data[i] || ''
    const rawName = (road.identifier[i] || '').replace(/\s+/g, '')
    if (!rawUrl || !isLikelyPlayHref(rawUrl)) continue
    if (!isLikelyEpisodeName(rawName) && !/第?\d+集?/.test(rawName) && !/^\d+$/.test(rawName)) {
      // allow numeric-ish; otherwise skip vague labels unless href is strong play link
      if (!/\/(vod)?play\//i.test(rawUrl) && !/-\d+-\d+\.html/i.test(rawUrl)) {
        continue
      }
      if (!rawName || rawName.length > 24) continue
    }
    if (JUNK_EP_NAME.test(rawName)) continue

    // Deduplicate by URL only — same display label with different URLs is allowed
    // (multi-part / re-air). Dropping by name wrongly removed later episodes.
    if (seenUrl.has(rawUrl)) continue
    seenUrl.add(rawUrl)
    urls.push(rawUrl)
    names.push(rawName || `第${urls.length}集`)
  }

  if (!urls.length) return null
  return { name: road.name, data: urls, identifier: names }
}

function roadFingerprint(road: Road): string {
  return road.data.join('|')
}

/** True if label looks like a site CDN / quality tab (not episode junk). */
function isLikelyRoadLabel(raw: string): boolean {
  const n = raw.replace(/\s+/g, '').trim()
  if (!n || n.length > 24) return false
  if (JUNK_EP_NAME.test(n)) return false
  if (/^第?\d+集?$|^\d+$/.test(n)) return false
  // quality / CDN / line names commonly used by anime MacCMS sites
  if (
    /线|源|播|清|蓝|光|速|画质|超清|高清|标清|流畅|原画|无修|内嵌|外挂|双语|国语|粤语|日语|中字|简|繁|BD|HD|4K|2K|1080|720|480|360|WEBRIP|WEB|H265|H264|HEVC|ikun|量子|非凡|索尼|七色|线路|播放/i.test(
      n,
    )
  ) {
    return true
  }
  // short non-numeric tab text (e.g. "A", "B", "主线")
  if (n.length <= 12 && !/^[<>«»]+$/.test(n)) return true
  return false
}

/** Normalize road label for display (trim + collapse spaces). */
function normalizeRoadLabel(raw: string, fallbackIndex: number): string {
  const n = raw.replace(/\s+/g, ' ').trim()
  if (n && isLikelyRoadLabel(n)) return n
  return `播放线路${fallbackIndex + 1}`
}

/**
 * Infer a quality-ish label from episode page URLs when the site puts the
 * source index in the path (MacCMS: /play/{id}-{source}-{ep}/).
 */
function labelFromPlayUrls(urls: string[], fallbackIndex: number): string {
  const sources = new Set<string>()
  for (const u of urls.slice(0, 8)) {
    // .../play/123-2-1.html  or  /play/123-2-1/
    const m = u.match(/(?:vod)?play\/\d+-(\d+)-\d+/i) || u.match(/-(\d+)-\d+\.html/i)
    if (m?.[1]) sources.add(m[1])
  }
  if (sources.size === 1) {
    const src = [...sources][0]
    // keep numeric as soft hint only when no better name — UI prefers site tabs
    return `线路${src}`
  }
  return `播放线路${fallbackIndex + 1}`
}

function isGenericRoadName(name: string): boolean {
  return !name || /^播放线路\d+$/.test(name) || /^线路\d+$/.test(name)
}

/**
 * Align with Kazumi: keep distinct play-lines; preserve site-provided names
 * (often resolution / CDN like 高清、蓝光、量子). Only drop empty / junk /
 * exact URL-list duplicates — never overwrite a good label with 播放线路N.
 */
function cleanRoads(roads: Road[]): Road[] {
  const cleaned: Road[] = []
  const seenFp = new Set<string>()
  for (let i = 0; i < roads.length; i++) {
    const c = cleanRoad(roads[i])
    if (!c) continue
    const fp = roadFingerprint(c)
    if (seenFp.has(fp)) continue
    seenFp.add(fp)
    const data = c.data.length > 120 ? c.data.slice(0, 120) : c.data
    const identifier =
      c.identifier.length > 120 ? c.identifier.slice(0, 120) : c.identifier
    let name = (c.name || '').replace(/\s+/g, ' ').trim()
    if (isGenericRoadName(name) || !isLikelyRoadLabel(name)) {
      const fromUrls = labelFromPlayUrls(data, cleaned.length)
      name = !isGenericRoadName(fromUrls) ? fromUrls : `播放线路${cleaned.length + 1}`
    }
    cleaned.push({ name, data, identifier })
  }
  // Final pass: ensure unique display names
  const used = new Map<string, number>()
  return cleaned.map((r, i) => {
    let name = r.name || `播放线路${i + 1}`
    const base = name
    const n = used.get(base) || 0
    used.set(base, n + 1)
    if (n > 0) name = `${base} · ${n + 1}`
    return { ...r, name }
  })
}

/**
 * Prefer MacCMS / theme structures that pair tab labels (quality/CDN) with
 * episode lists — this is how sites expose "分辨率 / 线路" names.
 */
function cheerioChapterFallback(html: string, baseUrl: string): Road[] {
  const $ = cheerio.load(html)
  const roads: Road[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pushRoad = (label: string, container: any) => {
    const urls: string[] = []
    const names: string[] = []
    const seen = new Set<string>()
    $(container)
      .find('a[href]')
      .each((_, a) => {
        const href = $(a).attr('href') || ''
        const name = $(a).text().replace(/\s+/g, '')
        if (!href || !name) return
        if (!isLikelyPlayHref(href) && !isLikelyEpisodeName(name)) return
        if (/voddetail|\/detail\//i.test(href) && !/play/i.test(href)) return
        const abs = normalizeEpisodeUrl(baseUrl, href)
        if (seen.has(abs)) return
        seen.add(abs)
        urls.push(abs)
        names.push(name)
      })
    if (urls.length >= 1) {
      roads.push({
        name: normalizeRoadLabel(label, roads.length),
        data: urls,
        identifier: names,
      })
    }
  }

  // 1) MXdm / many themes: .playlist > .tabs > a  + sibling .row blocks
  //    Tab text is the CDN / quality name (量子 / ikun / 非凡 / 高清 …)
  $('.playlist, .playlists, .module-player, #playlist, .anthology').each(
    (_, root) => {
      if (roads.length) return
      const $root = $(root)
      const tabs = $root
        .find(
          '.tabs a, .module-tab-item, .play-from a, .playfrom a, .hl-plays-from a, .anthology-tab a, .anthology-tab .swiper-slide, [class*="play-from"] a, [class*="playfrom"] a',
        )
        .toArray()
      // Prefer one list node per source (row / play-list), not every nested ul
      let lists = $root.children('.row, .module-play-list, .play-list').toArray()
      if (!lists.length) {
        lists = $root
          .find(
            '> .row, .row, .module-play-list, .play-list, .hl-plays-list, .anthology-list-box, .stui-content__playlist, .myui-content__list',
          )
          .toArray()
      }
      lists = lists.filter(
        (el) => $(el).find('a[href*="play"], a[href*="-"]').length > 0,
      )

      if (tabs.length >= 1 && lists.length >= 1) {
        const n = Math.min(tabs.length, lists.length)
        for (let i = 0; i < n; i++) {
          const label = $(tabs[i]).text().replace(/\s+/g, '')
          pushRoad(label, lists[i])
        }
      }
    },
  )
  if (roads.length) return cleanRoads(roads)

  // 2) 7sefun-style: header with stream name + following play list container
  $('.chat-stream .chat, .chat-stream, .play-box, .player-box').each((_, root) => {
    const $root = $(root)
    $root.find('.chat-header, .title, .play-title').each((__, header) => {
      const $h = $(header)
      const stream =
        $h.find('.chat-stream-bfq, .stream, .bfq, .source-name').first().text() ||
        $h.text()
      const label = stream.replace(/\s+/g, ' ').trim()
      const list = $h.nextAll(
        '.vod-play-list-container, .message-container, .play-list, ul, .module-play-list',
      ).first()
      if (list.length) pushRoad(label, list[0])
    })
  })
  if (roads.length) return cleanRoads(roads)

  // 3) Generic playlist containers (no tab labels)
  const playlistSelectors = [
    '.module-play-list',
    '.module-list .module-play-list',
    '.play-list',
    '.playlist .row',
    '.stui-content__playlist',
    '.myui-content__list',
    '.hl-plays-list',
    '#playlist .play-list',
    '.anthology-list-box',
    '.anthology-list',
    '.video-play-list',
    '.vod-play-list-container',
  ]

  for (const sel of playlistSelectors) {
    const nodes = $(sel).toArray()
    if (!nodes.length) continue
    for (const el of nodes) {
      // try previous sibling tab / header for a name
      const prevLabel =
        $(el).prevAll('.tabs, .module-tab, .chat-header, .title').first().text() ||
        $(el).parent().prevAll('.tabs, .module-tab, .chat-header').first().text() ||
        ''
      pushRoad(prevLabel.replace(/\s+/g, ' ').trim(), el)
    }
    if (roads.length) break
  }

  if (!roads.length) {
    const urls: string[] = []
    const names: string[] = []
    const seen = new Set<string>()
    $('a[href*="vodplay"], a[href*="/play/"], a[href*="play"]').each((_, a) => {
      const href = $(a).attr('href') || ''
      const name = $(a).text().replace(/\s+/g, '')
      if (!href || !name || name.length > 20) return
      if (!isLikelyPlayHref(href)) return
      const abs = normalizeEpisodeUrl(baseUrl, href)
      if (seen.has(abs)) return
      seen.add(abs)
      urls.push(abs)
      names.push(name)
    })
    if (urls.length) {
      roads.push({
        name: labelFromPlayUrls(urls, 0),
        data: urls,
        identifier: names,
      })
    }
  }

  return cleanRoads(roads)
}

/**
 * Best-effort: find a quality/CDN tab label associated with this road node
 * in the original HTML (sibling tabs, previous header, title attr).
 */
function resolveRoadLabelFromHtml(
  html: string,
  roadIndex: number,
  sampleUrl: string,
): string {
  const $ = cheerio.load(html)
  // Tab lists paired with episode lists (MXdm etc.)
  const tabSets = [
    '.playlist .tabs a',
    '.playlists .tabs a',
    '.module-tab-item',
    '.play-from a',
    '.playfrom a',
    '.hl-plays-from a',
    '.anthology-tab a',
    '.anthology-tab .swiper-slide',
    '[class*="play-from"] a',
  ]
  for (const sel of tabSets) {
    const tabs = $(sel).toArray()
    if (tabs.length > roadIndex) {
      const t = $(tabs[roadIndex]).text().replace(/\s+/g, '')
      if (isLikelyRoadLabel(t)) return t
    }
  }
  // 7sefun headers
  const headers = $('.chat-header .chat-stream-bfq, .chat-header')
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
    .filter((t) => isLikelyRoadLabel(t))
  if (headers[roadIndex]) return headers[roadIndex]

  // URL source index → keep soft label; real tabs preferred above
  if (sampleUrl) return labelFromPlayUrls([sampleUrl], roadIndex)
  return ''
}

function dedupeSearchItems(items: SearchItem[]): SearchItem[] {
  const seen = new Set<string>()
  const out: SearchItem[] = []
  for (const it of items) {
    const src = (it.src || '').trim()
    if (!src || seen.has(src)) continue
    seen.add(src)
    out.push({ name: cleanText(it.name) || src, src })
  }
  return out
}

function parseSearchHtml(
  html: string,
  rule: PluginRule,
  diagnostics: string[],
): SearchItem[] {
  let items: SearchItem[] = []

  // 1) XPath (Kazumi-compatible) via cheerio→xml→xmldom
  try {
    const doc = htmlToXPathDoc(html)
    const listNodes = xpathNodes(doc, rule.searchList)
    if (listNodes.length === 0) {
      diagnostics.push('searchList XPath 未匹配')
    }
    for (let index = 0; index < listNodes.length; index++) {
      const node = listNodes[index]
      try {
        const nameNode = xpathRelative(node, rule.searchName)
        const resultNode = xpathRelative(node, rule.searchResult)
        const name = nodeText(nameNode) || nodeText(resultNode)
        let src = nodeAttr(resultNode, 'href') || nodeAttr(nameNode, 'href')
        if (!name || !src) {
          // noisy per-node logs only for first few
          if (index < 3) diagnostics.push(`搜索节点 ${index} 缺少名称或链接`)
          continue
        }
        src = normalizeEpisodeUrl(rule.baseURL, src)
        items.push({ name, src })
      } catch (e) {
        if (index < 3) {
          diagnostics.push(`搜索节点 ${index}: ${(e as Error).message}`)
        }
      }
    }
  } catch (e) {
    diagnostics.push(`XPath 解析失败: ${(e as Error).message}`)
  }

  // 2) Cheerio heuristics for modern / broken rules
  if (items.length === 0) {
    items = cheerioSearchFallback(html, rule.baseURL)
    if (items.length) {
      diagnostics.push(
        `规则 XPath 未命中，已用通用卡片选择器回退 ${items.length} 条`,
      )
    }
  }

  // XPath can hit the same detail card twice (title + cover links)
  return dedupeSearchItems(items)
}

/**
 * Expand a single keyword into a few short variants (Kazumi user often
 * retypes shorter titles; we try those automatically before giving up).
 */
function expandKeywordCandidates(keyword: string): string[] {
  const raw = keyword.trim()
  if (!raw) return []
  const out: string[] = []
  const push = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim()
    if (!t || t.length < 2) return
    if (t.length > 48) return
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  const head = raw.split(/[\s　:：\-–—·・]/)[0]?.trim() || raw
  push(head)
  push(raw.replace(/[（(][^）)]*[）)]/g, ' '))
  push(
    raw
      .replace(/(第?\s*\d+\s*[期季部作]|S\s*\d+|Season\s*\d+)/gi, ' ')
      .replace(/\s+/g, ' '),
  )
  push(raw)
  // prefer shorter first
  return out.sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, 4)
}

export async function searchWithRule(
  ruleInput: unknown,
  keyword: string,
): Promise<PluginSearchResult> {
  const rule = parsePluginRule(ruleInput)
  const diagnostics: string[] = []

  // Anime1.me — dedicated adapter (s2t search + category grouping)
  {
    const { isAnime1Rule, searchAnime1 } = await import('../lib/anime1')
    if (isAnime1Rule(rule)) {
      try {
        return await searchAnime1(rule, keyword)
      } catch (e) {
        return {
          pluginName: rule.name,
          items: [],
          diagnostics: [e instanceof Error ? e.message : String(e)],
        }
      }
    }
  }

  // API-mode rules (sorani / TvTFun): JSON API + searchApiConfig
  if (rule.searchMode === 'api') {
    try {
      const { searchWithApiRule } = await import('./api')
      const candidates = expandKeywordCandidates(keyword)
      if (!candidates.length) {
        return {
          pluginName: rule.name,
          items: [],
          diagnostics: ['缺少关键词'],
        }
      }
      let items: SearchItem[] = []
      let lastErr = ''
      let usedKeyword = candidates[0]
      for (let i = 0; i < candidates.length; i++) {
        const kw = candidates[i]
        try {
          const res = await searchWithApiRule(rule, kw)
          items = res.items
          diagnostics.push(...res.diagnostics)
          if (items.length) {
            usedKeyword = kw
            if (kw !== keyword.trim()) diagnostics.push(`关键词回退为「${kw}」`)
            break
          }
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e)
          if (i === candidates.length - 1) diagnostics.push(lastErr)
        }
      }
      if (!items.length && lastErr) {
        diagnostics.push('API 搜索失败，可稍后重试或换规则')
      } else if (!items.length) {
        diagnostics.push('无搜索结果：可试别名/手动关键词')
      } else {
        const refs = [keyword, usedKeyword]
        items = dedupeSearchItems(items).sort((a, b) => {
          const score = (name: string) => {
            const n = name.toLowerCase().replace(/\s+/g, '')
            let best = 0
            for (const r of refs) {
              const s = (r || '').toLowerCase().replace(/\s+/g, '')
              if (!s) continue
              if (n === s) best = Math.max(best, 1)
              else if (n.includes(s) || s.includes(n)) best = Math.max(best, 0.9)
            }
            return best
          }
          return score(b.name) - score(a.name) || a.name.length - b.name.length
        })
      }
      return {
        pluginName: rule.name,
        items: dedupeSearchItems(items),
        diagnostics: diagnostics.slice(0, 8),
      }
    } catch (e) {
      return {
        pluginName: rule.name,
        items: [],
        diagnostics: [
          e instanceof Error ? e.message : String(e),
          'API 搜索规则执行失败',
        ],
      }
    }
  }

  const candidates = expandKeywordCandidates(keyword)
  if (!candidates.length) {
    return {
      pluginName: rule.name,
      items: [],
      diagnostics: ['缺少关键词'],
    }
  }

  let items: SearchItem[] = []
  let lastNetworkError = ''
  let usedKeyword = candidates[0]

  for (let i = 0; i < candidates.length; i++) {
    const kw = candidates[i]
    const queryUrl = rule.searchURL.replace('@keyword', encodeURIComponent(kw))
    let html: string
    try {
      if (rule.usePost) {
        const u = new URL(queryUrl)
        const body = u.searchParams
        const postUrl = `${u.origin}${u.pathname}`
        html = await fetchHtml(postUrl, rule, {
          method: 'POST',
          body,
          referer: rule.baseURL,
          timeoutMs: 12_000,
          retries: 1,
        })
      } else {
        html = await fetchHtml(queryUrl, rule, {
          referer: rule.baseURL,
          timeoutMs: 12_000,
          retries: 1,
        })
      }
    } catch (e) {
      lastNetworkError = e instanceof Error ? e.message : String(e)
      // try next keyword candidate instead of failing the whole request
      if (i === candidates.length - 1) {
        diagnostics.push(lastNetworkError)
      }
      continue
    }
    const roundDiag: string[] = []
    items = parseSearchHtml(html, rule, roundDiag)
    if (items.length > 0) {
      diagnostics.push(...roundDiag)
      usedKeyword = kw
      if (kw !== keyword.trim()) {
        diagnostics.push(`关键词回退为「${kw}」`)
      }
      break
    }
    // Only keep last-round diag to avoid noise
    if (i === candidates.length - 1) {
      diagnostics.push(...roundDiag)
    }
  }

  if (items.length === 0) {
    if (lastNetworkError) {
      // Soft-fail: return empty list so one dead plugin doesn't 502 the UI
      diagnostics.push(
        '源站暂时无法访问，可稍后重试或换规则',
      )
    } else {
      diagnostics.push(
        '无搜索结果：可试别名/手动关键词，或规则失效/源站改版',
      )
    }
  } else {
    // lightweight ranking toward original query (and used short form)
    const refs = [keyword, usedKeyword]
    items = dedupeSearchItems(items).sort((a, b) => {
      // reuse simple include score without importing shared rank (already in this package)
      const score = (name: string) => {
        const n = name.toLowerCase().replace(/\s+/g, '')
        let best = 0
        for (const r of refs) {
          const s = (r || '').toLowerCase().replace(/\s+/g, '')
          if (!s) continue
          if (n === s) best = Math.max(best, 1)
          else if (n.includes(s) || s.includes(n)) best = Math.max(best, 0.9)
        }
        return best
      }
      return score(b.name) - score(a.name) || a.name.length - b.name.length
    })
  }

  return {
    pluginName: rule.name,
    items: items.length ? items : dedupeSearchItems(items),
    diagnostics: diagnostics.slice(0, 8),
  }
}

export async function chaptersWithRule(
  ruleInput: unknown,
  source: string,
): Promise<PluginChapterResult> {
  const rule = parsePluginRule(ruleInput)
  const diagnostics: string[] = []

  {
    const { isAnime1Rule, chaptersAnime1 } = await import('../lib/anime1')
    if (isAnime1Rule(rule)) {
      try {
        return await chaptersAnime1(rule, source)
      } catch (e) {
        return {
          pluginName: rule.name,
          roads: [],
          diagnostics: [e instanceof Error ? e.message : String(e)],
        }
      }
    }
  }

  // API-mode chapters: JSON API + chapterApiConfig (e.g. sorani)
  if (rule.chapterMode === 'api') {
    try {
      const { chaptersWithApiRule } = await import('./api')
      const res = await chaptersWithApiRule(rule, source)
      let roads = cleanRoads(res.roads)
      const diag = [...res.diagnostics]
      if (!roads.length) diag.push('API 章节解析后无有效分集')
      return {
        pluginName: rule.name,
        roads,
        diagnostics: diag.slice(0, 12),
      }
    } catch (e) {
      return {
        pluginName: rule.name,
        roads: [],
        diagnostics: [
          e instanceof Error ? e.message : String(e),
          'API 章节规则执行失败',
        ],
      }
    }
  }

  const pageUrl = normalizeEpisodeUrl(rule.baseURL, source)
  const html = await fetchHtml(pageUrl, rule, { referer: rule.baseURL })
  let roads: Road[] = []

  try {
    const doc = htmlToXPathDoc(html)
    const roadNodes = xpathNodes(doc, rule.chapterRoads)
    for (let roadIndex = 0; roadIndex < roadNodes.length; roadIndex++) {
      const roadNode = roadNodes[roadIndex]
      try {
        let eps: Node[] = []
        try {
          const r = xpath.select(rule.chapterResult, roadNode)
          eps = (Array.isArray(r) ? r : r ? [r] : []) as Node[]
        } catch {
          eps = []
        }
        const urls: string[] = []
        const names: string[] = []
        eps.forEach((epNode, episodeIndex) => {
          const href = nodeAttr(epNode, 'href')
          if (!href) {
            if (episodeIndex < 3) {
              diagnostics.push(`线路 ${roadIndex} 剧集 ${episodeIndex} 无 URL`)
            }
            return
          }
          const name =
            nodeText(epNode).replace(/\s+/g, '') || `第${episodeIndex + 1}集`
          urls.push(normalizeEpisodeUrl(rule.baseURL, href))
          names.push(name)
        })
        if (urls.length === 0) {
          diagnostics.push(`线路 ${roadIndex} 无有效剧集`)
          continue
        }
        // Prefer site tab / quality name (高清、量子、七色A线…) over 播放线路N
        const siteLabel = resolveRoadLabelFromHtml(
          html,
          roads.length,
          urls[0] || '',
        )
        roads.push({
          name: siteLabel || `播放线路${roads.length + 1}`,
          data: urls,
          identifier: names,
        })
      } catch (e) {
        diagnostics.push(`线路 ${roadIndex}: ${(e as Error).message}`)
      }
    }
  } catch (e) {
    diagnostics.push(`章节 XPath 失败: ${(e as Error).message}`)
  }

  // Cheerio when XPath empty/noisy, or when XPath only has generic 播放线路N
  // but the page has real quality/CDN tab labels (MXdm / 7sefun).
  const xpathTotal = roads.reduce((n, r) => n + r.data.length, 0)
  const xpathLabelsGeneric =
    roads.length > 0 && roads.every((r) => isGenericRoadName(r.name))
  if (roads.length === 0 || xpathTotal > 60 || xpathLabelsGeneric) {
    const fallback = cheerioChapterFallback(html, rule.baseURL)
    if (fallback.length) {
      const fbTotal = fallback.reduce((n, r) => n + r.data.length, 0)
      const fbHasLabels = fallback.some((r) => !isGenericRoadName(r.name))
      if (roads.length === 0) {
        roads = fallback
        diagnostics.push(
          `章节 XPath 未命中，通用选集回退 ${fbTotal} 集`,
        )
      } else if (xpathTotal > 60 && fbTotal > 0 && fbTotal < xpathTotal) {
        diagnostics.push(
          `XPath 分集过多(${xpathTotal})，改用通用选集(${fbTotal})`,
        )
        roads = fallback
      } else if (xpathLabelsGeneric && fbHasLabels) {
        // Same episode counts roughly — prefer named CDN/quality lines
        diagnostics.push('已使用站点线路/清晰度名称')
        roads = fallback
      }
    } else if (roads.length === 0) {
      diagnostics.push('未解析到分集线路')
    }
  }

  roads = cleanRoads(roads)
  if (!roads.length) {
    diagnostics.push('清洗后无有效分集（可能规则失效）')
  }

  return { pluginName: rule.name, roads, diagnostics: diagnostics.slice(0, 12) }
}

function extractMediaUrls(text: string): string[] {
  const found = new Set<string>()
  let m: RegExpExecArray | null
  const re = new RegExp(MEDIA_RE.source, 'gi')
  while ((m = re.exec(text))) {
    try {
      const u = decodeURIComponent(
        m[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/'),
      )
      if (u.startsWith('http')) found.add(u)
    } catch {
      found.add(m[1])
    }
  }
  for (const u of [...found]) {
    try {
      const url = new URL(u)
      for (const v of url.searchParams.values()) {
        if (/\.(m3u8|mp4)(\?|$)/i.test(v) && v.startsWith('http')) found.add(v)
      }
    } catch {
      /* ignore */
    }
  }
  return [...found]
}

/** Balanced-brace extract of MacCMS `player_aaaa={...}` object. */
function extractPlayerAaaa(
  html: string,
): { url?: string; encrypt?: number | string; from?: string; id?: string } | null {
  const keyIdx = html.indexOf('player_aaaa')
  if (keyIdx < 0) return null
  const start = html.indexOf('{', keyIdx)
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  let quote = ''
  for (let p = start; p < html.length; p++) {
    const ch = html[p]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === '\\') {
        esc = true
        continue
      }
      if (ch === quote) inStr = false
      continue
    }
    if (ch === '"' || ch === "'") {
      inStr = true
      quote = ch
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, p + 1)) as {
            url?: string
            encrypt?: number | string
            from?: string
            id?: string
          }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** MacCMS encrypt: 0 plain, 1 urlencode, 2 base64(urlencode). */
function decodeMaccmsUrl(raw: string, encrypt?: number | string): string {
  if (!raw) return ''
  let url = String(raw)
  const mode = String(encrypt ?? '0')
  if (mode === '1') {
    try {
      url = decodeURIComponent(url)
    } catch {
      /* ignore */
    }
  } else if (mode === '2') {
    try {
      url = Buffer.from(url, 'base64').toString('utf8')
      try {
        url = decodeURIComponent(url)
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  }
  return url
}

function extractConfigUrls(html: string): string[] {
  const out: string[] = []
  // dplayer / artplayer config blocks
  const patterns = [
    /["']url["']\s*:\s*["'](https?:[^"']+)["']/gi,
    /["']src["']\s*:\s*["'](https?:[^"']+)["']/gi,
    /["']file["']\s*:\s*["'](https?:[^"']+)["']/gi,
    /source\s*:\s*["'](https?:[^"']+)["']/gi,
  ]
  for (const p of patterns) {
    let x: RegExpExecArray | null
    const r = new RegExp(p.source, 'gi')
    while ((x = r.exec(html))) {
      const u = x[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/')
      if (
        /m3u8|\.mp4|video\/|\/tos\/|playurl|stream|hls|aliyuncs|byteimg|toutiao|bilivideo|cdn/i.test(
          u,
        )
      ) {
        out.push(u)
      }
    }
  }
  // JS redirects into deeper player pages
  const loc = html.match(
    /window\.location\.href\s*=\s*["']([^"']+)["']/i,
  )
  if (loc?.[1]) out.push(loc[1])
  return out
}

function extractIframeSrcs(html: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(IFRAME_RE.source, 'gi')
  while ((m = re.exec(html))) out.push(m[1])
  out.push(...extractConfigUrls(html))
  return out
}

function isHtmlPlayPage(u: string): boolean {
  // Intermediate MacCMS / third-party HTML player pages — not playable media
  return /\.html?(?:\?|$)/i.test(u) || /\/(?:vod)?play\/\d/i.test(u)
}

function isLikelyMediaUrl(u: string): boolean {
  if (!/^https?:\/\//i.test(u)) return false
  if (isHtmlPlayPage(u) && !/\.(m3u8|mp4)(\?|$)/i.test(u)) return false
  if (/\.(m3u8|mp4)(\?|$)/i.test(u)) return true
  // extensionless CDN progressive / HLS endpoints used by MacCMS players
  if (
    /\/tos\/|playurl|byteimg|toutiao|bilivideo|aliyuncs|\/video\/tos\//i.test(u)
  ) {
    return true
  }
  // path looks like a stream, but reject HTML player shells
  if (
    /(?:^|[?&])url=|\.m3u8|mime=video|content-type=video/i.test(u) &&
    !isHtmlPlayPage(u)
  ) {
    return true
  }
  return false
}

function scoreMediaUrl(u: string): number {
  // Prefer HLS (longer-lived / less hotlink-sensitive) over signed progressive mp4
  if (/\.m3u8(\?|$)/i.test(u)) return 0
  // Short-lived / fragile CDNs (qq photo signed mp4 often 404 after minutes)
  if (/groupvideo\.photo\.qq\.com|dis_k=|dis_t=/i.test(u)) return 4
  if (/\.mp4(\?|$)/i.test(u)) return 1
  if (/\/tos\/|video\/tos|byteimg|toutiao/i.test(u)) return 2
  return 3
}

/** Prefer m3u8 / clean mp4 enough to skip further HTML hops */
function hasStrongMediaCandidate(urls: string[]): boolean {
  return urls.some(
    (u) => isLikelyMediaUrl(u) && scoreMediaUrl(u) <= 1, // m3u8=0, mp4=1
  )
}

function finishResolve(
  rule: PluginRule,
  candidatesIn: string[],
  diagnostics: string[],
): ResolvePlayResult {
  const candidates = [...new Set(candidatesIn.filter(isLikelyMediaUrl))].sort(
    (a, b) => scoreMediaUrl(a) - scoreMediaUrl(b),
  )
  if (candidates.length === 0) {
    const hint = [
      '未能解析到可播放地址（静态 HTML 中无 m3u8/mp4）。',
      '常见原因：源站把真实地址放在 JS/WebView 里、Cloudflare 校验、或规则过期。',
      '请换线路/换规则；带 WebView 媒体拦截的桌面客户端成功率通常更高。',
      diagnostics.length
        ? `诊断: ${diagnostics.slice(0, 6).join(' · ')}`
        : '',
    ]
      .filter(Boolean)
      .join(' ')
    throw new Error(hint)
  }
  const playUrl = candidates[0]!
  const referer = rule.referer || rule.baseURL
  const proxyUrl = `/api/media/proxy?url=${encodeURIComponent(playUrl)}&referer=${encodeURIComponent(referer)}`
  return {
    playUrl,
    proxyUrl,
    referer,
    headers: {
      'User-Agent': rule.userAgent || config.defaultUserAgent,
      Referer: referer,
    },
    diagnostics,
  }
}

export async function resolvePlay(
  ruleInput: unknown,
  pageUrl: string,
): Promise<ResolvePlayResult> {
  const rule = parsePluginRule(ruleInput)

  // Anime1: API + cookie-gated progressive mp4 (not static HTML media)
  {
    const { isAnime1Rule, resolveAnime1 } = await import('../lib/anime1')
    if (isAnime1Rule(rule)) {
      return await resolveAnime1(rule, pageUrl)
    }
  }

  const abs = normalizeEpisodeUrl(rule.baseURL, pageUrl)
  const diagnostics: string[] = []
  const html = await fetchHtml(abs, rule, { referer: rule.baseURL })
  let candidates = extractMediaUrls(html)
  diagnostics.push(`页面直接命中 ${candidates.length} 个媒体地址`)

  // Query-string media on play URL (cheap, no extra fetch)
  try {
    const page = new URL(abs)
    for (const v of page.searchParams.values()) {
      if (/\.(m3u8|mp4)/i.test(v) || /^https?:/i.test(v)) {
        try {
          const decoded = decodeURIComponent(v)
          if (isLikelyMediaUrl(decoded)) candidates.push(decoded)
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  // Early exit: solid m3u8/mp4 already on the play page
  if (hasStrongMediaCandidate(candidates)) {
    diagnostics.push('页面已有优质媒体地址，跳过深层解析')
    return finishResolve(rule, candidates, diagnostics)
  }

  // MacCMS player_aaaa (encrypt 0/1/2)
  const player = extractPlayerAaaa(html)
  if (player?.url) {
    const decoded = decodeMaccmsUrl(player.url, player.encrypt)
    diagnostics.push(
      `player_aaaa encrypt=${player.encrypt ?? 0} from=${player.from || '?'} → ${decoded.slice(0, 80)}`,
    )
    if (isLikelyMediaUrl(decoded)) {
      candidates.push(decoded)
    }
    // Direct media from player_aaaa — skip dplayer/iframe hops
    if (hasStrongMediaCandidate(candidates)) {
      diagnostics.push('player_aaaa 直链可用，跳过 dplayer/iframe')
      return finishResolve(rule, candidates, diagnostics)
    }

    if (/^https?:\/\//i.test(decoded)) {
      // Prefer site-side dplayer (handles nested pages behind CF on the intermediate host)
      const from = encodeURIComponent(player.from || '')
      const id = encodeURIComponent(String(player.id || '0'))
      const base = new URL(rule.baseURL)
      const dpIndex = `${base.origin}/addons/dp/player/index.php?key=0&id=${id}&uid=0&from=${from}&url=${encodeURIComponent(decoded)}`
      try {
        const dpHtml = await fetchHtml(dpIndex, rule, { referer: abs })
        candidates.push(...extractMediaUrls(dpHtml))
        candidates.push(...extractConfigUrls(dpHtml).filter(isLikelyMediaUrl))
        if (hasStrongMediaCandidate(candidates)) {
          diagnostics.push('dplayer 页已解析到媒体，跳过后续跳转')
          return finishResolve(rule, candidates, diagnostics)
        }
        // Follow window.location redirect (index.php → dp.php)
        const redirMatch = dpHtml.match(
          /window\.location\.href\s*=\s*["']([^"']+)["']/i,
        )
        const redir =
          redirMatch?.[1] ||
          extractConfigUrls(dpHtml).find((u) =>
            /dp\.php|player\/|addons\//i.test(u),
          )
        if (redir) {
          const next = normalizeEpisodeUrl(`${base.origin}/`, redir)
          diagnostics.push(`跟随播放器跳转 ${next.slice(0, 120)}`)
          const deep = await fetchHtml(next, rule, { referer: dpIndex })
          candidates.push(...extractMediaUrls(deep))
          candidates.push(...extractConfigUrls(deep).filter(isLikelyMediaUrl))
          if (hasStrongMediaCandidate(candidates)) {
            diagnostics.push('播放器跳转页已解析到媒体')
            return finishResolve(rule, candidates, diagnostics)
          }
        }
      } catch (e) {
        diagnostics.push(`dplayer 解析失败: ${(e as Error).message}`)
      }

      // Also try following the decoded intermediate page when not CF-blocked
      if (!isLikelyMediaUrl(decoded)) {
        try {
          const nested = await fetchHtml(decoded, rule, { referer: abs })
          candidates.push(...extractMediaUrls(nested))
          candidates.push(
            ...extractConfigUrls(nested).filter(isLikelyMediaUrl),
          )
          if (hasStrongMediaCandidate(candidates)) {
            diagnostics.push('中间页已解析到媒体')
            return finishResolve(rule, candidates, diagnostics)
          }
        } catch (e) {
          diagnostics.push(`中间页不可达: ${(e as Error).message}`)
        }
      }
    }
  }

  // iframe follow: only when still empty; budget wall-clock + max hops
  if (candidates.filter(isLikelyMediaUrl).length === 0) {
    const iframes = extractIframeSrcs(html)
    diagnostics.push(`发现 ${iframes.length} 个 iframe/配置地址`)
    const budgetMs = 8_000
    const deadline = Date.now() + budgetMs
    const maxIframes = 3
    for (const iframe of iframes.slice(0, maxIframes)) {
      if (Date.now() > deadline) {
        diagnostics.push('iframe 跟随超时，停止')
        break
      }
      try {
        const iframeUrl = normalizeEpisodeUrl(abs, iframe)
        if (isLikelyMediaUrl(iframeUrl)) {
          candidates.push(iframeUrl)
          if (hasStrongMediaCandidate(candidates)) break
          continue
        }
        if (!/^https?:/i.test(iframeUrl)) continue
        const nested = await fetchHtml(iframeUrl, rule, {
          referer: abs,
          timeoutMs: Math.max(2_000, deadline - Date.now()),
        })
        candidates.push(...extractMediaUrls(nested))
        candidates.push(...extractConfigUrls(nested).filter(isLikelyMediaUrl))
        if (hasStrongMediaCandidate(candidates)) {
          diagnostics.push('iframe 内已解析到媒体')
          break
        }
      } catch (e) {
        diagnostics.push(`跟随 iframe 失败: ${(e as Error).message}`)
      }
    }
  }

  return finishResolve(rule, candidates, diagnostics)
}

