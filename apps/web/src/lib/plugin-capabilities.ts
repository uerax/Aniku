/** True when a source needs the server's full media proxy (for example cookie MP4). */
export function pluginNeedsFullMediaProxy(p: {
  name?: string
  baseURL?: string
  requiresFullMediaProxy?: boolean
}): boolean {
  if (p.requiresFullMediaProxy === true) return true
  if (p.requiresFullMediaProxy === false) return false

  // Compatibility for rules saved before the explicit capability field existed.
  const name = (p.name || '').toLowerCase()
  const base = (p.baseURL || '').toLowerCase()
  return (
    name === 'anime1' ||
    name.includes('anime1') ||
    base.includes('anime1.me') ||
    name === 'libvio' ||
    name.includes('libvio') ||
    base.includes('libvio')
  )
}



export function isFullProxySourceUsable(
  plugin: { requiresFullMediaProxy?: boolean; name?: string; baseURL?: string },
  mediaFullProxy: boolean,
  forceMediaProxy: boolean,
): boolean {
  return !pluginNeedsFullMediaProxy(plugin) || (mediaFullProxy && forceMediaProxy)
}

/** Backward-compatible alias for older callers. */
export function isAnime1LikePlugin(p: {
  name?: string
  baseURL?: string
  requiresFullMediaProxy?: boolean
}): boolean {
  return pluginNeedsFullMediaProxy(p)
}

/** True if this rule cannot work when the server only proxies m3u8. */
export function pluginNeedsFullMediaProxyLegacy(p: {
  name?: string
  baseURL?: string
}): boolean {
  return pluginNeedsFullMediaProxy(p)
}
