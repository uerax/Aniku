import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  buildSearchKeywords,
  rankSearchItems,
  bestTitleSimilarity,
  coverOf,
  type BangumiItem,
  type PluginMeta,
  type SearchItem,
  type Road,
  type DanmakuSettings,
  type PlayerSettings,
} from '@animaku/shared'
import { bangumiApi } from './bangumi'
import { pluginApi } from './plugin-api'
import { pickPlaybackSrc, type PlaybackTransit } from './playback-src'
import {
  getCachedPluginSearch,
  setCachedPluginSearch,
} from './plugin-result-cache'
import { pluginNeedsFullMediaProxy } from './plugin-capabilities'
import {
  findRoadsForPlay,
  writeRoadsForSource,
} from './roads-cache'
import {
  fetchServerHealth,
  mediaFullProxyEnabled,
} from './server-capabilities'
import { useDanmakuSession, type DanmakuSession } from './use-danmaku-session'
import { usePluginStore } from '../stores/plugins'
import { useHistoryStore } from '../stores/history'
import { useSettingsStore } from '../stores/settings'
import { EMPTY_ARRAY, FALLBACK_DANMAKU, FALLBACK_PLAYER } from './stable'

export type SearchRow = {
  plugin: PluginMeta
  items: SearchItem[]
  error?: string
  pending?: boolean
  /** true after user has triggered at least one search for this plugin */
  searched?: boolean
  keyword?: string
}

export type SourceSelection = {
  plugin: PluginMeta
  source: SearchItem
  roads: Road[]
}

export type EpisodePlay = {
  pageUrl: string
  episode: number
  road: number
}

/**
 * Min title similarity before auto-picking the first ranked search hit.
 * Below this, show the list and let the user choose (avoids MacCMS wrong-show).
 */
export const AUTO_PICK_MIN_SIMILARITY = 0.55

/** Seconds of history progress required before continue-play seeks. */
const RESUME_MIN_POSITION = 15

function lookupResumePosition(
  bangumiId: number,
  pluginName: string,
  episode: number,
  road: number,
): number {
  const items = useHistoryStore.getState().items
  const list = Array.isArray(items) ? items : []
  const h = list.find(
    (i) =>
      i.bangumiId === bangumiId &&
      i.pluginName === pluginName &&
      i.episode === episode &&
      i.road === road,
  )
  return h?.position || 0
}

/** Prefer history sourceUrl; fall back to query `source` when present. */
function lookupHistorySourceUrl(
  bangumiId: number,
  pluginName: string,
  pageUrl: string,
): string {
  const items = useHistoryStore.getState().items
  const list = Array.isArray(items) ? items : []
  const norm = (u: string) => u.replace(/\/+$/, '')
  const target = norm(pageUrl)
  const hit = list.find(
    (i) =>
      i.bangumiId === bangumiId &&
      i.pluginName === pluginName &&
      (norm(i.pageUrl) === target ||
        (i.sourceUrl && norm(i.sourceUrl) === target)),
  )
  return (hit?.sourceUrl || '').trim()
}

/**
 * First enabled plugin based on user order, falling back to alphabetical.
 * This is the default source auto-searched on first visit.
 */
function findDefaultSourcePlugin(list: PluginMeta[], order: string[]): PluginMeta | undefined {
  if (!list.length) return undefined
  if (order.length) {
    // Find first plugin whose name appears in the user's order
    for (const name of order) {
      const hit = list.find(
        (p) => p.name.toLowerCase() === name.toLowerCase(),
      )
      if (hit) return hit
    }
  }
  // Fallback: alphabetical (Anime1 last)
  return [...list].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  )[0]
}

/** Sort search rows by stored order (first = top), falling back to alphabetical. */
function orderSearchRows(rows: SearchRow[], order: string[]): SearchRow[] {
  if (!order.length) {
    return [...rows].sort((a, b) =>
      a.plugin.name.toLowerCase().localeCompare(b.plugin.name.toLowerCase()),
    )
  }
  const rank = new Map<string, number>()
  for (let i = 0; i < order.length; i++) {
    rank.set(order[i].toLowerCase(), i)
  }
  return [...rows].sort((a, b) => {
    const ra = rank.get(a.plugin.name.toLowerCase()) ?? order.length
    const rb = rank.get(b.plugin.name.toLowerCase()) ?? order.length
    if (ra !== rb) return ra - rb
    return a.plugin.name.toLowerCase().localeCompare(b.plugin.name.toLowerCase())
  })
}

export type WatchSession = {
  bangumiId: number
  title: string
  cover: string
  bangumiItem: BangumiItem | undefined
  subjectLoading: boolean
  subjectError: unknown
  keywordCandidates: string[]
  titleRefs: string[]
  sessionKeywords: Record<string, string[]>
  searchResults: SearchRow[]
  searchKeyword: string
  defaultKeyword: string
  /** Preferred / auto-started rule name (MXdm when available). */
  defaultSourceName: string
  selection: SourceSelection | null
  episode: EpisodePlay | null
  visibleRoad: number
  setVisibleRoad: (n: number) => void
  roadLoading: boolean
  roadError: string
  pendingSource: { pluginName: string; src: string } | null
  keywordTargetPlugin: PluginMeta | null
  setKeywordTargetPlugin: (p: PluginMeta | null) => void
  mediaSrc: string
  playbackMode: 'direct' | 'proxy'
  /** direct | playlist-proxy (ad hybrid) | full-proxy — for WatchMeta hint */
  playbackTransit: PlaybackTransit
  playerKey: string
  resumeTime: number
  resolveLoading: boolean
  resolveError: unknown
  diagnostics: string[] | undefined
  danmakuSettings: DanmakuSettings
  playerSettings: PlayerSettings
  setDanmaku: (p: Partial<DanmakuSettings>) => void
  setPlayer: (p: Partial<PlayerSettings>) => void
  dm: DanmakuSession
  enabledPlugins: PluginMeta[]
  /**
   * Click a rule → search that plugin only (no fan-out).
   * Uses defaultKeyword when keyword omitted.
   */
  openPluginSearch: (
    plugin: PluginMeta,
    keyword?: string,
    opts?: { clearSelection?: boolean; autoPickFirst?: boolean },
  ) => Promise<void>
  searchOnePlugin: (
    plugin: PluginMeta,
    keyword: string,
    opts?: { clearSelection?: boolean; autoPickFirst?: boolean },
  ) => Promise<void>
  reSearchCurrentSource: (keyword: string) => Promise<void>
  pickSource: (plugin: PluginMeta, item: SearchItem) => Promise<void>
  pickEpisode: (epIndex: number, roadIndex?: number) => void
  goAdjacentEpisode: (delta: number) => void
  onProgress: (position: number, duration: number) => void
  onMediaAuthExpired: (position: number) => Promise<void>
  onMediaLoadFailed: (args: { position: number }) => void
  refetchResolve: () => void
  pageUrl: string
  pluginName: string
}

/**
 * Unified cinema session on subject/play.
 * Plugin list is idle until user clicks a source — no auto fan-out.
 */
export function useWatchSession(bangumiId: number): WatchSession {
  const [params, setParams] = useSearchParams()
  const qPlugin = params.get('plugin') || ''
  const qPageUrl = params.get('pageUrl') || ''
  const qEp = Number(params.get('ep') || '0')
  const qRoad = Number(params.get('road') || '0')
  const qTitle = params.get('title') || ''
  const qCover = params.get('cover') || ''

  const ensureDefaults = usePluginStore((s) => s.ensureDefaults)
  const allPlugins = usePluginStore((s) =>
    Array.isArray(s.plugins) ? s.plugins : EMPTY_ARRAY,
  )
  const pluginOrder = usePluginStore((s) =>
    Array.isArray(s.pluginOrder) ? s.pluginOrder : EMPTY_ARRAY as string[],
  )
  const serverCaps = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchServerHealth(signal),
    staleTime: 60_000,
  })
  const mediaFullProxy = mediaFullProxyEnabled(serverCaps.data)
  const plugins = useMemo(
    () =>
      allPlugins.filter((p) => {
        if (!p || p.enabled === false) return false
        if (!mediaFullProxy && pluginNeedsFullMediaProxy(p)) return false
        return true
      }),
    [allPlugins, mediaFullProxy],
  )
  const upsertHistory = useHistoryStore((s) => s.upsert)
  const danmakuSettings = useSettingsStore((s) => s.danmaku ?? FALLBACK_DANMAKU)
  const setDanmaku = useSettingsStore((s) => s.setDanmaku)
  const playerSettings = useSettingsStore((s) => s.player ?? FALLBACK_PLAYER)
  const setPlayer = useSettingsStore((s) => s.setPlayer)

  const subject = useQuery({
    queryKey: ['subject', bangumiId],
    queryFn: ({ signal }) => bangumiApi.subject(bangumiId, { signal }),
    enabled: Number.isFinite(bangumiId) && bangumiId > 0,
    // Public metadata; server subject TTL 6h — keep client shorter to revalidate via HIT
    staleTime: 30 * 60_000,
    gcTime: 6 * 60 * 60_000,
  })
  const item = subject.data?.data
  const title = item ? item.nameCn || item.name : qTitle || `番剧 ${bangumiId}`
  const cover = item ? coverOf(item) : qCover || ''

  const [searchResults, setSearchResults] = useState<SearchRow[]>([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [roadLoading, setRoadLoading] = useState(false)
  const [roadError, setRoadError] = useState('')
  const [selection, setSelection] = useState<SourceSelection | null>(null)
  const [episode, setEpisode] = useState<EpisodePlay | null>(null)
  const [visibleRoad, setVisibleRoad] = useState(0)
  const [pendingSource, setPendingSource] = useState<{
    pluginName: string
    src: string
  } | null>(null)
  const [keywordTargetPlugin, setKeywordTargetPlugin] =
    useState<PluginMeta | null>(null)
  const [sessionKeywords, setSessionKeywords] = useState<
    Record<string, string[]>
  >({})
  const [playerRemount, setPlayerRemount] = useState(0)
  const [forceProxy, setForceProxy] = useState(false)
  /** Continue-play seek target — state (not ref) so first media mount sees it. */
  const [resumePosition, setResumePosition] = useState(0)

  const resumeDoneFor = useRef<string | null>(null)
  /** Live override after auth/proxy remount (position mid-play). */
  const resumeOverrideRef = useRef<number | null>(null)
  const pluginSearchGen = useRef<Record<string, number>>({})
  /** Abort in-flight search fetch when gen bumps / unmount */
  const pluginSearchAbort = useRef<Record<string, AbortController>>({})
  const chaptersGen = useRef(0)
  const chaptersAbort = useRef<AbortController | null>(null)
  /** Next resolve queryFn uses refresh=1 once (auth expiry / hard media fail). */
  const resolveRefreshOnce = useRef(false)
  /** pageUrl we already forced a fresh resolve for after media fail — avoid loops. */
  const resolveFailBudgetFor = useRef<string | null>(null)
  /** Auto-start default source once per subject (skip resume deep-links). */
  const defaultSearchDoneFor = useRef<number | null>(null)
  /** Avoid auto-picking first hit when user already has a selection / resume. */
  const selectionRef = useRef<SourceSelection | null>(null)
  selectionRef.current = selection
  const paramsRef = useRef(params)
  paramsRef.current = params

  const titleRefs = useMemo(() => {
    if (!item) return [qTitle].filter(Boolean) as string[]
    return [item.nameCn, item.name, ...(item.alias || [])].filter(Boolean)
  }, [item, qTitle])

  const keywordCandidates = useMemo(() => {
    if (!item) {
      const t = (qTitle || title || '').trim()
      return t ? [t] : ([] as string[])
    }
    // Full title first for the dropdown; shorter variants remain as fallbacks.
    const primary = (item.nameCn || item.name || '').trim()
    const variants = buildSearchKeywords(item.nameCn, item.name, item.alias)
    const seen = new Set<string>()
    const out: string[] = []
    for (const k of [primary, item.nameCn, item.name, ...variants]) {
      const t = (k || '').trim()
      if (!t || seen.has(t.toLowerCase())) continue
      seen.add(t.toLowerCase())
      out.push(t)
    }
    return out
  }, [item, qTitle, title])

  /** Default search uses the display title, not the shortest stripped variant. */
  const defaultKeyword = useMemo(() => {
    return (
      item?.nameCn ||
      item?.name ||
      qTitle ||
      title ||
      keywordCandidates[0] ||
      ''
    ).trim()
  }, [item, qTitle, title, keywordCandidates])

  const dm = useDanmakuSession({
    bangumiId,
    episode: episode?.episode || qEp || 1,
    title,
    titleRefs,
    matchKey: episode
      ? `${selection?.plugin.name || qPlugin}|${episode.pageUrl}|${episode.episode}`
      : null,
    autoMatch: Boolean(
      (selection || qPlugin) && (episode || qPageUrl) && bangumiId && title,
    ),
  })
  const dmResetPools = dm.resetPools

  useEffect(() => {
    ensureDefaults()
  }, [ensureDefaults])

  // Full reset when bangumi changes
  useEffect(() => {
    resumeDoneFor.current = null
    defaultSearchDoneFor.current = null
    setSelection(null)
    setEpisode(null)
    setResumePosition(0)
    resumeOverrideRef.current = null
    setVisibleRoad(0)
    setRoadError('')
    setPendingSource(null)
    setRoadLoading(false)
    setKeywordTargetPlugin(null)
    setSessionKeywords({})
    chaptersGen.current += 1
    dmResetPools()
    pluginSearchGen.current = {}
    setSearchKeyword('')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on subject id
  }, [bangumiId])

  // Seed / refresh idle plugin rows without wiping in-progress selection.
  // Preferred default source (MXdm) is sorted first for discoverability.
  useEffect(() => {
    setSearchResults((prev) => {
      const byName = new Map(prev.map((r) => [r.plugin.name, r]))
      const rows = plugins.map((plugin) => {
        const old = byName.get(plugin.name)
        if (old) return { ...old, plugin }
        return {
          plugin,
          items: [],
          pending: false,
          searched: false,
        }
      })
      return orderSearchRows(rows, pluginOrder)
    })
  }, [plugins, bangumiId, pluginOrder])

  // Keep default keyword in state for UI once subject loads
  useEffect(() => {
    if (defaultKeyword && !searchKeyword) {
      setSearchKeyword(defaultKeyword)
    }
  }, [defaultKeyword, searchKeyword])

  // Pre-select preferred source (MXdm) so the rail is not a blank wall.
  useEffect(() => {
    if (!plugins.length) return
    if (keywordTargetPlugin || selection) return
    const preferred = findDefaultSourcePlugin(plugins, pluginOrder)
    if (preferred) setKeywordTargetPlugin(preferred)
  }, [plugins, pluginOrder, keywordTargetPlugin, selection])

  const titleRefsStable = titleRefs
  const keywordCandidatesStable = keywordCandidates

  const rememberSessionKeyword = useCallback(
    (pluginName: string, keyword: string) => {
      const kw = keyword.trim()
      if (!kw) return
      setSessionKeywords((prev) => {
        const list = prev[pluginName] || []
        if (list.includes(kw)) return prev
        return { ...prev, [pluginName]: [kw, ...list].slice(0, 12) }
      })
    },
    [],
  )

  const pickSource = useCallback(
    async (plugin: PluginMeta, searchItem: SearchItem) => {
      if (
        !roadLoading &&
        selectionRef.current?.plugin.name === plugin.name &&
        selectionRef.current?.source.src === searchItem.src
      ) {
        setKeywordTargetPlugin(plugin)
        return
      }

      const gen = ++chaptersGen.current
      try {
        chaptersAbort.current?.abort()
      } catch {
        /* ignore */
      }
      const chaptersAc = new AbortController()
      chaptersAbort.current = chaptersAc
      setRoadLoading(true)
      setRoadError('')
      setEpisode(null)
      setResumePosition(0)
      resumeOverrideRef.current = null
      setVisibleRoad(0)
      setSelection(null)
      setPendingSource({ pluginName: plugin.name, src: searchItem.src })
      setKeywordTargetPlugin(plugin)
      dmResetPools()
      try {
        const res = await pluginApi.chapters(plugin, searchItem.src, {
          signal: chaptersAc.signal,
        })
        if (chaptersGen.current !== gen) return
        const roads = res.data.roads
        writeRoadsForSource(bangumiId, plugin.name, searchItem.src, roads)
        if (!roads.length || !roads[0]?.data?.length) {
          setRoadError(
            res.data.diagnostics?.slice(0, 2).join('；') || '未解析到分集',
          )
          setSelection(null)
          setPendingSource(null)
          return
        }
        setSelection({ plugin, source: searchItem, roads })
        setVisibleRoad(0)
        setPendingSource(null)

        const q = new URLSearchParams(paramsRef.current)
        q.set('plugin', plugin.name)
        q.set('title', title)
        if (cover) q.set('cover', cover)
        // Keep source detail URL for cold chapters resume
        q.set('source', searchItem.src)
        q.delete('pageUrl')
        q.delete('ep')
        q.delete('road')
        setParams(q, { replace: true })
      } catch (e) {
        if (chaptersGen.current !== gen) return
        if (chaptersAc.signal.aborted) return
        const msg = e instanceof Error ? e.message : '获取分集失败'
        if (/取消|aborted|AbortError/i.test(msg)) return
        setRoadError(msg)
        setSelection(null)
        setPendingSource(null)
      } finally {
        if (chaptersGen.current === gen) setRoadLoading(false)
      }
    },
    [bangumiId, cover, dmResetPools, roadLoading, setParams, title],
  )

  const searchOnePlugin = useCallback(
    async (
      plugin: PluginMeta,
      keyword: string,
      opts?: {
        clearSelection?: boolean
        autoPickFirst?: boolean
        /** Skip client search cache (and ask server refresh when true). */
        refresh?: boolean
      },
    ) => {
      const gen = (pluginSearchGen.current[plugin.name] || 0) + 1
      pluginSearchGen.current[plugin.name] = gen
      try {
        pluginSearchAbort.current[plugin.name]?.abort()
      } catch {
        /* ignore */
      }
      const searchAc = new AbortController()
      pluginSearchAbort.current[plugin.name] = searchAc
      rememberSessionKeyword(plugin.name, keyword)
      setSearchKeyword(keyword)
      setKeywordTargetPlugin(plugin)

      setSearchResults((prev) => {
        const exists = prev.some((r) => r.plugin.name === plugin.name)
        if (!exists) {
          return orderSearchRows([
            ...prev,
            {
              plugin,
              items: [],
              pending: true,
              searched: true,
              keyword,
            },
          ], pluginOrder)
        }
        return prev.map((row) =>
          row.plugin.name === plugin.name
            ? {
                ...row,
                plugin,
                items: [],
                error: undefined,
                pending: true,
                searched: true,
                keyword,
              }
            : row,
        )
      })

      if (opts?.clearSelection) {
        setSelection((sel) => {
          if (sel?.plugin.name === plugin.name) {
            setEpisode(null)
            return null
          }
          return sel
        })
      }

      let items: SearchItem[] = []
      let error: string | undefined
      try {
        const bypassClient = Boolean(opts?.refresh || opts?.clearSelection)
        const cached = bypassClient
          ? undefined
          : getCachedPluginSearch(plugin, keyword)
        const res = cached
          ? { data: cached }
          : await pluginApi.search(plugin, keyword, {
              signal: searchAc.signal,
              refresh: Boolean(opts?.refresh),
            })
        if (!cached) setCachedPluginSearch(plugin, keyword, res.data)
        if (pluginSearchGen.current[plugin.name] !== gen) return

        const seen = new Set<string>()
        const raw: SearchItem[] = []
        for (const it of res.data.items || []) {
          if (!it?.src || seen.has(it.src)) continue
          seen.add(it.src)
          raw.push(it)
        }
        items = rankSearchItems(raw, [
          ...titleRefsStable,
          keyword,
          ...keywordCandidatesStable,
        ])
        if (!items.length) {
          error =
            res.data.diagnostics?.filter(Boolean).slice(0, 1).join('；') ||
            '无结果 — 可换关键词'
        }
      } catch (e) {
        if (pluginSearchGen.current[plugin.name] !== gen) return
        if (searchAc.signal.aborted) return
        const msg = e instanceof Error ? e.message : '搜索失败'
        if (/取消|aborted|AbortError/i.test(msg)) return
        error = /504|timeout|超时|无法访问/i.test(msg)
          ? '源站超时，请稍后重试'
          : /502|源站返回/i.test(msg)
            ? '源站暂时不可用'
            : msg
      }

      if (pluginSearchGen.current[plugin.name] !== gen) return
      setSearchResults((prev) =>
        prev.map((row) =>
          row.plugin.name === plugin.name
            ? {
                plugin,
                items,
                error,
                pending: false,
                searched: true,
                keyword,
              }
            : row,
        ),
      )

      // Auto-select first ranked hit only when title is close enough.
      // Prevents MacCMS “first card” wrong-show on weak keyword matches.
      const isDefault =
        plugin.name.toLowerCase() === (findDefaultSourcePlugin(plugins, pluginOrder)?.name || '').toLowerCase()
      const shouldAutoPick =
        Boolean(items[0]) &&
        (opts?.autoPickFirst ||
          ((isDefault || opts?.clearSelection) &&
            (opts?.clearSelection || !selectionRef.current)))
      if (shouldAutoPick && items[0]) {
        const score = bestTitleSimilarity(items[0].name, [
          ...titleRefsStable,
          keyword,
          ...keywordCandidatesStable,
        ])
        if (score >= AUTO_PICK_MIN_SIMILARITY) {
          await pickSource(plugin, items[0])
        } else if (!error) {
          // Keep results visible; surface why we didn't auto-enter episodes
          setSearchResults((prev) =>
            prev.map((row) =>
              row.plugin.name === plugin.name
                ? {
                    ...row,
                    error: '未自动选择（标题不够相近，请点选一条）',
                  }
                : row,
            ),
          )
        }
      }
    },
    [
      titleRefsStable,
      keywordCandidatesStable,
      rememberSessionKeyword,
      pickSource,
      plugins,
      pluginOrder,
    ],
  )

  const openPluginSearch = useCallback(
    async (
      plugin: PluginMeta,
      keyword?: string,
      opts?: { clearSelection?: boolean; autoPickFirst?: boolean },
    ) => {
      const kw = (keyword || searchKeyword || defaultKeyword || '').trim()
      if (!kw) return
      await searchOnePlugin(plugin, kw, opts)
    },
    [searchOnePlugin, searchKeyword, defaultKeyword],
  )

  // First visit (not history resume): auto-search MXdm with the show title,
  // then auto-pick the first hit so episodes are ready immediately.
  useEffect(() => {
    if (!Number.isFinite(bangumiId) || bangumiId <= 0) return
    // Resume deep-link owns the session — do not fan out a second source.
    if (qPlugin && qPageUrl) return
    if (defaultSearchDoneFor.current === bangumiId) return
    if (!plugins.length) return

    // Prefer full subject title; avoid searching "番剧 123" before Bangumi loads.
    const kw = (
      item?.nameCn ||
      item?.name ||
      (qTitle && !/^番剧\s*\d+$/.test(qTitle) ? qTitle : '') ||
      defaultKeyword ||
      ''
    ).trim()
    if (!kw || /^番剧\s*\d+$/.test(kw)) return

    const preferred = findDefaultSourcePlugin(plugins, pluginOrder)
    if (!preferred) return

    defaultSearchDoneFor.current = bangumiId
    setKeywordTargetPlugin(preferred)
    setSearchKeyword(kw)
    void openPluginSearch(preferred, kw, { autoPickFirst: true })
  }, [
    bangumiId,
    qPlugin,
    qPageUrl,
    plugins,
    pluginOrder,
    item?.nameCn,
    item?.name,
    qTitle,
    defaultKeyword,
    openPluginSearch,
  ])

  // Resume from deep-link query (history / home)
  useEffect(() => {
    if (!Number.isFinite(bangumiId) || !qPlugin || !qPageUrl) return
    const key = `${bangumiId}|${qPlugin}|${qPageUrl}|${qEp}|${qRoad}`
    if (resumeDoneFor.current === key) return

    // Resolve plugin from store so array identity churn doesn't cancel mid-flight
    const plugin =
      usePluginStore.getState().getByName(qPlugin) ||
      plugins.find((p) => p.name === qPlugin)
    if (!plugin || plugin.enabled === false) return

    let cancelled = false
    // Do NOT mark done until success — cancel/plugins churn must retry

    ;(async () => {
      setKeywordTargetPlugin(plugin)
      setRoadLoading(true)
      setRoadError('')
      try {
        const sourceUrl =
          paramsRef.current.get('source') ||
          lookupHistorySourceUrl(bangumiId, qPlugin, qPageUrl) ||
          ''

        let roads =
          findRoadsForPlay({
            bangumiId,
            pluginName: qPlugin,
            pageUrl: qPageUrl,
            sourceUrl: sourceUrl || undefined,
          }) || []

        if (!roads.length) {
          // Chapters need the detail/source URL, not the episode play page.
          // Try sourceUrl first; only fall back to pageUrl for legacy rows.
          const chapterSrc = sourceUrl || qPageUrl
          const res = await pluginApi.chapters(plugin, chapterSrc)
          if (cancelled) return
          roads = res.data.roads || []
          if (roads.length) {
            writeRoadsForSource(
              bangumiId,
              qPlugin,
              sourceUrl || chapterSrc,
              roads,
            )
          }
          // If episode URL was wrongly used and failed, surface clearer error
          if (!roads.length && sourceUrl && sourceUrl !== qPageUrl) {
            // already failed with source — no second guess
          } else if (!roads.length && !sourceUrl) {
            // Legacy: episode URL often isn't a chapters source
          }
        }
        if (cancelled) return

        if (!roads.length) {
          setRoadError('续播：未解析到分集，请点击视频源重新选')
          setRoadLoading(false)
          // Allow retry (e.g. after user re-searches) by not locking the key forever
          return
        }

        const source: SearchItem = {
          name: qTitle || title || qPlugin,
          src: sourceUrl || qPageUrl,
        }
        let roadIdx = Math.max(0, qRoad)
        let epIdx = Math.max(0, (qEp || 1) - 1)
        for (let ri = 0; ri < roads.length; ri++) {
          const r = roads[ri]
          const found = r.data.findIndex(
            (u) =>
              u === qPageUrl ||
              u.replace(/\/$/, '') === qPageUrl.replace(/\/$/, ''),
          )
          if (found >= 0) {
            roadIdx = ri
            epIdx = found
            break
          }
        }

        const epNum = epIdx + 1
        // Sync resume before episode/selection commit so first player mount seeks
        const pos = lookupResumePosition(bangumiId, qPlugin, epNum, roadIdx)
        resumeOverrideRef.current = null
        setResumePosition(pos)

        setSelection({ plugin, source, roads })
        setVisibleRoad(roadIdx)
        setEpisode({
          pageUrl: roads[roadIdx]?.data[epIdx] || qPageUrl,
          episode: epNum,
          road: roadIdx,
        })
        const q = new URLSearchParams(paramsRef.current)
        q.set('plugin', qPlugin)
        q.set('pageUrl', roads[roadIdx]?.data[epIdx] || qPageUrl)
        q.set('ep', String(epNum))
        q.set('road', String(roadIdx))
        if (source.src) q.set('source', source.src)
        if (title) q.set('title', title)
        if (cover) q.set('cover', cover)
        setParams(q, { replace: true })
        // Only lock after a successful attach
        if (!cancelled) resumeDoneFor.current = key
      } catch (e) {
        if (!cancelled) {
          setRoadError(e instanceof Error ? e.message : '续播加载失败')
        }
      } finally {
        if (!cancelled) setRoadLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // plugins length/names only — avoid identity thrash from ensureDefaults
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bangumiId, qPlugin, qPageUrl, qEp, qRoad, plugins.length])

  const resolve = useQuery({
    queryKey: [
      'resolve',
      bangumiId,
      selection?.plugin.name,
      selection?.plugin.version,
      episode?.pageUrl,
    ],
    queryFn: ({ signal }) => {
      if (!selection || !episode) throw new Error('未选择分集')
      const refresh = resolveRefreshOnce.current
      resolveRefreshOnce.current = false
      return pluginApi.resolve(selection.plugin, episode.pageUrl, {
        signal,
        refresh,
      })
    },
    enabled: Boolean(selection?.plugin && episode?.pageUrl),
    retry: 1,
    // Server classifies resolve TTL; client keeps short freshness for UI
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  })

  // Keep resumePosition in sync when selection/episode changes without pickEpisode
  // (e.g. auto-pick → user later picks ep). pickEpisode also sets this synchronously.
  useEffect(() => {
    if (!selection || !episode) {
      setResumePosition(0)
      resumeOverrideRef.current = null
      return
    }
    if (resumeOverrideRef.current != null) return
    const pos = lookupResumePosition(
      bangumiId,
      selection.plugin.name,
      episode.episode,
      episode.road,
    )
    setResumePosition(pos)
  }, [selection, episode, bangumiId])

  useEffect(() => {
    setForceProxy(false)
    resolveFailBudgetFor.current = null
  }, [episode?.pageUrl, selection?.plugin.name])

  function pickEpisode(epIndex: number, roadIndex = visibleRoad) {
    if (!selection) return
    const road = selection.roads[roadIndex]
    const pageUrl = road?.data[epIndex]
    if (!pageUrl) return
    if (roadIndex !== visibleRoad) setVisibleRoad(roadIndex)
    const epNum = epIndex + 1
    // Synchronous history read so VideoPlayer first mount gets correct initialTime
    const pos = lookupResumePosition(
      bangumiId,
      selection.plugin.name,
      epNum,
      roadIndex,
    )
    resumeOverrideRef.current = null
    setResumePosition(pos)
    setEpisode({
      pageUrl,
      road: roadIndex,
      episode: epNum,
    })
    const q = new URLSearchParams(paramsRef.current)
    q.set('plugin', selection.plugin.name)
    q.set('pageUrl', pageUrl)
    q.set('ep', String(epNum))
    q.set('road', String(roadIndex))
    if (selection.source.src) q.set('source', selection.source.src)
    q.set('title', title)
    if (cover) q.set('cover', cover)
    setParams(q, { replace: true })
  }

  function goAdjacentEpisode(delta: number) {
    if (!selection || !episode) return
    const roadIndex = episode.road
    const road = selection.roads[roadIndex]
    if (!road?.data?.length) return
    const nextIdx = episode.episode - 1 + delta
    if (nextIdx < 0 || nextIdx >= road.data.length) return
    pickEpisode(nextIdx, roadIndex)
  }

  function onProgress(position: number, duration: number) {
    if (!selection || !episode) return
    upsertHistory({
      bangumiId,
      title,
      cover,
      episode: episode.episode,
      road: episode.road,
      pluginName: selection.plugin.name,
      pageUrl: episode.pageUrl,
      sourceUrl: selection.source.src || undefined,
      playUrl: resolve.data?.data.playUrl,
      position,
      duration,
    })
  }

  async function reResolveFresh() {
    resolveRefreshOnce.current = true
    await resolve.refetch()
    setPlayerRemount((n) => n + 1)
  }

  async function onMediaAuthExpired(position: number) {
    if (position > 5) {
      resumeOverrideRef.current = position
      setResumePosition(position)
    }
    await reResolveFresh()
  }

  const proxyUrl = episode ? resolve.data?.data.proxyUrl : undefined
  const playUrl = episode ? resolve.data?.data.playUrl : undefined
  const forceAdFilter = Boolean(playerSettings.forceAdBlocker)
  // Client forceMediaProxy cannot escalate past MEDIA_FULL_PROXY=0
  const preferMediaProxy =
    mediaFullProxy && Boolean(playerSettings.forceMediaProxy)
  const sessionForceProxy = mediaFullProxy && forceProxy
  const playback = useMemo(
    () =>
      pickPlaybackSrc({
        playUrl,
        proxyUrl,
        forceProxy: preferMediaProxy || sessionForceProxy,
        forceAdFilter,
      }),
    [playUrl, proxyUrl, preferMediaProxy, sessionForceProxy, forceAdFilter],
  )
  const mediaSrc = episode ? playback.src : ''
  const effectiveResume =
    resumeOverrideRef.current != null
      ? resumeOverrideRef.current
      : resumePosition
  const resumeTime =
    playerSettings.continuePlay && effectiveResume > RESUME_MIN_POSITION
      ? effectiveResume
      : 0

  function onMediaLoadFailed({ position }: { position: number }) {
    if (position > 5) {
      resumeOverrideRef.current = position
      setResumePosition(position)
    }
    if (playback.mode === 'direct' && proxyUrl) {
      // First failure on direct CDN → retry via media proxy (same playUrl)
      setForceProxy(true)
      setPlayerRemount((n) => n + 1)
      return
    }
    // Already proxying (or no direct) — playUrl may be stale; force re-resolve once
    const id = episode?.pageUrl || ''
    if (!id || resolveFailBudgetFor.current === id) return
    resolveFailBudgetFor.current = id
    void reResolveFresh()
  }

  async function reSearchCurrentSource(keyword: string) {
    const plugin = keywordTargetPlugin || selection?.plugin
    if (!plugin) return
    const kw = keyword.trim()
    if (!kw) return
    // Re-search replaces hits — auto-pick first so episodes stay usable.
    await searchOnePlugin(plugin, kw, {
      clearSelection: true,
      autoPickFirst: true,
      refresh: true,
    })
  }

  useEffect(() => {
    if (selection?.plugin) setKeywordTargetPlugin(selection.plugin)
  }, [selection?.plugin])

  return {
    bangumiId,
    title,
    cover,
    bangumiItem: item,
    subjectLoading: subject.isLoading,
    subjectError: subject.error,
    keywordCandidates,
    titleRefs,
    sessionKeywords,
    searchResults,
    searchKeyword,
    defaultKeyword,
    defaultSourceName: findDefaultSourcePlugin(plugins, pluginOrder)?.name || plugins[0]?.name || '',
    selection,
    episode,
    visibleRoad,
    setVisibleRoad,
    roadLoading,
    roadError,
    pendingSource,
    keywordTargetPlugin,
    setKeywordTargetPlugin,
    mediaSrc,
    playbackMode: playback.mode,
    /** direct | playlist-proxy (ad hybrid) | full-proxy — for WatchMeta hint */
    playbackTransit: playback.transit,
    // Include resume bucket so late history hydrate / auth remount re-seeks
    playerKey: `${mediaSrc}#${playerRemount}#${playback.mode}#r${Math.floor(resumeTime)}`,
    resumeTime,
    resolveLoading: Boolean(selection && episode && resolve.isLoading),
    resolveError: resolve.error,
    diagnostics: resolve.data?.data.diagnostics,
    danmakuSettings,
    playerSettings,
    setDanmaku,
    setPlayer,
    dm,
    enabledPlugins: plugins,
    openPluginSearch,
    searchOnePlugin,
    reSearchCurrentSource,
    pickSource,
    pickEpisode,
    goAdjacentEpisode,
    onProgress,
    onMediaAuthExpired,
    onMediaLoadFailed,
    refetchResolve: () => {
      resolveRefreshOnce.current = true
      void resolve.refetch()
    },
    pageUrl: episode?.pageUrl || qPageUrl,
    pluginName: selection?.plugin.name || qPlugin,
  }
}

export { bestTitleSimilarity }
