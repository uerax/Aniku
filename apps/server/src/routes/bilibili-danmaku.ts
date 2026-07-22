import { Hono } from 'hono'
import { gunzipSync } from 'node:zlib'
import { parseDanmakuXml, extractBvid } from '@kazumi-web/shared'
import { config } from '../config'

/**
 * Bilibili danmaku proxy (BV → cid → XML comments).
 * Browser cannot call api.bilibili.com directly (CORS); server fetches and parses.
 */
export const bilibiliDanmakuRoutes = new Hono()

const UA = config.defaultUserAgent

async function bilibiliFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: '*/*',
      Referer: 'https://www.bilibili.com/',
      Origin: 'https://www.bilibili.com',
    },
  })
}

bilibiliDanmakuRoutes.get('/bilibili', async (c) => {
  const raw = c.req.query('bvid') || c.req.query('bv') || ''
  const bvid = extractBvid(raw)
  if (!bvid) {
    return c.json(
      { error: 'bad_request', message: '请提供有效 BV 号（如 BV1xx…）' },
      400,
    )
  }
  const page = Math.max(1, Number(c.req.query('p') || c.req.query('page') || '1') || 1)

  try {
    const viewRes = await bilibiliFetch(
      `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    )
    if (!viewRes.ok) {
      const t = await viewRes.text()
      return c.json(
        {
          error: 'upstream',
          message: `B站视频信息 ${viewRes.status}: ${t.slice(0, 120)}`,
        },
        502,
      )
    }
    const viewJson = (await viewRes.json()) as {
      code?: number
      message?: string
      data?: {
        title?: string
        cid?: number
        pages?: Array<{ cid: number; page: number; part?: string }>
      }
    }
    if (viewJson.code !== 0 || !viewJson.data) {
      return c.json(
        {
          error: 'upstream',
          message: viewJson.message || `B站返回 code=${viewJson.code}`,
        },
        502,
      )
    }

    const pages = viewJson.data.pages || []
    const pageInfo =
      pages.find((p) => p.page === page) || pages[page - 1] || pages[0]
    const cid = pageInfo?.cid ?? viewJson.data.cid
    if (!cid) {
      return c.json({ error: 'upstream', message: '未找到分 P / cid' }, 502)
    }

    // Classic XML endpoint (often gzip). Fallback to list.so.
    let xml = ''
    const xmlUrls = [
      `https://comment.bilibili.com/${cid}.xml`,
      `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`,
    ]
    let lastErr = ''
    for (const u of xmlUrls) {
      try {
        const res = await bilibiliFetch(u)
        if (!res.ok) {
          lastErr = `${u} → ${res.status}`
          continue
        }
        const buf = Buffer.from(await res.arrayBuffer())
        // gzip magic
        if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
          xml = gunzipSync(buf).toString('utf8')
        } else {
          xml = buf.toString('utf8')
        }
        if (xml.includes('<d ')) break
        lastErr = `${u} → empty danmaku`
        xml = ''
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }

    if (!xml) {
      return c.json(
        {
          error: 'upstream',
          message: `拉取弹幕失败：${lastErr || '未知'}`,
        },
        502,
      )
    }

    const comments = parseDanmakuXml(xml)
    return c.json({
      data: comments,
      count: comments.length,
      meta: {
        bvid,
        cid,
        page,
        title: viewJson.data.title || '',
        part: pageInfo?.part || '',
        pages: pages.map((p) => ({
          page: p.page,
          cid: p.cid,
          part: p.part || `P${p.page}`,
        })),
      },
    })
  } catch (e) {
    return c.json(
      {
        error: 'upstream',
        message: e instanceof Error ? e.message : String(e),
      },
      502,
    )
  }
})
