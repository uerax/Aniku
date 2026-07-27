/**
 * Which built-in / known sources need MEDIA_FULL_PROXY=1
 * (cookie progressive mp4 or equivalent whole-file tunnel).
 */

export function isAnime1LikePlugin(p: {
  name?: string
  baseURL?: string
}): boolean {
  const name = (p.name || '').toLowerCase()
  const base = (p.baseURL || '').toLowerCase()
  return (
    name === 'anime1' ||
    name.includes('anime1') ||
    base.includes('anime1.me')
  )
}

/** True if this rule cannot work when the server only proxies m3u8. */
export function pluginNeedsFullMediaProxy(p: {
  name?: string
  baseURL?: string
}): boolean {
  return isAnime1LikePlugin(p)
}
