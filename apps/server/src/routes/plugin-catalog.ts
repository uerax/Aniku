import { Hono } from 'hono'
import type { PluginCatalogItem } from '@aniku/shared'
import { parsePluginRule } from '@aniku/shared'
import { config } from '../config'

export const pluginCatalogRoutes = new Hono()

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

function bases(preferMirror: boolean): string[] {
  const primary = config.pluginShop.endsWith('/')
    ? config.pluginShop
    : `${config.pluginShop}/`
  const mirror = config.pluginShopMirror.endsWith('/')
    ? config.pluginShopMirror
    : `${config.pluginShopMirror}/`
  return preferMirror ? [mirror, primary] : [primary, mirror]
}

async function fetchTextFromShop(
  path: string,
  preferMirror: boolean,
): Promise<{ text: string; source: string }> {
  const errors: string[] = []
  for (const base of bases(preferMirror)) {
    const url = `${base}${path.replace(/^\//, '')}`
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': config.defaultUserAgent,
          Accept: 'application/json,text/plain,*/*',
        },
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) {
        errors.push(`${url} → HTTP ${res.status}`)
        continue
      }
      const text = await res.text()
      if (!text.trim()) {
        errors.push(`${url} → empty body`)
        continue
      }
      return { text, source: base }
    } catch (e) {
      errors.push(`${url} → ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(`无法访问规则仓库: ${errors.join('; ')}`)
}

function parseCatalogList(raw: string): PluginCatalogItem[] {
  const data = JSON.parse(raw) as unknown
  if (!Array.isArray(data)) {
    throw new Error('规则目录格式错误：根节点必须是数组')
  }
  const items: PluginCatalogItem[] = []
  for (const value of data) {
    if (!value || typeof value !== 'object') continue
    const j = value as Record<string, unknown>
    const name = String(j.name ?? '').trim()
    if (!name) continue
    const rawConfig = j.antiCrawlerConfig
    const antiCrawlerEnabled =
      rawConfig && typeof rawConfig === 'object'
        ? Boolean((rawConfig as { enabled?: boolean }).enabled)
        : Boolean(j.antiCrawlerEnabled ?? false)
    items.push({
      name,
      version: String(j.version ?? ''),
      useNativePlayer: Boolean(j.useNativePlayer ?? true),
      author: String(j.author ?? ''),
      lastUpdate: Number(j.lastUpdate ?? 0) || 0,
      antiCrawlerEnabled,
    })
  }
  if (data.length > 0 && items.length === 0) {
    throw new Error('规则目录中没有有效条目')
  }
  return items
}

/** GET /api/plugin/catalog?mirror=1 */
pluginCatalogRoutes.get('/catalog', async (c) => {
  const preferMirror =
    c.req.query('mirror') === '1' || c.req.query('mirror') === 'true'
  try {
    const { text, source } = await fetchTextFromShop('index.json', preferMirror)
    const items = parseCatalogList(text)
    return c.json({ data: items, source })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[plugin/catalog]', message)
    return c.json({ error: 'catalog_failed', message }, 502)
  }
})

/** GET /api/plugin/catalog/:name — download full rule JSON */
pluginCatalogRoutes.get('/catalog/:name', async (c) => {
  const name = c.req.param('name')
  if (!NAME_RE.test(name)) {
    return c.json({ error: 'bad_request', message: '规则名称无效' }, 400)
  }
  const preferMirror =
    c.req.query('mirror') === '1' || c.req.query('mirror') === 'true'
  try {
    const { text, source } = await fetchTextFromShop(
      `${name}.json`,
      preferMirror,
    )
    const json = JSON.parse(text) as unknown
    const rule = parsePluginRule(json)
    // Preserve catalog name spelling when payload name differs only by case
    if (rule.name.toLowerCase() !== name.toLowerCase()) {
      return c.json(
        {
          error: 'name_mismatch',
          message: `下载的规则名 ${rule.name} 与请求 ${name} 不一致`,
        },
        502,
      )
    }
    rule.name = name
    return c.json({ data: rule, source })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[plugin/catalog/:name]', name, message)
    return c.json({ error: 'download_failed', message }, 502)
  }
})
