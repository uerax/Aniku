import { Hono } from 'hono'
import { filterM3u8AdsIfApplicable } from '@animaku/shared'
import { config } from '../config'
import { requireLocalOrToken } from '../lib/access'
import { fetchPublic, isPrivateHost } from '../lib/private-host'

export const mediaRoutes = new Hono()

mediaRoutes.use('*', requireLocalOrToken)

function originFromReferer(referer: string): string {
  try {
    return new URL(referer).origin
  } catch {
    return ''
  }
}

/**
 * Abort only until response headers arrive. Do NOT use AbortSignal.timeout()
 * for media proxy: that timer stays armed during body streaming and aborts
 * long progressive mp4 / HLS segments after ~20s → uncaught TimeoutError in
 * Node while the player still needs the rest of the file.
 */
function connectTimeoutSignal(ms: number): {
  signal: AbortSignal
  clear: () => void
} {
  const ac = new AbortController()
  const timer = setTimeout(() => {
    try {
      ac.abort(
        new DOMException(
          `媒体源连接超时 (${Math.round(ms / 1000)}s)`,
          'TimeoutError',
        ),
      )
    } catch {
      ac.abort()
    }
  }, ms)
  // Avoid keeping the event loop alive solely for this timer
  timer.unref?.()
  return {
    signal: ac.signal,
    clear: () => clearTimeout(timer),
  }
}

/** Drop unused upstream body so sockets can reuse (error / retry paths). */
function cancelBody(res: Response | null | undefined) {
  try {
    void res?.body?.cancel()
  } catch {
    /* ignore */
  }
}

/** Cap playlist text so a malicious "m3u8" cannot blow heap. */
const MAX_M3U8_BYTES = 1_500_000

async function readTextLimited(
  res: Response,
  maxBytes: number,
): Promise<string> {
  const cl = res.headers.get('content-length')
  if (cl) {
    const n = Number(cl)
    if (Number.isFinite(n) && n > maxBytes) {
      cancelBody(res)
      throw new Error(`播放列表过大 (${n} > ${maxBytes} bytes)`)
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
      throw new Error(`播放列表过大 (>${maxBytes} bytes)`)
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

function isM3u8Path(abs: URL): boolean {
  return /\.m3u8($|[?#])/i.test(abs.pathname + abs.search)
}

type RewriteOpts = {
  referer: string
  cookie: string
  /** Propagate so nested media playlists still filter (master is a no-op) */
  adFilter?: boolean
  /**
   * Force every public URI through proxy (cookie auth, forceMediaProxy,
   * or session fallback after direct segment failure).
   */
  fullProxy?: boolean
  /**
   * Always proxy this URI even in hybrid ad-filter mode.
   * Used for #EXT-X-KEY / MAP URI= attrs (small, often hotlink-gated).
   */
  alwaysProxy?: boolean
}

/**
 * Rewrite one playlist URI for the client.
 *
 * - Default / fullProxy / cookie: all public URIs → /api/media/proxy (classic).
 * - adFilter without cookie/fullProxy (**hybrid**): only nested .m3u8 stay on
 *   proxy (so discontinuity ads still get stripped); .ts/.m4s etc. stay on CDN.
 *   Ad strip only needs a clean playlist — segment bodies need not transit us.
 */
function rewriteM3u8Uri(u: string, base: URL, opts: RewriteOpts): string {
  const abs = new URL(u, base)
  if (isPrivateHost(abs.hostname)) {
    // Do not proxy private segment/key URLs
    return abs.toString()
  }

  const adFilter = Boolean(opts.adFilter)
  const fullProxy = Boolean(opts.fullProxy)
  const cookie = opts.cookie || ''
  const playlist = isM3u8Path(abs)

  // Hybrid ad-filter: browser pulls media segments straight from CDN.
  if (
    adFilter &&
    !cookie &&
    !fullProxy &&
    !playlist &&
    !opts.alwaysProxy
  ) {
    return abs.toString()
  }

  const q = new URLSearchParams({
    url: abs.toString(),
    referer: opts.referer,
  })
  if (cookie) q.set('cookie', cookie)
  if (fullProxy) q.set('fullProxy', '1')
  // Master → media child must keep adFilter=1; without this only the
  // top playlist is filtered (no-op on master) and ads stay in mixed.m3u8.
  // Only attach to nested playlists (.m3u8), not TS/KEY segments.
  if (adFilter && playlist) {
    q.set('adFilter', '1')
  }
  return `/api/media/proxy?${q.toString()}`
}

/** Rewrite URI="..." and URI='...' in #EXT lines (KEY / MAP / …) */
function rewriteExtUriAttrs(
  line: string,
  base: URL,
  opts: RewriteOpts,
): string {
  return line.replace(/URI=(["'])([^"']+)\1/gi, (_m, quote: string, u: string) => {
    try {
      // KEY/MAP: always proxy even in hybrid — tiny payloads, often referer-gated
      const proxied = rewriteM3u8Uri(u, base, { ...opts, alwaysProxy: true })
      return `URI=${quote}${proxied}${quote}`
    } catch {
      return `URI=${quote}${u}${quote}`
    }
  })
}

mediaRoutes.get('/proxy', async (c) => {
  const url = c.req.query('url')
  const referer = c.req.query('referer') || ''
  /** Optional upstream Cookie (e.g. anime1 path-scoped e/p/h). Not used by most sources. */
  const cookie = c.req.query('cookie') || ''
  /** HLS discontinuity ad-filter (Kazumi-style). Query: adFilter=1 */
  const adFilter =
    c.req.query('adFilter') === '1' ||
    c.req.query('adFilter') === 'true' ||
    c.req.query('hlsAdFilter') === '1'
  /**
   * fullProxy=1 → rewrite every segment through us (forceMediaProxy / fallback).
   * Cookie alone also disables hybrid segment direct (browser can't send it).
   */
  const fullProxy =
    c.req.query('fullProxy') === '1' ||
    c.req.query('fullProxy') === 'true'
  if (!url) return c.json({ error: 'bad_request', message: '缺少 url' }, 400)

  let target: URL
  try {
    target = new URL(url)
  } catch {
    return c.json({ error: 'bad_request', message: 'url 无效' }, 400)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return c.json({ error: 'bad_request', message: '仅支持 http/https' }, 400)
  }
  if (isPrivateHost(target.hostname)) {
    return c.json({ error: 'forbidden', message: '禁止代理内网地址' }, 403)
  }

  const origin = originFromReferer(referer)
  const headers: Record<string, string> = {
    'User-Agent': config.defaultUserAgent,
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  }
  if (referer) {
    headers.Referer = referer
    if (origin) headers.Origin = origin
  }
  if (cookie) {
    headers.Cookie = cookie
  }

  // forward range for seeking
  const range = c.req.header('Range')
  if (range) headers.Range = range

  let upstream: Response
  const connect = connectTimeoutSignal(20_000)
  try {
    upstream = await fetchPublic(target.toString(), {
      headers,
      signal: connect.signal,
    })
  } catch (e) {
    connect.clear()
    const msg = e instanceof Error ? e.message : String(e)
    if (/内网|重定向/.test(msg)) {
      return c.json({ error: 'forbidden', message: msg }, 403)
    }
    return c.json(
      {
        error: 'upstream',
        message: `媒体源不可达: ${msg}`,
        hint: '链接可能已过期，请重新选集解析',
      },
      502,
    )
  }
  // Headers received — allow body to stream without the connect timer.
  connect.clear()

  if (!upstream.ok && upstream.status !== 206) {
    // Cookie / auth expired (anime1 and similar)
    if (cookie && (upstream.status === 403 || upstream.status === 401)) {
      cancelBody(upstream)
      return c.json(
        {
          error: 'auth_expired',
          message: `媒体鉴权失效 (${upstream.status})`,
          hint: '播放凭证已过期，请重新解析本集',
        },
        403,
      )
    }
    // Retry once with a looser referer (some CDNs only care about site origin)
    if (origin && (upstream.status === 403 || upstream.status === 401)) {
      const failedStatus = upstream.status
      cancelBody(upstream)
      const retryConnect = connectTimeoutSignal(20_000)
      try {
        const retry = await fetchPublic(target.toString(), {
          headers: {
            ...headers,
            Referer: origin + '/',
            Origin: origin,
          },
          signal: retryConnect.signal,
        })
        retryConnect.clear()
        if (retry.ok || retry.status === 206) {
          upstream = retry
        } else {
          cancelBody(retry)
          return c.json(
            {
              error: 'upstream',
              message: `媒体源 ${retry.status}`,
              hint:
                retry.status === 404
                  ? '播放地址已失效，请重新点选集获取新链接'
                  : '源站防盗链拒绝，可换线路/规则',
            },
            502,
          )
        }
      } catch (e) {
        retryConnect.clear()
        const msg = e instanceof Error ? e.message : String(e)
        if (/内网|重定向/.test(msg)) {
          return c.json({ error: 'forbidden', message: msg }, 403)
        }
        return c.json(
          {
            error: 'upstream',
            message: `媒体源 ${failedStatus}`,
            hint: '播放地址可能已过期，请重新选集',
          },
          502,
        )
      }
    } else {
      cancelBody(upstream)
      return c.json(
        {
          error: 'upstream',
          message: `媒体源 ${upstream.status}`,
          hint:
            upstream.status === 404
              ? '播放地址已失效（常见于腾讯/签名短链），请重新点选集'
              : '源站返回错误，可换线路或规则',
        },
        502,
      )
    }
  }

  const contentType = upstream.headers.get('content-type') || ''
  const isM3u8 =
    contentType.includes('mpegurl') ||
    contentType.includes('m3u8') ||
    target.pathname.endsWith('.m3u8')

  if (isM3u8) {
    let text: string
    try {
      text = await readTextLimited(upstream, MAX_M3U8_BYTES)
    } catch (e) {
      cancelBody(upstream)
      const msg = e instanceof Error ? e.message : String(e)
      return c.json(
        {
          error: 'upstream',
          message: msg,
          hint: '播放列表异常，请重新选集或换线路',
        },
        502,
      )
    }
    const base = target
    if (adFilter) {
      try {
        const { content } = filterM3u8AdsIfApplicable(text, target.toString())
        text = content
      } catch {
        // Keep original playlist if filter fails
      }
    }
    const rewriteOpts: RewriteOpts = {
      referer,
      cookie,
      adFilter,
      fullProxy,
    }
    const rewritten = text
      .split('\n')
      .map((line) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) {
          return rewriteExtUriAttrs(line, base, rewriteOpts)
        }
        try {
          return rewriteM3u8Uri(trimmed, base, rewriteOpts)
        } catch {
          return line
        }
      })
      .join('\n')

    return c.body(rewritten, 200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      // Short client cache cuts playlist re-fetch storms; URLs stay short-lived
      'Cache-Control': 'private, max-age=5',
    })
  }

  const resHeaders: Record<string, string> = {
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, Accept-Ranges',
  }
  const pass = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
  ]
  for (const h of pass) {
    const v = upstream.headers.get(h)
    if (v) resHeaders[h] = v
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  })
})
