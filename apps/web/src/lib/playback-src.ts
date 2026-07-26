/**
 * Choose video src: prefer direct CDN URL to save server bandwidth,
 * fall back to media proxy when CORS / hotlink blocks direct play.
 *
 * Always use proxy *entry* when:
 * - no playUrl
 * - proxy carries cookie= (auth-gated progressive sources)
 * - proxy carries adFilter= / forceAdFilter (playlist must be server-filtered;
 *   hybrid rewrite then leaves .ts on CDN unless fullProxy/cookie)
 * - forceProxy (session: after direct-play failure, or settings forceMediaProxy)
 *
 * forceProxy also sets fullProxy=1 so m3u8 rewrite still tunnels every segment
 * (not only nested playlists).
 */

export type PlaybackSrcMode = 'direct' | 'proxy'

/**
 * How media bytes are expected to flow for the chosen src.
 * - direct: entry is bare CDN URL
 * - full-proxy: every segment/key also tunnels /api/media/proxy
 * - playlist-proxy: entry (+ nested m3u8) via proxy for ad strip; .ts stay on CDN
 */
export type PlaybackTransit = 'direct' | 'full-proxy' | 'playlist-proxy'

export function proxyRequiresAuth(proxyUrl: string | undefined | null): boolean {
  if (!proxyUrl) return false
  return /[?&]cookie=/.test(proxyUrl)
}

/** Proxy URL already requests HLS discontinuity ad-filter */
export function proxyHasAdFilter(proxyUrl: string | undefined | null): boolean {
  if (!proxyUrl) return false
  return (
    /[?&]adFilter=1(?:&|$)/.test(proxyUrl) ||
    /[?&]adFilter=true(?:&|$)/.test(proxyUrl)
  )
}

export function proxyHasFullProxy(proxyUrl: string | undefined | null): boolean {
  if (!proxyUrl) return false
  return /[?&]fullProxy=(?:1|true)(?:&|$)/.test(proxyUrl)
}

/** Short UI label for WatchMeta (简介条). */
export function playbackTransitLabel(transit: PlaybackTransit): string {
  switch (transit) {
    case 'direct':
      return '直连源站'
    case 'playlist-proxy':
      return '列表代理·分片直连'
    case 'full-proxy':
    default:
      return '经服务器代理'
  }
}

export function inferPlaybackTransit(src: string, mode: PlaybackSrcMode): PlaybackTransit {
  if (mode === 'direct') return 'direct'
  if (!src) return 'full-proxy'
  // Cookie / fullProxy → server rewrite keeps every URI on proxy
  if (proxyRequiresAuth(src) || proxyHasFullProxy(src)) return 'full-proxy'
  // adFilter without the above → hybrid rewrite (segments absolute CDN)
  if (proxyHasAdFilter(src)) return 'playlist-proxy'
  // Plain proxy (CORS/hotlink fallback, no ad filter): full tunnel
  return 'full-proxy'
}

function setProxyQueryFlag(proxyUrl: string, key: string, value: string): string {
  if (!proxyUrl) return proxyUrl
  try {
    const u = new URL(proxyUrl, 'http://local.invalid')
    u.searchParams.set(key, value)
    return u.pathname + u.search
  } catch {
    const sep = proxyUrl.includes('?') ? '&' : '?'
    // naive append if not already present
    if (new RegExp(`[?&]${key}=`).test(proxyUrl)) return proxyUrl
    return `${proxyUrl}${sep}${key}=${value}`
  }
}

/**
 * Ensure media proxy URL has adFilter=1 (global force, or merge onto rule URL).
 */
export function withAdFilter(proxyUrl: string): string {
  if (!proxyUrl) return proxyUrl
  if (proxyHasAdFilter(proxyUrl)) return proxyUrl
  return setProxyQueryFlag(proxyUrl, 'adFilter', '1')
}

/**
 * forceMediaProxy / session fallback: rewrite every segment through us.
 * Without this, adFilter hybrid mode leaves .ts on the CDN.
 */
export function withFullProxy(proxyUrl: string): string {
  if (!proxyUrl) return proxyUrl
  if (/[?&]fullProxy=(?:1|true)(?:&|$)/.test(proxyUrl)) return proxyUrl
  return setProxyQueryFlag(proxyUrl, 'fullProxy', '1')
}

export function pickPlaybackSrc(opts: {
  playUrl?: string | null
  proxyUrl?: string | null
  /** User/system forced proxy after direct failed — also fullProxy segments */
  forceProxy?: boolean
  /**
   * Global force HLS ad-filter (PlayerSettings.forceAdBlocker).
   * When true, entry src is proxy with adFilter=1 (playlist filter only;
   * segments stay on CDN unless forceProxy/cookie).
   */
  forceAdFilter?: boolean
}): {
  src: string
  mode: PlaybackSrcMode
  transit: PlaybackTransit
  canTryDirect: boolean
} {
  let proxy = (opts.proxyUrl || '').trim()
  if (opts.forceAdFilter && proxy) {
    proxy = withAdFilter(proxy)
  }
  if (opts.forceProxy && proxy) {
    proxy = withFullProxy(proxy)
  }
  const play = (opts.playUrl || '').trim()
  const needProxyForAds =
    Boolean(opts.forceAdFilter) || proxyHasAdFilter(proxy)
  const canTryDirect =
    Boolean(play) &&
    /^https?:\/\//i.test(play) &&
    !proxyRequiresAuth(proxy) &&
    !needProxyForAds &&
    !opts.forceProxy

  if (canTryDirect) {
    return {
      src: play,
      mode: 'direct',
      transit: 'direct',
      canTryDirect: true,
    }
  }
  if (proxy) {
    return {
      src: proxy,
      mode: 'proxy',
      transit: inferPlaybackTransit(proxy, 'proxy'),
      canTryDirect: false,
    }
  }
  if (play) {
    return {
      src: play,
      mode: 'direct',
      transit: 'direct',
      canTryDirect: false,
    }
  }
  return {
    src: '',
    mode: 'proxy',
    transit: 'full-proxy',
    canTryDirect: false,
  }
}
