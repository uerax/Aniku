import { api } from './api'
import type {
  BangumiItem,
  BangumiEpisode,
  BangumiUser,
  BangumiCollectionEntry,
  CollectType,
} from '@animaku/shared'
import { useSettingsStore } from '../stores/settings'

function token() {
  return useSettingsStore.getState().bangumiToken || null
}

type SignalOpt = { signal?: AbortSignal }

export const bangumiApi = {
  calendar: (opts?: SignalOpt) =>
    api<{ data: BangumiItem[][] }>('/api/bangumi/calendar', {
      signal: opts?.signal,
    }),
  trending: (limit = 24, offset = 0, opts?: SignalOpt) =>
    api<{ data: BangumiItem[] }>(
      `/api/bangumi/trending?limit=${limit}&offset=${offset}`,
      { signal: opts?.signal },
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
      signal?: AbortSignal
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
        signal: opts?.signal,
      },
    ),
  subject: (id: number | string, opts?: SignalOpt) =>
    api<{ data: BangumiItem }>(`/api/bangumi/subjects/${id}`, {
      signal: opts?.signal,
    }),
  episodes: (id: number | string, opts?: SignalOpt) =>
    api<{ data: BangumiEpisode[] }>(`/api/bangumi/subjects/${id}/episodes`, {
      signal: opts?.signal,
    }),
  me: (opts?: SignalOpt) =>
    api<{ data: BangumiUser }>('/api/bangumi/me', {
      token: token(),
      signal: opts?.signal,
    }),
  collections: (opts?: {
    limit?: number
    offset?: number
    type?: number
    signal?: AbortSignal
  }) => {
    const q = new URLSearchParams()
    if (opts?.limit) q.set('limit', String(opts.limit))
    if (opts?.offset) q.set('offset', String(opts.offset))
    if (opts?.type) q.set('type', String(opts.type))
    return api<{ data: BangumiCollectionEntry[]; total?: number }>(
      `/api/bangumi/collections?${q}`,
      { token: token(), signal: opts?.signal },
    )
  },
  getCollection: (subjectId: number | string, opts?: SignalOpt) =>
    api<{ data: BangumiCollectionEntry | null }>(
      `/api/bangumi/collections/${subjectId}`,
      { token: token(), signal: opts?.signal },
    ),
  setCollection: (subjectId: number | string, type: CollectType, opts?: SignalOpt) =>
    api<{ ok: boolean; type: CollectType }>(
      `/api/bangumi/collections/${subjectId}`,
      {
        method: 'PUT',
        token: token(),
        body: JSON.stringify({ type }),
        signal: opts?.signal,
      },
    ),
}
