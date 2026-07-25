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
} from '@aniku/shared'

type SignalOpt = { signal?: AbortSignal }

export const danmakuApi = {
  status: (opts?: SignalOpt) =>
    api<{ configured: boolean; usingFallback?: boolean }>('/api/danmaku/status', {
      signal: opts?.signal,
    }),
  search: (keyword: string, opts?: SignalOpt) =>
    api<{ data: DanmakuAnime[] }>(
      `/api/danmaku/search?keyword=${encodeURIComponent(keyword)}`,
      { signal: opts?.signal },
    ),
  bangumi: (id: number | string, opts?: SignalOpt) =>
    api<{ data: { bangumiId: number; episodes: DanmakuEpisode[] } }>(
      `/api/danmaku/bangumi/${id}`,
      { signal: opts?.signal },
    ),
  bangumiByBgm: (bgmId: number | string, opts?: SignalOpt) =>
    api<{ data: { bangumiId: number; episodes: DanmakuEpisode[] } }>(
      `/api/danmaku/bangumi/bgmtv/${bgmId}`,
      { signal: opts?.signal },
    ),
  comments: (episodeId: number | string, opts?: SignalOpt) =>
    api<{ data: DanmakuComment[]; count: number }>(
      `/api/danmaku/comment/${episodeId}?withRelated=true&chConvert=1`,
      { signal: opts?.signal },
    ),
  /** BV 号 / 链接 → 解析弹幕（服务端代理 B 站） */
  bilibili: (bvid: string, page = 1, opts?: SignalOpt) =>
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
      { signal: opts?.signal },
    ),
}

export const pluginApi = {
  validate: (rule: unknown, opts?: SignalOpt) =>
    api<{ ok: boolean; rule?: PluginRule; message?: string }>(
      '/api/plugin/validate',
      { method: 'POST', body: JSON.stringify(rule), signal: opts?.signal },
    ),
  search: (rule: PluginRule, keyword: string, opts?: SignalOpt) =>
    api<{ data: PluginSearchResult }>('/api/plugin/search', {
      method: 'POST',
      body: JSON.stringify({ rule, keyword }),
      signal: opts?.signal,
    }),
  chapters: (rule: PluginRule, source: string, opts?: SignalOpt) =>
    api<{ data: PluginChapterResult }>('/api/plugin/chapters', {
      method: 'POST',
      body: JSON.stringify({ rule, source }),
      signal: opts?.signal,
    }),
  resolve: (rule: PluginRule, pageUrl: string, opts?: SignalOpt) =>
    api<{ data: ResolvePlayResult }>('/api/plugin/resolve', {
      method: 'POST',
      body: JSON.stringify({ rule, pageUrl }),
      signal: opts?.signal,
    }),
  /** KazumiRules index.json via server proxy */
  catalog: (mirror = false, opts?: SignalOpt) =>
    api<{ data: PluginCatalogItem[]; source: string }>(
      `/api/plugin/catalog${mirror ? '?mirror=1' : ''}`,
      { signal: opts?.signal },
    ),
  /** Download a single rule body by name */
  download: (name: string, mirror = false, opts?: SignalOpt) =>
    api<{ data: PluginRule; source: string }>(
      `/api/plugin/catalog/${encodeURIComponent(name)}${mirror ? '?mirror=1' : ''}`,
      { signal: opts?.signal },
    ),
}
