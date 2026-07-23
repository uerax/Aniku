/**
 * Block SSRF targets for media proxy + plugin HTML/API fetches.
 * Hostname-only checks (no DNS rebinding resolution — Node fetch follows DNS at request time).
 */

function stripBrackets(hostname: string): string {
  // URL.hostname keeps IPv6 without brackets; still handle "[::1]"
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1)
  }
  return hostname
}

function parseIpv4(h: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some((n) => n > 255)) return null
  return parts
}

/** IPv4-mapped IPv6 :ffff:a.b.c.d */
function ipv4FromMapped(h: string): number[] | null {
  const lower = h.toLowerCase()
  const m = /:ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower)
  if (m) return parseIpv4(m[1])
  // :ffff:aabb:ccdd hex form
  const hex = /:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
  if (!hex) return null
  const a = parseInt(hex[1], 16)
  const b = parseInt(hex[2], 16)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return [(a >> 8) & 0xff, a & 0xff, (b >> 8) & 0xff, b & 0xff]
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts
  // 0.0.0.0/8
  if (a === 0) return true
  // 10.0.0.0/8
  if (a === 10) return true
  // 127.0.0.0/8
  if (a === 127) return true
  // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 169 && b === 254) return true
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true
  // 100.64.0.0/10 CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true
  // 192.0.0.0/24, 192.0.2.0/24, 198.18/15, 198.51.100/24, 203.0.113/24 — docs/benchmark
  if (a === 192 && b === 0) return true
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true
  if (a === 203 && b === 0) return true
  return false
}

function isPrivateIpv6(h: string): boolean {
  const s = h.toLowerCase()
  if (s === '::' || s === '::1') return true
  // unique local fc00::/7, link-local fe80::/10
  if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) {
    return true
  }
  // loopback / unspecified compressed
  if (s.startsWith('::ffff:')) {
    const v4 = ipv4FromMapped(s)
    if (v4 && isPrivateIpv4(v4)) return true
  }
  return false
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'kubernetes.default',
  'kubernetes.default.svc',
])

export function isPrivateHost(hostname: string): boolean {
  const h = stripBrackets(hostname).toLowerCase().trim()
  if (!h) return true
  if (BLOCKED_HOSTNAMES.has(h)) return true
  if (h.endsWith('.local') || h.endsWith('.localhost') || h.endsWith('.internal')) {
    return true
  }

  const v4 = parseIpv4(h)
  if (v4) return isPrivateIpv4(v4)

  const mapped = ipv4FromMapped(h)
  if (mapped) return isPrivateIpv4(mapped)

  // rough IPv6 (contains colon, not hostname)
  if (h.includes(':')) return isPrivateIpv6(h)

  return false
}

export function assertPublicHttpUrl(raw: string, label = 'url'): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error(`${label} 无效`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`${label} 仅支持 http/https`)
  }
  if (isPrivateHost(u.hostname)) {
    throw new Error(`${label} 禁止访问内网地址`)
  }
  return u
}

/**
 * Fetch with redirect: manual — re-check every Location against isPrivateHost.
 * Max 5 hops. Throws Error on private target / too many redirects.
 */
export async function fetchPublic(
  input: string | URL,
  init: RequestInit = {},
  opts: { timeoutMs?: number; maxRedirects?: number } = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const maxRedirects = opts.maxRedirects ?? 5
  let current =
    typeof input === 'string' ? assertPublicHttpUrl(input) : new URL(input.toString())
  if (isPrivateHost(current.hostname)) {
    throw new Error('禁止访问内网地址')
  }

  const baseHeaders = new Headers(init.headers || {})
  let method = (init.method || 'GET').toUpperCase()
  let body = init.body

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const signal =
      init.signal ??
      (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? AbortSignal.timeout(timeoutMs)
        : undefined)

    const res = await fetch(current.toString(), {
      ...init,
      method,
      headers: baseHeaders,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'manual',
      signal,
    })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res
      let next: URL
      try {
        next = new URL(loc, current)
      } catch {
        throw new Error('无效的重定向地址')
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new Error('重定向协议不支持')
      }
      if (isPrivateHost(next.hostname)) {
        throw new Error('禁止重定向到内网地址')
      }
      // 303 → GET; 301/302 historically change POST to GET for browsers
      if (
        res.status === 303 ||
        ((res.status === 301 || res.status === 302) && method !== 'GET' && method !== 'HEAD')
      ) {
        method = 'GET'
        body = undefined
      }
      current = next
      continue
    }
    return res
  }
  throw new Error('重定向次数过多')
}
