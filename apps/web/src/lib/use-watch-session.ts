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
} from '@aniku/shared'
import { bangumiApi } from './bangumi'
import { pluginApi } from './plugin-api'
import { pickPlaybackSrc } from './playback-src'
import {
  findRoadsForPlay,
  writeRoadsForSource,
} from './roads-cache'
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

/** Preferred first-touch source so new users aren't staring at an empty rail. */
export const DEFAULT_SOURCE_PLUGIN = 'MXdm'

function findDefaultSourcePlugin(list: PluginMeta[]): PluginMeta | undefined {
  const want = DEFAULT_SOURCE_PLUGIN.toLowerCase()
  return (
    list.find((p) => p.name.toLowerCase() === want) ||
    list.find((p) => p.name.toLowerCase().includes(want))
  )
}

/** Put preferred source first so the default is obvious in the rail. */
function orderSearchRows(rows: SearchRow[]): SearchRow[] {
  const want = DEFAULT_SOURCE_PLUGIN.toLowerCase()
  return [...rows].sort((a, b) => {
    const aHit =
      a.plugin.name.toLowerCase() === want ||
      a.plugin.name.toLowerCase().includes(want)
        ? 0
        : 1
    const bHit =
      b.plugin.name.toLowerCase() === want ||
      b.plugin.name.toLowerCase().includes(want)
        ? 0
        : 1
    return aHit - bHit
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
  const plugins = useMemo(
    () => allPlugins.filter((p) => p && p.enabled !== false),
    [allPlugins],
  )
  const upsertHistory = useHistoryStore((s) => s.upsert)
  const danmakuSettings = useSettingsStore((s) => s.danmaku ?? FALLBACK_DANMAKU)
  const setDanmaku = useSettingsStore((s) => s.setDanmaku)
  const playerSettings = useSettingsStore((s) => s.player ?? FALLBACK_PLAYER)
  const setPlayer = useSettingsStore((s) => s.setPlayer)

  const subject = useQuery({
    queryKey: ['subject', bangumiId],
    queryFn: () => bangumiApi.subject(bangumiId),
    enabled: Number.isFinite(bangumiId) && bangumiId > 0,
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

  const resumeDoneFor = useRef<string | null>(null)
  const resumeRef = useRef(0)
  const pluginSearchGen = useRef<Record<string, number>>({})
  const chaptersGen = useRef(0)
  /** Auto-start default source once per subject (skip resume deep-links). */
  const defaultSearchDoneFor = useRef<number | null>(null)
  /** Avoid auto-picking first hit when user already has a selection / resume. */
  const selectionRef = useRef<SourceSelection | null>(null)
  selectionRef.current = selection

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

  useEffect(() => {
    ensureDefaults()
  }, [ensureDefaults])

  // Full reset when bangumi changes
  useEffect(() => {
    resumeDoneFor.current = null
    defaultSearchDoneFor.current = null
    setSelection(null)
    setEpisode(null)
    setVisibleRoad(0)
    setRoadError('')
    setPendingSource(null)
    setRoadLoading(false)
    setKeywordTargetPlugin(null)
    setSessionKeywords({})
    chaptersGen.current += 1
    dm.resetPools()
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
      return orderSearchRows(rows)
    })
  }, [plugins, bangumiId])

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
    const preferred = findDefaultSourcePlugin(plugins)
    if (preferred) setKeywordTargetPlugin(preferred)
  }, [plugins, keywordTargetPlugin, selection])

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
      setRoadLoading(true)
      setRoadError('')
      setEpisode(null)
      setVisibleRoad(0)
      setSelection(null)
      setPendingSource({ pluginName: plugin.name, src: searchItem.src })
      setKeywordTargetPlugin(plugin)
      dm.resetPools()
      try {
        const res = await pluginApi.chapters(plugin, searchItem.src)
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

        const q = new URLSearchParams(params)
        q.set('plugin', plugin.name)
        q.set('title', title)
        if (cover) q.set('cover', cover)
        q.delete('pageUrl')
        q.delete('ep')
        q.delete('road')
        setParams(q, { replace: true })
      } catch (e) {
        if (chaptersGen.current !== gen) return
        setRoadError(e instanceof Error ? e.message : '获取分集失败')
        setSelection(null)
        setPendingSource(null)
      } finally {
        if (chaptersGen.current === gen) setRoadLoading(false)
      }
    },
    [bangumiId, cover, dm, params, roadLoading, setParams, title],
  )

  const searchOnePlugin = useCallback(
    async (
      plugin: PluginMeta,
      keyword: string,
      opts?: { clearSelection?: boolean; autoPickFirst?: boolean },
    ) => {
      const gen = (pluginSearchGen.current[plugin.name] || 0) + 1
      pluginSearchGen.current[plugin.name] = gen
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
          ])
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
        const res = await pluginApi.search(plugin, keyword)
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
        const msg = e instanceof Error ? e.message : '搜索失败'
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

      // Default source: auto-select first ranked hit so the episode panel is ready.
      // Also honors explicit autoPickFirst (bootstrap / re-search after clear).
      const isDefault =
        plugin.name.toLowerCase() === DEFAULT_SOURCE_PLUGIN.toLowerCase() ||
        plugin.name.toLowerCase().includes(DEFAULT_SOURCE_PLUGIN.toLowerCase())
      const shouldAutoPick =
        Boolean(items[0]) &&
        (opts?.autoPickFirst ||
          ((isDefault || opts?.clearSelection) &&
            (opts?.clearSelection || !selectionRef.current)))
      if (shouldAutoPick && items[0]) {
        await pickSource(plugin, items[0])
      }
    },
    [
      titleRefsStable,
      keywordCandidatesStable,
      rememberSessionKeyword,
      pickSource,
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

    const preferred = findDefaultSourcePlugin(plugins)
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

    const plugin = plugins.find((p) => p.name === qPlugin)
    if (!plugin) return

    let cancelled = false
    resumeDoneFor.current = key

    ;(async () => {
      setKeywordTargetPlugin(plugin)
      setRoadLoading(true)
      setRoadError('')
      try {
        let roads =
          findRoadsForPlay({
            bangumiId,
            pluginName: qPlugin,
            pageUrl: qPageUrl,
          }) || []

        if (!roads.length) {
          const res = await pluginApi.chapters(plugin, qPageUrl)
          if (cancelled) return
          roads = res.data.roads || []
          if (roads.length) {
            writeRoadsForSource(bangumiId, qPlugin, qPageUrl, roads)
          }
        }
        if (cancelled) return

        if (!roads.length) {
          setRoadError('续播：未解析到分集，请点击视频源重新选')
          setRoadLoading(false)
          return
        }

        const source: SearchItem = {
          name: qTitle || title || qPlugin,
          src: qPageUrl,
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

        setSelection({ plugin, source, roads })
        setVisibleRoad(roadIdx)
        setEpisode({
          pageUrl: roads[roadIdx]?.data[epIdx] || qPageUrl,
          episode: epIdx + 1,
          road: roadIdx,
        })
        const q = new URLSearchParams(params)
        q.set('plugin', qPlugin)
        q.set('pageUrl', roads[roadIdx]?.data[epIdx] || qPageUrl)
        q.set('ep', String(epIdx + 1))
        q.set('road', String(roadIdx))
        if (title) q.set('title', title)
        if (cover) q.set('cover', cover)
        setParams(q, { replace: true })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bangumiId, qPlugin, qPageUrl, plugins])

  const resolve = useQuery({
    queryKey: ['resolve', selection?.plugin.name, episode?.pageUrl],
    queryFn: () => {
      if (!selection || !episode) throw new Error('未选择分集')
      return pluginApi.resolve(selection.plugin, episode.pageUrl)
    },
    enabled: Boolean(selection?.plugin && episode?.pageUrl),
    retry: 1,
  })

  useEffect(() => {
    if (!selection || !episode) {
      resumeRef.current = 0
      return
    }
    const items = useHistoryStore.getState().items
    const list = Array.isArray(items) ? items : []
    const h = list.find(
      (i) =>
        i.bangumiId === bangumiId &&
        i.pluginName === selection.plugin.name &&
        i.episode === episode.episode &&
        i.road === episode.road,
    )
    resumeRef.current = h?.position || 0
  }, [selection, episode, bangumiId])

  useEffect(() => {
    setForceProxy(false)
  }, [episode?.pageUrl, selection?.plugin.name])

  function pickEpisode(epIndex: number, roadIndex = visibleRoad) {
    if (!selection) return
    const road = selection.roads[roadIndex]
    const pageUrl = road?.data[epIndex]
    if (!pageUrl) return
    if (roadIndex !== visibleRoad) setVisibleRoad(roadIndex)
    setEpisode({
      pageUrl,
      road: roadIndex,
      episode: epIndex + 1,
    })
    const q = new URLSearchParams(params)
    q.set('plugin', selection.plugin.name)
    q.set('pageUrl', pageUrl)
    q.set('ep', String(epIndex + 1))
    q.set('road', String(roadIndex))
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
      playUrl: resolve.data?.data.playUrl,
      position,
      duration,
    })
  }

  async function onMediaAuthExpired(position: number) {
    if (position > 5) resumeRef.current = position
    await resolve.refetch()
    setPlayerRemount((n) => n + 1)
  }

  const proxyUrl = episode ? resolve.data?.data.proxyUrl : undefined
  const playUrl = episode ? resolve.data?.data.playUrl : undefined
  const forceAdFilter = Boolean(playerSettings.forceAdBlocker)
  const preferMediaProxy = Boolean(playerSettings.forceMediaProxy)
  const playback = useMemo(
    () =>
      pickPlaybackSrc({
        playUrl,
        proxyUrl,
        forceProxy: preferMediaProxy || forceProxy,
        forceAdFilter,
      }),
    [playUrl, proxyUrl, preferMediaProxy, forceProxy, forceAdFilter],
  )
  const mediaSrc = episode ? playback.src : ''
  const resumeTime =
    playerSettings.continuePlay && resumeRef.current > 15
      ? resumeRef.current
      : 0

  function onMediaLoadFailed({ position }: { position: number }) {
    if (position > 5) resumeRef.current = position
    if (playback.mode === 'direct' && proxyUrl) {
      setForceProxy(true)
      setPlayerRemount((n) => n + 1)
    }
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
    defaultSourceName: DEFAULT_SOURCE_PLUGIN,
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
    playerKey: `${mediaSrc}#${playerRemount}#${playback.mode}`,
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
    refetchResolve: () => void resolve.refetch(),
    pageUrl: episode?.pageUrl || qPageUrl,
    pluginName: selection?.plugin.name || qPlugin,
  }
}

export { bestTitleSimilarity }
