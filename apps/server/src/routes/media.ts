import { Hono } from 'hono'
import { config } from '../config'

export const mediaRoutes = new Hono()

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true
  if (/^10\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true
  if (h.endsWith('.local')) return true
  return false
}

function originFromReferer(referer: string): string {
  try {
    return new URL(referer).origin
  } catch {
    return ''
  }
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
    upstream = await fetch(target.toString(), {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
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
    if (
      cookie &&
      (upstream.status === 403 || upstream.status === 401)
    ) {
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
        const retry = await fetch(target.toString(), {
          headers: {
            ...headers,
            Referer: origin + '/',
            Origin: origin,
          },
          redirect: 'follow',
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
      } catch {
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
          return line.replace(/URI="([^"]+)"/g, (_, u: string) => {
            try {
              const abs = new URL(u, base).toString()
              const q = new URLSearchParams({
                url: abs,
                referer,
              })
              if (cookie) q.set('cookie', cookie)
              const proxied = `/api/media/proxy?${q.toString()}`
              return `URI="${proxied}"`
            } catch {
              return `URI="${u}"`
            }
          })
        }
        try {
          const abs = new URL(trimmed, base).toString()
          const q = new URLSearchParams({ url: abs, referer })
          if (cookie) q.set('cookie', cookie)
          return `/api/media/proxy?${q.toString()}`
        } catch {
          return line
        }
      })
      .join('\n')

    return c.body(rewritten, 200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    })
  }

  const resHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
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
