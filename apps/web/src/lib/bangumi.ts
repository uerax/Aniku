import { api } from './api'
import type {
  BangumiItem,
  BangumiEpisode,
  BangumiUser,
  BangumiCollectionEntry,
  CollectType,
} from '@aniku/shared'
import { useSettingsStore } from '../stores/settings'

function token() {
  return useSettingsStore.getState().bangumiToken || null
}

export const bangumiApi = {
  calendar: () =>
    api<{ data: BangumiItem[][] }>('/api/bangumi/calendar'),
  trending: (limit = 24, offset = 0) =>
    api<{ data: BangumiItem[] }>(
      `/api/bangumi/trending?limit=${limit}&offset=${offset}`,
    ),
  search: (
    keyword: string,
    opts?: {
      limit?: number
      offset?: number
      /** heat | rank | score | date (放送时间, page-local) | match */
      sort?: string
      tags?: string[]
      year?: number | null
      airDate?: string[]
    },
  ) =>
    api<{ data: BangumiItem[]; total?: number; limit?: number; offset?: number }>(
      '/api/bangumi/search',
      {
        method: 'POST',
        body: JSON.stringify({
          keyword,
          limit: opts?.limit ?? 20,
          offset: opts?.offset ?? 0,
          sort: opts?.sort,
          tags: opts?.tags,
          year: opts?.year ?? undefined,
          airDate: opts?.airDate,
        }),
      },
    ),
  subject: (id: number | string) =>
    api<{ data: BangumiItem }>(`/api/bangumi/subjects/${id}`),
  episodes: (id: number | string) =>
    api<{ data: BangumiEpisode[] }>(`/api/bangumi/subjects/${id}/episodes`),
  me: () => api<{ data: BangumiUser }>('/api/bangumi/me', { token: token() }),
  collections: (opts?: { limit?: number; offset?: number; type?: number }) => {
    const q = new URLSearchParams()
    if (opts?.limit) q.set('limit', String(opts.limit))
    if (opts?.offset) q.set('offset', String(opts.offset))
    if (opts?.type) q.set('type', String(opts.type))
    return api<{ data: BangumiCollectionEntry[]; total?: number }>(
      `/api/bangumi/collections?${q}`,
      { token: token() },
    )
  },
  getCollection: (subjectId: number | string) =>
    api<{ data: BangumiCollectionEntry | null }>(
      `/api/bangumi/collections/${subjectId}`,
      { token: token() },
    ),
  setCollection: (subjectId: number | string, type: CollectType) =>
    api<{ ok: boolean; type: CollectType }>(
      `/api/bangumi/collections/${subjectId}`,
      {
        method: 'PUT',
        token: token(),
        body: JSON.stringify({ type }),
      },
    ),
}
