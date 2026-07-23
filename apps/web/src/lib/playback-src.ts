/**
 * Choose video src: prefer direct CDN URL to save server bandwidth,
 * fall back to media proxy when CORS / hotlink blocks direct play.
 *
 * Always proxy when:
 * - no playUrl
 * - proxy carries cookie= (auth-gated progressive sources)
 * - forceProxy (after a direct-play failure)
 */

export type PlaybackSrcMode = 'direct' | 'proxy'

export function proxyRequiresAuth(proxyUrl: string | undefined | null): boolean {
  if (!proxyUrl) return false
  return /[?&]cookie=/.test(proxyUrl)
}

export function pickPlaybackSrc(opts: {
  playUrl?: string | null
  proxyUrl?: string | null
  /** User/system forced proxy after direct failed */
  forceProxy?: boolean
}): { src: string; mode: PlaybackSrcMode; canTryDirect: boolean } {
  const play = (opts.playUrl || '').trim()
  const proxy = (opts.proxyUrl || '').trim()
  const canTryDirect =
    Boolean(play) &&
    /^https?:\/\//i.test(play) &&
    !proxyRequiresAuth(proxy) &&
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
