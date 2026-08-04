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



/**
 * Can a plugin appear in the watch session at all?
 * Normal sources always qualify; full-proxy sources (Anime1 / LIBVIO) need the
 * server MEDIA_FULL_PROXY=1 AND the client master "服务器代理" toggle ON.
 */
export function isFullProxySourceUsable(
  plugin: { requiresFullMediaProxy?: boolean; name?: string; baseURL?: string },
  mediaFullProxy: boolean,
  serverProxyEnabled: boolean,
): boolean {
  return (
    !pluginNeedsFullMediaProxy(plugin) || (mediaFullProxy && serverProxyEnabled)
  )
}

/**
 * Should this plugin's media actually flow through the server proxy?
 * Master switch OFF (either client toggle or server config) → never proxy.
 * Otherwise use the per-source `proxy` preference.
 */
export function pluginShouldUseProxy(
  plugin: { proxy?: boolean },
  mediaFullProxy: boolean,
  serverProxyEnabled: boolean,
): boolean {
  if (!mediaFullProxy || !serverProxyEnabled) return false
  return Boolean(plugin.proxy)
}
