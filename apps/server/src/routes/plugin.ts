import { Hono } from 'hono'
import { parsePluginRule, type PluginRule } from '@animaku/shared'
import {
  searchWithRule,
  chaptersWithRule,
  resolvePlay,
} from '../rule-engine'
import { requireLocalOrToken } from '../lib/access'
import {
  PLUGIN_CACHE_TTL,
  PLUGIN_MAX_ENTRIES,
  cacheDelete,
  cacheGet,
  cacheGetOrSet,
  cacheSet,
  pluginCacheKey,
  resolveCacheTtlMs,
  wantsCacheBypass,
} from '../lib/ttl-cache'

export const pluginRoutes = new Hono()

function errStatus(message: string): 400 | 502 | 504 {
  if (/无法访问|timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed|内网|禁止/i.test(message)) {
    if (/内网|禁止/.test(message)) return 400
    return 504
  }
  if (/缺少|无效|bad/i.test(message)) return 400
  return 502
}

function cacheHeaders(hit: boolean): Record<string, string> {
  return { 'X-Cache': hit ? 'HIT' : 'MISS' }
}

function parseRuleOrThrow(raw: unknown): PluginRule {
  return parsePluginRule(raw)
}

// validate only parses JSON — no network; keep open for settings import
pluginRoutes.post('/validate', async (c) => {
  const body = await c.req.json()
  try {
    const rule = parsePluginRule(body)
    return c.json({ ok: true, rule })
  } catch (e) {
    return c.json({ ok: false, message: (e as Error).message }, 400)
  }
})

// Exec routes are open-proxy style (client supplies rule + URLs) — gate them
pluginRoutes.post('/search', requireLocalOrToken, async (c) => {
  const body = await c.req.json<{ rule: unknown; keyword: string }>()
  if (!body.keyword?.trim()) {
    return c.json({ error: 'bad_request', message: '缺少 keyword' }, 400)
  }
  if (!body.rule) {
    return c.json({ error: 'bad_request', message: '缺少 rule' }, 400)
  }
  let rule: PluginRule
  try {
    rule = parseRuleOrThrow(body.rule)
  } catch (e) {
    return c.json(
      { error: 'bad_request', message: e instanceof Error ? e.message : '规则无效' },
      400,
    )
  }
  const keyword = body.keyword.trim()
  const key = pluginCacheKey('search', rule, keyword.toLowerCase())
  const bypass = wantsCacheBypass(c)
  try {
    const { value, hit } = await cacheGetOrSet(
      key,
      PLUGIN_CACHE_TTL.search,
      () => searchWithRule(rule, keyword),
      { bypass, maxEntries: PLUGIN_MAX_ENTRIES },
    )
    // Always 200 when we finished parsing — empty items is a soft failure
    return c.json({ data: value }, 200, cacheHeaders(hit))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[plugin/search]', message)
    return c.json({ error: 'search_failed', message }, errStatus(message))
  }
})

pluginRoutes.post('/chapters', requireLocalOrToken, async (c) => {
  const body = await c.req.json<{ rule: unknown; source: string }>()
  if (!body.source?.trim() || !body.rule) {
    return c.json({ error: 'bad_request', message: '缺少 rule 或 source' }, 400)
  }
  let rule: PluginRule
  try {
    rule = parseRuleOrThrow(body.rule)
  } catch (e) {
    return c.json(
      { error: 'bad_request', message: e instanceof Error ? e.message : '规则无效' },
      400,
    )
  }
  const source = body.source.trim().replace(/\/+$/, '')
  const key = pluginCacheKey('chapters', rule, source)
  const bypass = wantsCacheBypass(c)
  try {
    const { value, hit } = await cacheGetOrSet(
      key,
      PLUGIN_CACHE_TTL.chapters,
      () => chaptersWithRule(rule, body.source.trim()),
      { bypass, maxEntries: PLUGIN_MAX_ENTRIES },
    )
    return c.json({ data: value }, 200, cacheHeaders(hit))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[plugin/chapters]', message)
    return c.json({ error: 'chapter_failed', message }, errStatus(message))
  }
})

pluginRoutes.post('/resolve', requireLocalOrToken, async (c) => {
  const body = await c.req.json<{ rule: unknown; pageUrl: string }>()
  if (!body.pageUrl?.trim() || !body.rule) {
    return c.json({ error: 'bad_request', message: '缺少 rule 或 pageUrl' }, 400)
  }
  let rule: PluginRule
  try {
    rule = parseRuleOrThrow(body.rule)
  } catch (e) {
    return c.json(
      { error: 'bad_request', message: e instanceof Error ? e.message : '规则无效' },
      400,
    )
  }
  const pageUrl = body.pageUrl.trim()
  const key = pluginCacheKey('resolve', rule, pageUrl.replace(/\/+$/, ''))
  const bypass = wantsCacheBypass(c)
  try {
    if (bypass) cacheDelete(key)
    else {
      const cached = cacheGet<Awaited<ReturnType<typeof resolvePlay>>>(key)
      if (cached) return c.json({ data: cached }, 200, cacheHeaders(true))
    }

    // Single-flight: concurrent resolves for same page share one upstream parse.
    // Store with ttl=0 inside getOrSet (no write); classify + cacheSet after.
    const { value, hit: flightHit } = await cacheGetOrSet(
      key,
      0,
      () => resolvePlay(rule, pageUrl),
      { bypass: false, maxEntries: PLUGIN_MAX_ENTRIES },
    )
    // Another waiter may have populated after classify; treat as miss for header
    // only when we were the loader path without a prior HIT above.
    if (!flightHit) {
      const ttl = resolveCacheTtlMs(value)
      if (ttl > 0) cacheSet(key, value, ttl, PLUGIN_MAX_ENTRIES)
    }
    return c.json({ data: value }, 200, cacheHeaders(false))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[plugin/resolve]', message)
    // 502 = upstream / parse ceiling (not a bug in the route itself)
    return c.json(
      {
        error: 'resolve_failed',
        message,
        // Client can surface this as "换规则" guidance
        hint:
          'Web 端仅静态解析 HTML；需 JS/WebView 的源会失败，属能力上限而非媒体文件本身损坏。',
      },
      errStatus(message),
    )
  }
})
