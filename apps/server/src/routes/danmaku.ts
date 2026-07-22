import { Hono } from 'hono'
import { parseDanmakuComments } from '@kazumi-web/shared'
import { dandanGet, isDanmakuUsingFallback } from '../lib/dandan'

export const danmakuRoutes = new Hono()

danmakuRoutes.get('/status', (c) =>
  c.json({
    // Always usable: user open-platform keys or agefans-compatible fallback
    configured: true,
    usingFallback: isDanmakuUsingFallback(),
  }),
)

danmakuRoutes.get('/search', async (c) => {
  const keyword = c.req.query('keyword')
  if (!keyword) return c.json({ error: 'bad_request', message: '缺少 keyword' }, 400)
  try {
    const json = (await dandanGet('/api/v2/search/anime', { keyword })) as {
      success?: boolean
      errorMessage?: string
      animes?: Array<Record<string, unknown>>
    }
    if (json.success === false) {
      return c.json({ error: 'upstream', message: json.errorMessage }, 502)
    }
    const animes = (json.animes || []).map((o) => ({
      animeId: Number(o.animeId),
      animeTitle: String(o.animeTitle ?? ''),
      bangumiId: o.bangumiId != null ? String(o.bangumiId) : undefined,
      episodeCount: o.episodeCount != null ? Number(o.episodeCount) : undefined,
      typeDescription:
        o.typeDescription != null ? String(o.typeDescription) : undefined,
      imageUrl: o.imageUrl != null ? String(o.imageUrl) : undefined,
    }))
    return c.json({ data: animes })
  } catch (e) {
    return c.json(
      { error: 'upstream', message: e instanceof Error ? e.message : String(e) },
      502,
    )
  }
})

danmakuRoutes.get('/bangumi/bgmtv/:bgmId', async (c) => {
  const bgmId = c.req.param('bgmId')
  try {
    const json = (await dandanGet(`/api/v2/bangumi/bgmtv/${bgmId}`)) as {
      success?: boolean
      errorMessage?: string
      bangumi?: { animeId?: number; episodes?: Array<Record<string, unknown>> }
      bangumiId?: number
    }
    if (json.success === false) {
      return c.json({ error: 'upstream', message: json.errorMessage }, 502)
    }
    const bangumi = json.bangumi || json
    const episodes = (
      (bangumi as { episodes?: Array<Record<string, unknown>> }).episodes || []
    ).map((e) => ({
      episodeId: Number(e.episodeId),
      episodeTitle: String(e.episodeTitle ?? ''),
    }))
    return c.json({
      data: {
        bangumiId: Number(
          (bangumi as { animeId?: number }).animeId ??
            (bangumi as { bangumiId?: number }).bangumiId ??
            0,
        ),
        episodes,
      },
    })
  } catch (e) {
    return c.json(
      { error: 'upstream', message: e instanceof Error ? e.message : String(e) },
      502,
    )
  }
})

danmakuRoutes.get('/bangumi/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const json = (await dandanGet(`/api/v2/bangumi/${id}`)) as {
      success?: boolean
      errorMessage?: string
      bangumi?: { episodes?: Array<Record<string, unknown>>; animeId?: number }
    }
    if (json.success === false) {
      return c.json({ error: 'upstream', message: json.errorMessage }, 502)
    }
    const episodes = (json.bangumi?.episodes || []).map((e) => ({
      episodeId: Number(e.episodeId),
      episodeTitle: String(e.episodeTitle ?? ''),
    }))
    return c.json({
      data: {
        bangumiId: Number(json.bangumi?.animeId ?? id),
        episodes,
      },
    })
  } catch (e) {
    return c.json(
      { error: 'upstream', message: e instanceof Error ? e.message : String(e) },
      502,
    )
  }
})

danmakuRoutes.get('/comment/:episodeId', async (c) => {
  const episodeId = c.req.param('episodeId')
  const withRelated = c.req.query('withRelated') ?? 'true'
  const chConvert = c.req.query('chConvert') ?? '1'
  try {
    const json = (await dandanGet(`/api/v2/comment/${episodeId}`, {
      withRelated,
      chConvert,
    })) as { comments?: { m: string; p: string }[]; count?: number }
    const comments = parseDanmakuComments(json.comments || [])
    return c.json({ data: comments, count: json.count ?? comments.length })
  } catch (e) {
    return c.json(
      { error: 'upstream', message: e instanceof Error ? e.message : String(e) },
      502,
    )
  }
})
