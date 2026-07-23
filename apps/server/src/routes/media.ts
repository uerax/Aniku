import { Hono } from 'hono'
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

function rewriteM3u8Uri(u: string, base: URL, referer: string, cookie: string): string {
  const abs = new URL(u, base)
  if (isPrivateHost(abs.hostname)) {
    // Do not proxy private segment/key URLs
    return abs.toString()
  }
  const q = new URLSearchParams({
    url: abs.toString(),
    referer,
  })
  if (cookie) q.set('cookie', cookie)
  return `/api/media/proxy?${q.toString()}`
}

/** Rewrite URI="..." and URI='...' in #EXT lines */
function rewriteExtUriAttrs(
  line: string,
  base: URL,
  referer: string,
  cookie: string,
): string {
  return line.replace(/URI=(["'])([^"']+)\1/gi, (_m, quote: string, u: string) => {
    try {
      const proxied = rewriteM3u8Uri(u, base, referer, cookie)
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
  try {
    upstream = await fetchPublic(target.toString(), {
      headers,
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e) {
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

  if (!upstream.ok && upstream.status !== 206) {
    // Cookie / auth expired (anime1 and similar)
    if (cookie && (upstream.status === 403 || upstream.status === 401)) {
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
      try {
        const retry = await fetchPublic(target.toString(), {
          headers: {
            ...headers,
            Referer: origin + '/',
            Origin: origin,
          },
          signal: AbortSignal.timeout(20_000),
        })
        if (retry.ok || retry.status === 206) {
          upstream = retry
        } else {
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
        const msg = e instanceof Error ? e.message : String(e)
        if (/内网|重定向/.test(msg)) {
          return c.json({ error: 'forbidden', message: msg }, 403)
        }
        return c.json(
          {
            error: 'upstream',
            message: `媒体源 ${upstream.status}`,
            hint: '播放地址可能已过期，请重新选集',
          },
          502,
        )
      }
    } else {
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
    const text = await upstream.text()
    const base = target
    const rewritten = text
      .split('\n')
      .map((line) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) {
          return rewriteExtUriAttrs(line, base, referer, cookie)
        }
        try {
          return rewriteM3u8Uri(trimmed, base, referer, cookie)
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
