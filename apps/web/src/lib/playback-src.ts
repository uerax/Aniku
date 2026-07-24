/**
 * Choose video src: prefer direct CDN URL to save server bandwidth,
 * fall back to media proxy when CORS / hotlink blocks direct play.
 *
 * Always proxy when:
 * - no playUrl
 * - proxy carries cookie= (auth-gated progressive sources)
 * - proxy carries adFilter= (HLS ad strip only works on proxied playlists)
 * - forceProxy (session: after direct-play failure, or settings forceMediaProxy)
 * - forceAdFilter with a proxyUrl available (global forceAdBlocker)
 */

export type PlaybackSrcMode = 'direct' | 'proxy'

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

/**
 * Ensure media proxy URL has adFilter=1 (global force, or merge onto rule URL).
 */
export function withAdFilter(proxyUrl: string): string {
  if (!proxyUrl) return proxyUrl
  if (proxyHasAdFilter(proxyUrl)) return proxyUrl
  try {
    // Relative /api/... is fine for URL with base
    const u = new URL(proxyUrl, 'http://local.invalid')
    u.searchParams.set('adFilter', '1')
    return u.pathname + u.search
  } catch {
    const sep = proxyUrl.includes('?') ? '&' : '?'
    return `${proxyUrl}${sep}adFilter=1`
  }
}

export function pickPlaybackSrc(opts: {
  playUrl?: string | null
  proxyUrl?: string | null
  /** User/system forced proxy after direct failed */
  forceProxy?: boolean
  /**
   * Global force HLS ad-filter (PlayerSettings.forceAdBlocker).
   * When true, always use proxy and ensure adFilter=1.
   */
  forceAdFilter?: boolean
}): { src: string; mode: PlaybackSrcMode; canTryDirect: boolean } {
  let proxy = (opts.proxyUrl || '').trim()
  if (opts.forceAdFilter && proxy) {
    proxy = withAdFilter(proxy)
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
    return { src: play, mode: 'direct', canTryDirect: true }
  }
  if (proxy) {
    return { src: proxy, mode: 'proxy', canTryDirect: false }
  }
  if (play) {
    return { src: play, mode: 'direct', canTryDirect: false }
  }
  return { src: '', mode: 'proxy', canTryDirect: false }
}
