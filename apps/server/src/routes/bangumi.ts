import { Hono } from 'hono'
import {
  parseBangumiItem,
  fromBangumiCollectionType,
  toBangumiCollectionType,
  type BangumiItem,
  type BangumiEpisode,
  type BangumiCollectionEntry,
  type CollectType,
  type BangumiUser,
} from '@kazumi-web/shared'
import { config } from '../config'
import { bangumiFetch, getBearerToken } from '../lib/http'

export const bangumiRoutes = new Hono()

function tokenFrom(c: { req: { header: (n: string) => string | undefined } }) {
  return getBearerToken(c.req.header('Authorization'))
}

/** Drop heavy fields for list UIs (calendar / trending / search cards). */
function slimItem(item: BangumiItem): BangumiItem {
  return {
    ...item,
    summary: '',
    tags: item.tags?.slice(0, 6) ?? [],
    alias: [],
  }
}

bangumiRoutes.get('/calendar', async (c) => {
  const res = await bangumiFetch(`${config.bangumiNextApi}/p1/calendar`)
  if (!res.ok) {
    return c.json({ error: 'upstream', message: await res.text() }, 502)
  }
  const json = (await res.json()) as Record<string, unknown>
  // shape: { "1": [{ subject: {...} }, ...], ... }
  const days: BangumiItem[][] = []
  for (let i = 1; i <= 7; i++) {
    const list = (json[String(i)] as unknown[]) || []
    const items: BangumiItem[] = []
    for (const entry of list) {
      try {
        const e = entry as Record<string, unknown>
        const subject = (e.subject as Record<string, unknown>) || e
        items.push(slimItem(parseBangumiItem(subject)))
      } catch {
        /* skip */
      }
    }
    days.push(items)
  }
  return c.json({ data: days })
})

bangumiRoutes.get('/trending', async (c) => {
  const limit = c.req.query('limit') || '24'
  const offset = c.req.query('offset') || '0'
  const type = c.req.query('type') || '2'
  const url = new URL(`${config.bangumiNextApi}/p1/trending/subjects`)
  url.searchParams.set('type', type)
  url.searchParams.set('limit', limit)
  url.searchParams.set('offset', offset)
  const res = await bangumiFetch(url.toString())
  if (!res.ok) {
    return c.json({ error: 'upstream', message: await res.text() }, 502)
  }
  const json = (await res.json()) as { data?: unknown[] }
  const items: BangumiItem[] = []
  for (const entry of json.data || []) {
    try {
      const e = entry as Record<string, unknown>
      const subject = (e.subject as Record<string, unknown>) || e
      items.push(slimItem(parseBangumiItem(subject)))
    } catch {
      /* skip */
    }
  }
  return c.json({ data: items })
})

bangumiRoutes.post('/search', async (c) => {
  const body = await c.req.json<{
    keyword?: string
    limit?: number
    offset?: number
    sort?: string
    tags?: string[]
  }>()
  const limit = body.limit ?? 20
  const offset = body.offset ?? 0
  const sort = body.sort || 'heat'
  const tags = body.tags || []
  const params = {
    keyword: body.keyword || '',
    sort,
    filter: {
      type: [2],
      tag: tags,
      rank: sort === 'rank' ? ['>0', '<=99999'] : ['>=0', '<=99999'],
      nsfw: false,
    },
  }
  const url = `${config.bangumiApi}/v0/search/subjects?limit=${limit}&offset=${offset}`
  const res = await bangumiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    return c.json({ error: 'upstream', message: await res.text() }, 502)
  }
  const json = (await res.json()) as { data?: unknown[]; total?: number }
  const items: BangumiItem[] = []
  for (const entry of json.data || []) {
    try {
      items.push(slimItem(parseBangumiItem(entry as Record<string, unknown>)))
    } catch {
      /* skip */
    }
  }
  return c.json({ data: items, total: json.total, limit, offset })
})

bangumiRoutes.get('/subjects/:id', async (c) => {
  const id = c.req.param('id')
  const res = await bangumiFetch(`${config.bangumiApi}/v0/subjects/${id}`)
  if (!res.ok) {
    return c.json({ error: 'upstream', message: await res.text() }, res.status as 404)
  }
  const json = (await res.json()) as Record<string, unknown>
  return c.json({ data: parseBangumiItem(json) })
})

bangumiRoutes.get('/subjects/:id/episodes', async (c) => {
  const id = c.req.param('id')
  const url = new URL(`${config.bangumiApi}/v0/episodes`)
  url.searchParams.set('subject_id', id)
  url.searchParams.set('limit', c.req.query('limit') || '100')
  url.searchParams.set('offset', c.req.query('offset') || '0')
  const res = await bangumiFetch(url.toString())
  if (!res.ok) {
    return c.json({ error: 'upstream', message: await res.text() }, 502)
  }
  const json = (await res.json()) as { data?: Record<string, unknown>[]; total?: number }
  const episodes: BangumiEpisode[] = (json.data || []).map((e) => ({
    id: Number(e.id),
    type: Number(e.type ?? 0),
    sort: Number(e.sort ?? e.ep ?? 0),
    name: String(e.name ?? ''),
    nameCn: String(e.name_cn ?? ''),
    airdate: String(e.airdate ?? ''),
    ep: e.ep != null ? Number(e.ep) : undefined,
  }))
  return c.json({ data: episodes, total: json.total })
})

bangumiRoutes.get('/me', async (c) => {
  const token = tokenFrom(c)
  if (!token) return c.json({ error: 'unauthorized', message: '缺少 Access Token' }, 401)
  const res = await bangumiFetch(`${config.bangumiApi}/v0/me`, { token })
  if (!res.ok) {
    return c.json({ error: 'upstream', message: await res.text() }, res.status as 401)
  }
  const json = (await res.json()) as Record<string, unknown>
  const user: BangumiUser = {
    id: Number(json.id),
    username: String(json.username ?? json.nickname ?? ''),
    nickname: String(json.nickname ?? json.username ?? ''),
    avatar: (json.avatar as Record<string, string>) || undefined,
  }
  return c.json({ data: user })
})

bangumiRoutes.get('/collections', async (c) => {
  const token = tokenFrom(c)
  if (!token) return c.json({ error: 'unauthorized', message: '缺少 Access Token' }, 401)
  const meRes = await bangumiFetch(`${config.bangumiApi}/v0/me`, { token })
  if (!meRes.ok) {
    return c.json({ error: 'upstream', message: await meRes.text() }, 401)
  }
  const me = (await meRes.json()) as { username?: string }
  const username = me.username
  if (!username) return c.json({ error: 'bad_user', message: '无法获取用户名' }, 400)

  const limit = Number(c.req.query('limit') || 50)
  const offset = Number(c.req.query('offset') || 0)
  const type = c.req.query('type') // bangumi collection type filter optional
  const url = new URL(
    `${config.bangumiApi}/v0/users/${encodeURIComponent(username)}/collections`,
  )
  url.searchParams.set('subject_type', '2')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', String(offset))
  if (type) url.searchParams.set('type', type)

  const res = await bangumiFetch(url.toString(), { token })
  if (!res.ok) {
    return c.json({ error: 'upstream', message: await res.text() }, 502)
  }
  const json = (await res.json()) as { data?: Record<string, unknown>[]; total?: number }
  const data: BangumiCollectionEntry[] = (json.data || []).map((row) => {
    const subject = row.subject as Record<string, unknown> | undefined
    return {
      subjectId: Number(row.subject_id ?? subject?.id ?? 0),
      type: fromBangumiCollectionType(Number(row.type ?? 0)),
      updatedAt: String(row.updated_at ?? ''),
      epStatus: row.ep_status != null ? Number(row.ep_status) : undefined,
      rate: row.rate != null ? Number(row.rate) : undefined,
      comment: row.comment != null ? String(row.comment) : undefined,
      subject: subject ? parseBangumiItem(subject) : undefined,
    }
  })
  return c.json({ data, total: json.total, limit, offset })
})

bangumiRoutes.put('/collections/:subjectId', async (c) => {
  const token = tokenFrom(c)
  if (!token) return c.json({ error: 'unauthorized', message: '缺少 Access Token' }, 401)
  const subjectId = c.req.param('subjectId')
  const body = await c.req.json<{ type: CollectType }>()
  const bgmType = toBangumiCollectionType(body.type)
  if (bgmType == null) {
    return c.json({ error: 'bad_request', message: '无效收藏类型' }, 400)
  }
  const res = await bangumiFetch(
    `${config.bangumiApi}/v0/users/-/collections/${subjectId}`,
    {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: bgmType }),
    },
  )
  // Bangumi returns 204 on success for some versions, 200 with body for others
  if (!res.ok && res.status !== 204) {
    // try PATCH for update
    const res2 = await bangumiFetch(
      `${config.bangumiApi}/v0/users/-/collections/${subjectId}`,
      {
        method: 'PATCH',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: bgmType }),
      },
    )
    if (!res2.ok && res2.status !== 204) {
      return c.json(
        { error: 'upstream', message: await res2.text() },
        res2.status as 400,
      )
    }
  }
  return c.json({ ok: true, type: body.type })
})

bangumiRoutes.get('/collections/:subjectId', async (c) => {
  const token = tokenFrom(c)
  if (!token) return c.json({ error: 'unauthorized', message: '缺少 Access Token' }, 401)
  const subjectId = c.req.param('subjectId')
  const res = await bangumiFetch(
    `${config.bangumiApi}/v0/users/-/collections/${subjectId}`,
    { token },
  )
  if (res.status === 404) {
    return c.json({ data: null })
  }
  if (!res.ok) {
    return c.json({ error: 'upstream', message: await res.text() }, 502)
  }
  const row = (await res.json()) as Record<string, unknown>
  const entry: BangumiCollectionEntry = {
    subjectId: Number(row.subject_id ?? subjectId),
    type: fromBangumiCollectionType(Number(row.type ?? 0)),
    updatedAt: String(row.updated_at ?? ''),
    epStatus: row.ep_status != null ? Number(row.ep_status) : undefined,
    rate: row.rate != null ? Number(row.rate) : undefined,
    comment: row.comment != null ? String(row.comment) : undefined,
  }
  return c.json({ data: entry })
})
