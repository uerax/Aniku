import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CollectType,
  CollectTypeLabel,
  coverOf,
  buildSearchKeywords,
  rankSearchItems,
  bestTitleSimilarity,
  extractBvid,
  parseDanmakuXml,
  type PluginMeta,
  type SearchItem,
  type Road,
  type DanmakuAnime,
  type DanmakuEpisode,
} from '@aniku/shared'
import { bangumiApi } from '../lib/bangumi'
import { pluginApi, danmakuApi } from '../lib/plugin-api'
import {
  emptyDanmakuPools,
  enabledCount,
  flattenEnabledPools,
  poolsStatusLine,
  sourceChips,
  totalLoadedCount,
  togglePool,
  writePool,
  type DanmakuPoolId,
  type DanmakuPools,
} from '../lib/danmaku-pools'
import { usePluginStore } from '../stores/plugins'
import { useSettingsStore } from '../stores/settings'
import { useHistoryStore } from '../stores/history'
import { ErrorState, LoadingState } from '../components/ui'
import { VideoPlayer } from '../player/VideoPlayer'
import { EMPTY_ARRAY, FALLBACK_DANMAKU, FALLBACK_PLAYER } from '../lib/stable'

type SearchRow = {
  plugin: PluginMeta
  items: SearchItem[]
  error?: string
  pending?: boolean
  /** keyword that produced this row (Kazumi: per-plugin re-query) */
  keyword?: string
}

/** Source selected for episode list (does not start playback by itself) */
type SourceSelection = {
  plugin: PluginMeta
  source: SearchItem
  roads: Road[]
}

/** Active episode currently playing / resolving */
type EpisodePlay = {
  pageUrl: string
  episode: number
  road: number
}

export function SubjectPage() {
  const { id } = useParams()
  const subjectId = Number(id)
  const token = useSettingsStore((s) => s.bangumiToken)
  const ensureDefaults = usePluginStore((s) => s.ensureDefaults)
  const allPlugins = usePluginStore((s) =>
    Array.isArray(s.plugins) ? s.plugins : EMPTY_ARRAY,
  )
  const plugins = useMemo(
    () => allPlugins.filter((p) => p && p.enabled !== false),
    [allPlugins],
  )
  const danmakuSettings = useSettingsStore((s) => s.danmaku ?? FALLBACK_DANMAKU)
  const setDanmaku = useSettingsStore((s) => s.setDanmaku)
  const playerSettings = useSettingsStore((s) => s.player ?? FALLBACK_PLAYER)
  const setPlayer = useSettingsStore((s) => s.setPlayer)
  const upsertHistory = useHistoryStore((s) => s.upsert)
  const historyItems = useHistoryStore((s) =>
    Array.isArray(s.items) ? s.items : EMPTY_ARRAY,
  )

  const qc = useQueryClient()

  const subject = useQuery({
    queryKey: ['subject', subjectId],
    queryFn: () => bangumiApi.subject(subjectId),
    enabled: Number.isFinite(subjectId),
  })

  const collection = useQuery({
    queryKey: ['collection', subjectId, token],
    queryFn: () => bangumiApi.getCollection(subjectId),
    enabled: Number.isFinite(subjectId) && Boolean(token),
  })

  const setCollect = useMutation({
    mutationFn: (type: CollectType) => bangumiApi.setCollection(subjectId, type),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collection', subjectId] })
      qc.invalidateQueries({ queryKey: ['collections'] })
    },
  })

  const item = subject.data?.data
  const title = item ? item.nameCn || item.name : ''
  const cover = item ? coverOf(item) : ''

  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchRow[]>([])
  /** Active keyword for fan-out / re-search (Kazumi: nameCn + alias + manual) */
  const [searchKeyword, setSearchKeyword] = useState('')
  const [roadLoading, setRoadLoading] = useState(false)
  const [roadError, setRoadError] = useState('')
  const [selection, setSelection] = useState<SourceSelection | null>(null)
  const [episode, setEpisode] = useState<EpisodePlay | null>(null)
  /** Kazumi-style: only one road's episodes visible at a time */
  const [visibleRoad, setVisibleRoad] = useState(0)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [danmakuPools, setDanmakuPools] = useState<DanmakuPools>(emptyDanmakuPools)
  const [danmakuStatus, setDanmakuStatus] = useState('')
  const [dmKeyword, setDmKeyword] = useState('')
  const [dmAnimes, setDmAnimes] = useState<DanmakuAnime[]>([])
  const [dmEpisodes, setDmEpisodes] = useState<DanmakuEpisode[]>([])
  const [dmAnimeId, setDmAnimeId] = useState<number | ''>('')
  const [dmEpisodeId, setDmEpisodeId] = useState<number | ''>('')
  const [dmSearchBusy, setDmSearchBusy] = useState(false)
  const [bvInput, setBvInput] = useState('')
  const [bvPage, setBvPage] = useState(1)
  const [bilibiliBusy, setBilibiliBusy] = useState(false)
  /** Per-plugin extra search: alias pick or free text (Kazumi SourceSheet) */
  const [retryPlugin, setRetryPlugin] = useState<string | null>(null)
  const [retryMode, setRetryMode] = useState<'alias' | 'manual' | null>(null)
  const [manualKeyword, setManualKeyword] = useState('')
  const searchedForId = useRef<number | null>(null)
  const resumeRef = useRef(0)
  /** cancel in-flight per-plugin re-query when a newer one starts */
  const pluginSearchGen = useRef<Record<string, number>>({})

  const visibleComments = useMemo(
    () => flattenEnabledPools(danmakuPools),
    [danmakuPools],
  )
  const loadedCount = useMemo(
    () => totalLoadedCount(danmakuPools),
    [danmakuPools],
  )
  const visibleCount = useMemo(
    () => enabledCount(danmakuPools),
    [danmakuPools],
  )
  const chips = useMemo(() => sourceChips(danmakuPools), [danmakuPools])

  function toggleSource(id: DanmakuPoolId) {
    setDanmakuPools((p) => togglePool(p, id))
  }

  const titleRefs = useMemo(() => {
    if (!item) return [] as string[]
    return [item.nameCn, item.name, ...(item.alias || [])].filter(Boolean)
  }, [item])

  const keywordCandidates = useMemo(() => {
    if (!item) return [] as string[]
    return buildSearchKeywords(item.nameCn, item.name, item.alias)
  }, [item])

  useEffect(() => {
    ensureDefaults()
  }, [ensureDefaults])

  useEffect(() => {
    searchedForId.current = null
    setSearchResults([])
    setSearchKeyword('')
    setSelection(null)
    setEpisode(null)
    setVisibleRoad(0)
    setRoadError('')
    setDanmakuPools(emptyDanmakuPools())
    setDanmakuStatus('')
    setRetryPlugin(null)
    setRetryMode(null)
    setManualKeyword('')
    pluginSearchGen.current = {}
  }, [subjectId])

  const titleRefsStable = titleRefs
  const keywordCandidatesStable = keywordCandidates

  /** Search one plugin (Kazumi querySource) — supports alias/manual re-query */
  const searchOnePlugin = useCallback(
    async (plugin: PluginMeta, keyword: string) => {
      const gen = (pluginSearchGen.current[plugin.name] || 0) + 1
      pluginSearchGen.current[plugin.name] = gen

      setSearchResults((prev) => {
        const exists = prev.some((r) => r.plugin.name === plugin.name)
        if (!exists) {
          return [
            ...prev,
            { plugin, items: [], pending: true, keyword },
          ]
        }
        return prev.map((row) =>
          row.plugin.name === plugin.name
            ? {
                ...row,
                plugin,
                items: [],
                error: undefined,
                pending: true,
                keyword,
              }
            : row,
        )
      })

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
        // rank closer to Bangumi titles first (still show all)
        items = rankSearchItems(raw, [
          ...titleRefsStable,
          keyword,
          ...keywordCandidatesStable,
        ])
        if (!items.length) {
          error =
            res.data.diagnostics?.filter(Boolean).slice(0, 1).join('；') ||
            '无结果 — 可试别名或手动检索'
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
            ? { plugin, items, error, pending: false, keyword }
            : row,
        ),
      )
    },
    [titleRefsStable, keywordCandidatesStable],
  )

  /** Fan-out all plugins (Kazumi queryAllSource) */
  const runSearch = useCallback(
    async (overrideKeyword?: string) => {
      if (!item) return
      ensureDefaults()
      const active = usePluginStore.getState().getEnabled()
      if (!active.length) {
        setSearchResults([])
        return
      }

      const keywords = buildSearchKeywords(
        item.nameCn,
        item.name,
        item.alias,
      )
      const keyword =
        (overrideKeyword || searchKeyword || keywords[0] || item.nameCn || item.name || '').trim()
      if (!keyword) return

      setSearchKeyword(keyword)
      setSearching(true)
      setRetryPlugin(null)
      setRetryMode(null)
      setSearchResults(
        active.map((plugin) => ({
          plugin,
          items: [] as SearchItem[],
          pending: true,
          keyword,
        })),
      )

      await Promise.all(
        active.map((plugin) => searchOnePlugin(plugin, keyword)),
      )
      setSearching(false)
    },
    [item, ensureDefaults, searchKeyword, searchOnePlugin],
  )

  useEffect(() => {
    if (!item || !Number.isFinite(subjectId)) return
    if (searchedForId.current === subjectId) return
    searchedForId.current = subjectId
    // default: shortest keyword candidate (like Kazumi nameCn, then short head)
    const kw =
      keywordCandidates[0] || item.nameCn || item.name
    if (kw) setSearchKeyword(kw)
    void runSearch(kw)
    // only auto once per subject
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, subjectId])

  const resolve = useQuery({
    queryKey: [
      'resolve',
      selection?.plugin.name,
      episode?.pageUrl,
    ],
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
    const h = historyItems.find(
      (i) =>
        i.bangumiId === subjectId &&
        i.pluginName === selection.plugin.name &&
        i.episode === episode.episode &&
        i.road === episode.road,
    )
    resumeRef.current = h?.position || 0
  }, [selection, episode, historyItems, subjectId])

  useEffect(() => {
    if (title) setDmKeyword(title)
  }, [title])

  const loadCommentsByEpisodeId = useCallback(async (epId: number) => {
    const comments = await danmakuApi.comments(epId)
    setDanmakuPools((p) =>
      writePool(p, 'dandan', comments.data, 'replace', `ep ${epId}`),
    )
    setDmEpisodeId(epId)
    setDanmakuStatus(`弹弹 · 已加载 ${comments.count} 条（其它源保留）`)
    return comments
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadDanmaku() {
      if (!selection || !episode || !subjectId) return
      setDanmakuStatus('匹配弹幕…')
      setDmAnimes([])
      setDmEpisodes([])
      setDmAnimeId('')
      setDmEpisodeId('')
      try {
        const [mappedResult, searchResult] = await Promise.allSettled([
          danmakuApi.bangumiByBgm(subjectId),
          danmakuApi.search(title),
        ])
        if (cancelled) return

        let episodeId = 0
        if (mappedResult.status === 'fulfilled') {
          const mapped = mappedResult.value
          if (mapped.data.episodes.length) {
            const ep =
              mapped.data.episodes[Math.max(0, episode.episode - 1)] ||
              mapped.data.episodes[0]
            episodeId = ep.episodeId
            setDmEpisodes(mapped.data.episodes)
            setDmAnimeId(mapped.data.bangumiId || '')
          }
        }
        if (searchResult.status === 'fulfilled') {
          setDmAnimes(searchResult.value.data)
        }
        if (!episodeId && searchResult.status === 'fulfilled') {
          let bestId = 0
          let bestScore = 0
          for (const a of searchResult.value.data) {
            if (a.animeId >= 100000 || a.animeId < 2) continue
            const score = bestTitleSimilarity(a.animeTitle, titleRefs)
            if (score > bestScore) {
              bestScore = score
              bestId = a.animeId
            }
          }
          if (bestId && bestScore >= 0.3) {
            const info = await danmakuApi.bangumi(bestId)
            if (cancelled) return
            setDmEpisodes(info.data.episodes)
            setDmAnimeId(bestId)
            const ep =
              info.data.episodes[Math.max(0, episode.episode - 1)] ||
              info.data.episodes[0]
            if (ep) episodeId = ep.episodeId
          }
        }
        if (!episodeId) {
          if (!cancelled) {
            setDanmakuStatus('未匹配到弹幕，点「幕」手动搜索或导入')
          }
          return
        }
        await loadCommentsByEpisodeId(episodeId)
      } catch (e) {
        if (!cancelled) {
          setDanmakuStatus(e instanceof Error ? e.message : '弹幕失败')
        }
      }
    }
    void loadDanmaku()
    return () => {
      cancelled = true
    }
  }, [
    episode?.pageUrl,
    episode?.episode,
    selection?.plugin.name,
    subjectId,
    title,
    titleRefs,
    loadCommentsByEpisodeId,
  ])

  async function handleDmSearch() {
    const kw = dmKeyword.trim()
    if (kw.length < 2) {
      setDanmakuStatus('番剧名称不少于 2 个字')
      return
    }
    setDmSearchBusy(true)
    setDanmakuStatus('正在搜索番剧…')
    try {
      const search = await danmakuApi.search(kw)
      setDmAnimes(search.data)
      setDmEpisodes([])
      setDmAnimeId('')
      setDmEpisodeId('')
      if (!search.data.length) {
        setDanmakuStatus('无搜索结果')
        return
      }
      setDanmakuStatus(`找到 ${search.data.length} 部番剧`)
      await handleDmAnimeChange(search.data[0].animeId, search.data)
    } catch (e) {
      setDanmakuStatus(e instanceof Error ? e.message : '搜索失败')
    } finally {
      setDmSearchBusy(false)
    }
  }

  async function handleDmAnimeChange(id: number, list?: DanmakuAnime[]) {
    setDmAnimeId(id)
    setDanmakuStatus('正在搜索剧集…')
    try {
      const info = await danmakuApi.bangumi(id)
      setDmEpisodes(info.data.episodes)
      const name =
        (list || dmAnimes).find((a) => a.animeId === id)?.animeTitle || ''
      setDanmakuStatus(
        name
          ? `${name} · ${info.data.episodes.length} 集`
          : `找到 ${info.data.episodes.length} 集`,
      )
      const epNo = episode?.episode || 1
      const ep =
        info.data.episodes[Math.max(0, epNo - 1)] || info.data.episodes[0]
      if (ep) await handleDmEpisodeChange(ep.episodeId)
    } catch (e) {
      setDanmakuStatus(e instanceof Error ? e.message : '剧集加载失败')
    }
  }

  async function handleDmEpisodeChange(epId: number) {
    setDanmakuStatus('加载弹幕中…')
    try {
      await loadCommentsByEpisodeId(epId)
    } catch (e) {
      setDanmakuStatus(e instanceof Error ? e.message : '弹幕加载失败')
    }
  }

  async function handleLoadBilibili() {
    const bvid = extractBvid(bvInput)
    if (!bvid) {
      setDanmakuStatus('请输入有效 BV 号或视频链接')
      return
    }
    setBilibiliBusy(true)
    setDanmakuStatus(`拉取 B 站弹幕 ${bvid}…`)
    try {
      const res = await danmakuApi.bilibili(bvid, bvPage)
      const part = res.meta.part ? ` · ${res.meta.part}` : ''
      const meta = `${res.meta.title || bvid}${part}`
      setDanmakuPools((p) =>
        writePool(p, 'bilibili', res.data, 'append', meta),
      )
      setDanmakuStatus(
        `已追加 B站 · ${meta} · +${res.count} 条（默认叠加显示）`,
      )
    } catch (e) {
      setDanmakuStatus(e instanceof Error ? e.message : 'B 站弹幕拉取失败')
    } finally {
      setBilibiliBusy(false)
    }
  }

  async function handleLoadXmlFile(file: File) {
    setDanmakuStatus(`解析 ${file.name}…`)
    try {
      const text = await file.text()
      const list = parseDanmakuXml(text)
      if (!list.length) {
        setDanmakuStatus('XML 中未找到弹幕（需 bilibili / pakku 格式）')
        return
      }
      setDanmakuPools((p) =>
        writePool(p, 'upload', list, 'append', file.name),
      )
      setDanmakuStatus(
        `已追加 用户上传 · ${file.name} · +${list.length} 条（默认叠加显示）`,
      )
    } catch (e) {
      setDanmakuStatus(e instanceof Error ? e.message : 'XML 解析失败')
    }
  }

  /** Click search hit → only load episode list, do NOT start playback */
  async function pickSource(plugin: PluginMeta, searchItem: SearchItem) {
    setRoadLoading(true)
    setRoadError('')
    setEpisode(null)
    setVisibleRoad(0)
    setDanmakuPools(emptyDanmakuPools())
    setDanmakuStatus('')
    try {
      const res = await pluginApi.chapters(plugin, searchItem.src)
      const roads = res.data.roads
      try {
        sessionStorage.setItem(
          `roads:${subjectId}:${plugin.name}`,
          JSON.stringify(roads),
        )
      } catch {
        /* ignore */
      }
      if (!roads.length || !roads[0]?.data?.length) {
        setRoadError(
          res.data.diagnostics?.slice(0, 2).join('；') || '未解析到分集',
        )
        setSelection(null)
        return
      }
      setSelection({ plugin, source: searchItem, roads })
      setVisibleRoad(0)
    } catch (e) {
      setRoadError(e instanceof Error ? e.message : '获取分集失败')
      setSelection(null)
    } finally {
      setRoadLoading(false)
    }
  }

  /** Click episode on the currently visible road → resolve + play */
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
      bangumiId: subjectId,
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

  const collectType = collection.data?.data?.type ?? CollectType.none
  const collectOptions = useMemo(
    () =>
      [
        CollectType.watching,
        CollectType.planToWatch,
        CollectType.watched,
        CollectType.onHold,
        CollectType.abandoned,
      ] as CollectType[],
    [],
  )

  const proxyUrl = episode ? resolve.data?.data.proxyUrl : undefined

  if (subject.isLoading) return <LoadingState />
  if (subject.isError || !item) {
    return <ErrorState error={subject.error || new Error('未找到条目')} />
  }

  return (
    <div className="space-y-4">
      {/* compact meta */}
      <div className="flex gap-4">
        <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 sm:h-32 sm:w-24">
          {coverOf(item, 'large') ? (
            <img
              src={coverOf(item, 'large')}
              alt=""
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-xl font-semibold leading-snug sm:text-2xl">
            {title}
          </h1>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
            {item.ratingScore > 0 && (
              <span className="text-amber-300/90">
                {item.ratingScore.toFixed(1)}
              </span>
            )}
            {item.airDate && <span>{item.airDate}</span>}
            {item.tags?.slice(0, 6).map((t) => (
              <span key={t.name}>{t.name}</span>
            ))}
          </div>
          {item.summary && (
            <div className="text-sm text-zinc-400">
              <p className={summaryOpen ? '' : 'line-clamp-2'}>{item.summary}</p>
              {item.summary.length > 80 && (
                <button
                  type="button"
                  className="mt-0.5 text-xs text-sky-500 hover:underline"
                  onClick={() => setSummaryOpen((v) => !v)}
                >
                  {summaryOpen ? '收起' : '展开简介'}
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {token ? (
              <select
                value={collectType}
                onChange={(e) =>
                  setCollect.mutate(Number(e.target.value) as CollectType)
                }
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                disabled={setCollect.isPending}
              >
                <option value={CollectType.none}>未收藏</option>
                {collectOptions.map((t) => (
                  <option key={t} value={t}>
                    {CollectTypeLabel[t]}
                  </option>
                ))}
              </select>
            ) : (
              <Link
                to="/settings"
                className="text-xs text-zinc-500 hover:text-sky-400"
              >
                登录 Bangumi 同步追番
              </Link>
            )}
            {selection && episode && (
              <span className="text-xs text-zinc-500">
                {selection.plugin.name} · 第 {episode.episode} 集
                {danmakuStatus ? ` · ${danmakuStatus}` : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Player: same structure as PlayPage — avoid overflow-hidden + rounded
          wrapping a hardware-decoded <video> (Chrome: audio ok, black frame). */}
      <div className="space-y-0">
        {episode && resolve.isLoading && !proxyUrl && (
          <div className="kz-player-placeholder text-sm text-zinc-300">
            解析播放地址…
          </div>
        )}
        {episode && resolve.isError && !proxyUrl && (
          <div className="kz-player-placeholder flex-col gap-2 p-4 text-center">
            <div className="text-sm text-red-300">
              {(resolve.error as Error)?.message || '解析失败'}
            </div>
            <button
              type="button"
              onClick={() => resolve.refetch()}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700"
            >
              重试
            </button>
          </div>
        )}
        {proxyUrl ? (
          <VideoPlayer
            key={proxyUrl}
            src={proxyUrl}
            initialTime={
              playerSettings.continuePlay && resumeRef.current > 15
                ? resumeRef.current
                : 0
            }
            comments={visibleComments}
            danmaku={danmakuSettings}
            player={playerSettings}
            onPlayerChange={setPlayer}
            onProgress={onProgress}
            onToggleDanmaku={() =>
              setDanmaku({ enabled: !danmakuSettings.enabled })
            }
            onDanmakuChange={setDanmaku}
            onPrev={() => goAdjacentEpisode(-1)}
            onNext={() => goAdjacentEpisode(1)}
            danmakuPanel={{
              status: danmakuStatus || poolsStatusLine(danmakuPools),
              commentsCount: loadedCount,
              visibleCount,
              keyword: dmKeyword,
              onKeywordChange: setDmKeyword,
              onSearch: () => void handleDmSearch(),
              searchBusy: dmSearchBusy,
              animes: dmAnimes,
              episodes: dmEpisodes,
              animeId: dmAnimeId,
              episodeId: dmEpisodeId,
              onAnimeChange: (id) => void handleDmAnimeChange(id),
              onEpisodeChange: (id) => void handleDmEpisodeChange(id),
              bvInput,
              onBvInputChange: setBvInput,
              bvPage,
              onBvPageChange: setBvPage,
              onLoadBilibili: () => void handleLoadBilibili(),
              bilibiliBusy,
              onLoadXmlFile: (f) => void handleLoadXmlFile(f),
              sources: chips,
              onToggleSource: toggleSource,
            }}
          />
        ) : !episode || (!resolve.isLoading && !resolve.isError) ? (
          <div className="kz-player-placeholder flex-col gap-1 text-sm text-zinc-500">
            <span>选择播放源与分集后开始播放</span>
            {selection && !episode && (
              <span className="text-xs text-zinc-600">请在下方点击某一集</span>
            )}
          </div>
        ) : null}
        <div className="mt-0 flex flex-wrap items-center gap-2 rounded-b-2xl border border-t-0 border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
          <button
            type="button"
            onClick={() => setDanmaku({ enabled: !danmakuSettings.enabled })}
            className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700"
          >
            {danmakuSettings.enabled ? '关弹幕' : '开弹幕'}
          </button>
          <span className="text-zinc-400">
            {danmakuStatus ? `弹幕: ${danmakuStatus}` : '弹幕'}
            {' · '}
            空格播放 · F 全屏 · D 弹幕 · Alt+M 面板 · P/N 上下集
          </span>
          {resolve.data?.data.diagnostics?.length ? (
            <details className="text-zinc-600">
              <summary className="cursor-pointer">诊断</summary>
              <ul className="mt-1 list-disc pl-4">
                {resolve.data.data.diagnostics.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>

      {/* sources + episodes */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-zinc-300">播放源</h2>
            {searchKeyword ? (
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                关键词「{searchKeyword}」
                {item?.alias?.length
                  ? ` · ${item.alias.length} 个别名`
                  : ''}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {keywordCandidates.length > 1 && (
              <select
                value={
                  keywordCandidates.includes(searchKeyword)
                    ? searchKeyword
                    : ''
                }
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) return
                  void runSearch(v)
                }}
                disabled={searching}
                className="max-w-[10rem] rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 disabled:opacity-50"
                title="换短标题 / 别名再搜全部源"
                aria-label="切换搜索关键词"
              >
                <option value="" disabled>
                  换关键词…
                </option>
                {keywordCandidates.slice(0, 12).map((kw) => (
                  <option key={kw} value={kw}>
                    {kw}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => void runSearch(searchKeyword || undefined)}
              disabled={searching}
              className="text-xs text-sky-400 hover:underline disabled:opacity-50"
            >
              {searching ? '搜索中…' : '重新搜索'}
            </button>
          </div>
        </div>

        {!plugins.length && (
          <div className="space-y-2 text-sm text-zinc-400">
            <p>没有启用的规则。</p>
            <button
              type="button"
              className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs text-white"
              onClick={() => {
                usePluginStore.getState().resetToDefaults()
                void runSearch()
              }}
            >
              恢复默认规则
            </button>
          </div>
        )}

        {plugins.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="space-y-2">
              {searchResults.length === 0 && searching && (
                <div className="text-xs text-zinc-500">正在搜索各源…</div>
              )}
              {searchResults.map((r) => {
                const isRetry =
                  retryPlugin === r.plugin.name && retryMode != null
                return (
                <div
                  key={r.plugin.id}
                  className="rounded-xl border border-zinc-800/80 p-2.5"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-zinc-200">
                      {r.plugin.name}
                    </span>
                    <span className="shrink-0 text-zinc-500">
                      {r.pending
                        ? '…'
                        : r.items.length
                          ? `${r.items.length}`
                          : '0'}
                    </span>
                  </div>
                  {r.pending && (
                    <div className="text-xs text-zinc-600">搜索中…</div>
                  )}
                  {!r.pending && r.error && (
                    <div className="line-clamp-2 text-xs text-amber-400/80">
                      {r.error}
                    </div>
                  )}
                  {/* Kazumi: 无结果 / 不准确 → 别名检索 + 手动检索 */}
                  {!r.pending && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                      {!r.items.length ? (
                        <span className="text-zinc-500">
                          无结果，换词重试
                        </span>
                      ) : (
                        <span className="text-zinc-600">结果不准确？</span>
                      )}
                      <button
                        type="button"
                        className="text-sky-400 hover:underline disabled:opacity-40"
                        disabled={!item?.alias?.length}
                        title={
                          item?.alias?.length
                            ? '用 Bangumi 别名重搜此源'
                            : '该条目无 Bangumi 别名'
                        }
                        onClick={() => {
                          if (!item?.alias?.length) return
                          setRetryPlugin(r.plugin.name)
                          setRetryMode('alias')
                          setManualKeyword('')
                        }}
                      >
                        别名检索
                      </button>
                      <button
                        type="button"
                        className="text-sky-400 hover:underline"
                        onClick={() => {
                          setRetryPlugin(r.plugin.name)
                          setRetryMode('manual')
                          setManualKeyword(r.keyword || searchKeyword || title)
                        }}
                      >
                        手动检索
                      </button>
                      {r.keyword && r.keyword !== searchKeyword && (
                        <span className="text-zinc-600">
                          用了「{r.keyword}」
                        </span>
                      )}
                    </div>
                  )}
                  {isRetry && retryMode === 'alias' && (
                    <div className="mt-2 space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
                      <div className="text-[11px] text-zinc-400">
                        选择别名后仅重搜「{r.plugin.name}」
                      </div>
                      <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                        {(item?.alias || []).map((alias) => (
                          <button
                            key={alias}
                            type="button"
                            className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-sky-900/60"
                            onClick={() => {
                              setRetryPlugin(null)
                              setRetryMode(null)
                              void searchOnePlugin(r.plugin, alias)
                            }}
                          >
                            {alias}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="text-[11px] text-zinc-500 hover:text-zinc-300"
                        onClick={() => {
                          setRetryPlugin(null)
                          setRetryMode(null)
                        }}
                      >
                        取消
                      </button>
                    </div>
                  )}
                  {isRetry && retryMode === 'manual' && (
                    <form
                      className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const kw = manualKeyword.trim()
                        if (!kw) return
                        setRetryPlugin(null)
                        setRetryMode(null)
                        void searchOnePlugin(r.plugin, kw)
                      }}
                    >
                      <input
                        type="text"
                        value={manualKeyword}
                        onChange={(e) => setManualKeyword(e.target.value)}
                        placeholder="输入站点上的标题关键词"
                        className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="rounded-md bg-sky-700 px-2 py-1 text-[11px] text-white hover:bg-sky-600"
                      >
                        搜索
                      </button>
                      <button
                        type="button"
                        className="text-[11px] text-zinc-500 hover:text-zinc-300"
                        onClick={() => {
                          setRetryPlugin(null)
                          setRetryMode(null)
                        }}
                      >
                        取消
                      </button>
                    </form>
                  )}
                  <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                    {r.items.map((it, idx) => {
                      const active =
                        selection?.plugin.name === r.plugin.name &&
                        selection?.source.src === it.src
                      const score = bestTitleSimilarity(it.name, titleRefs)
                      return (
                        <li key={`${r.plugin.name}:${it.src}:${idx}`}>
                          <button
                            type="button"
                            onClick={() => void pickSource(r.plugin, it)}
                            className={`flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm ${
                              active
                                ? 'bg-sky-950 text-sky-200'
                                : 'text-zinc-300 hover:bg-zinc-800'
                            }`}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {it.name}
                            </span>
                            {score >= 0.85 && (
                              <span className="shrink-0 text-[10px] text-emerald-500/90">
                                相近
                              </span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
                )
              })}
            </div>

            <div className="space-y-2">
              {/* Kazumi video_page: road picker + only current road episodes */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-zinc-400">
                <span>选集</span>
                {selection && (
                  <div className="flex items-center gap-2 font-normal">
                    {selection.roads.length > 1 ? (
                      <select
                        value={Math.min(
                          visibleRoad,
                          selection.roads.length - 1,
                        )}
                        onChange={(e) => {
                          setVisibleRoad(Number(e.target.value))
                        }}
                        className="max-w-[14rem] rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
                        aria-label="播放线路 / 清晰度"
                        title="切换线路（源站清晰度 / CDN）"
                      >
                        {selection.roads.map((road, i) => (
                          <option key={road.name + i} value={i}>
                            {road.name}
                            {road.data.length
                              ? ` · ${road.data.length}集`
                              : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-zinc-500">
                        {selection.roads[0]?.name &&
                        !/^播放线路\d+$/.test(selection.roads[0].name)
                          ? `${selection.roads[0].name} · `
                          : ''}
                        {selection.roads[0]?.data.length ?? 0} 集
                      </span>
                    )}
                  </div>
                )}
              </div>
              {roadLoading && (
                <div className="text-xs text-zinc-500">加载分集…</div>
              )}
              {roadError && (
                <div className="text-xs text-red-400">{roadError}</div>
              )}
              {!selection && !roadLoading && (
                <div className="text-xs text-zinc-500">
                  先点左侧播放源条目，再点某一集开始播放
                </div>
              )}
              {selection && (() => {
                const roadIndex = Math.min(
                  visibleRoad,
                  Math.max(0, selection.roads.length - 1),
                )
                const road = selection.roads[roadIndex]
                if (!road) return null
                return (
                  <div className="flex flex-wrap gap-1">
                    {road.identifier.map((name, epIndex) => {
                      const active =
                        episode?.road === roadIndex &&
                        episode?.episode === epIndex + 1
                      return (
                        <button
                          key={road.data[epIndex] + name + epIndex}
                          type="button"
                          onClick={() => pickEpisode(epIndex)}
                          className={
                            active
                              ? 'rounded-md bg-sky-600 px-2 py-1 text-xs'
                              : 'rounded-md bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700'
                          }
                        >
                          {name}
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
