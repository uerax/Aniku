import { Hono } from 'hono'
import { parsePluginRule } from '@aniku/shared'
import {
  searchWithRule,
  chaptersWithRule,
  resolvePlay,
} from '../rule-engine'
import { requireLocalOrToken } from '../lib/access'

export const pluginRoutes = new Hono()

function errStatus(message: string): 400 | 502 | 504 {
  if (/无法访问|timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed|内网|禁止/i.test(message)) {
    if (/内网|禁止/.test(message)) return 400
    return 504
  }
  if (/缺少|无效|bad/i.test(message)) return 400
  return 502
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
  try {
    const result = await searchWithRule(body.rule, body.keyword.trim())
    // Always 200 when we finished parsing — empty items is a soft failure
    return c.json({ data: result })
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
  try {
    const result = await chaptersWithRule(body.rule, body.source.trim())
    return c.json({ data: result })
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
  try {
    const result = await resolvePlay(body.rule, body.pageUrl.trim())
    return c.json({ data: result })
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
