import { api } from './api'
import type {
  DanmakuAnime,
  DanmakuEpisode,
  DanmakuComment,
  PluginRule,
  PluginSearchResult,
  PluginChapterResult,
  ResolvePlayResult,
  PluginCatalogItem,
} from '@kazumi-web/shared'

export const danmakuApi = {
  status: () =>
    api<{ configured: boolean; usingFallback?: boolean }>('/api/danmaku/status'),
  search: (keyword: string) =>
    api<{ data: DanmakuAnime[] }>(
      `/api/danmaku/search?keyword=${encodeURIComponent(keyword)}`,
    ),
  bangumi: (id: number | string) =>
    api<{ data: { bangumiId: number; episodes: DanmakuEpisode[] } }>(
      `/api/danmaku/bangumi/${id}`,
    ),
  bangumiByBgm: (bgmId: number | string) =>
    api<{ data: { bangumiId: number; episodes: DanmakuEpisode[] } }>(
      `/api/danmaku/bangumi/bgmtv/${bgmId}`,
    ),
  comments: (episodeId: number | string) =>
    api<{ data: DanmakuComment[]; count: number }>(
      `/api/danmaku/comment/${episodeId}?withRelated=true&chConvert=1`,
    ),
  /** BV 号 / 链接 → 解析弹幕（服务端代理 B 站） */
  bilibili: (bvid: string, page = 1) =>
    api<{
      data: DanmakuComment[]
      count: number
      meta: {
        bvid: string
        cid: number
        page: number
        title: string
        part: string
        pages: Array<{ page: number; cid: number; part: string }>
      }
    }>(
      `/api/danmaku/bilibili?bvid=${encodeURIComponent(bvid)}&p=${page}`,
    ),
}

export const pluginApi = {
  validate: (rule: unknown) =>
    api<{ ok: boolean; rule?: PluginRule; message?: string }>(
      '/api/plugin/validate',
      { method: 'POST', body: JSON.stringify(rule) },
    ),
  search: (rule: PluginRule, keyword: string) =>
    api<{ data: PluginSearchResult }>('/api/plugin/search', {
      method: 'POST',
      body: JSON.stringify({ rule, keyword }),
    }),
  chapters: (rule: PluginRule, source: string) =>
    api<{ data: PluginChapterResult }>('/api/plugin/chapters', {
      method: 'POST',
      body: JSON.stringify({ rule, source }),
    }),
  resolve: (rule: PluginRule, pageUrl: string) =>
    api<{ data: ResolvePlayResult }>('/api/plugin/resolve', {
      method: 'POST',
      body: JSON.stringify({ rule, pageUrl }),
    }),
  /** KazumiRules index.json via server proxy */
  catalog: (mirror = false) =>
    api<{ data: PluginCatalogItem[]; source: string }>(
      `/api/plugin/catalog${mirror ? '?mirror=1' : ''}`,
    ),
  /** Download a single rule body by name */
  download: (name: string, mirror = false) =>
    api<{ data: PluginRule; source: string }>(
      `/api/plugin/catalog/${encodeURIComponent(name)}${mirror ? '?mirror=1' : ''}`,
    ),
}
