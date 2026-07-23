import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import {
  bestTitleSimilarity,
  extractBvid,
  parseDanmakuXml,
  titleSimilarity,
  type DanmakuAnime,
  type DanmakuComment,
  type DanmakuEpisode,
} from '@aniku/shared'
import { danmakuApi } from './plugin-api'
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
  type DanmakuSourceChip,
} from './danmaku-pools'
import type { DanmakuPanelState } from '../player/VideoPlayer'

export type UseDanmakuSessionOpts = {
  /** Bangumi subject id — used for auto-match */
  bangumiId: number
  /** Episode number (1-based) for dandan episode pick */
  episode: number
  /** Primary title for search / status */
  title: string
  /**
   * Extra title refs for ranking (nameCn / name / aliases).
   * When set, uses bestTitleSimilarity; otherwise titleSimilarity(title).
   */
  titleRefs?: Array<string | null | undefined>
  /**
   * Auto-match dependency extras (e.g. pageUrl / plugin name) so switching
   * source re-runs match without changing bangumiId/episode/title.
   */
  matchKey?: string | number | null
  /** Initial search box text (default: title) */
  initialKeyword?: string
  /** When false, skip auto-match effect (still allows manual panel ops) */
  autoMatch?: boolean
}

export type DanmakuSession = {
  pools: DanmakuPools
  setPools: Dispatch<SetStateAction<DanmakuPools>>
  status: string
  setStatus: (s: string) => void
  visibleComments: DanmakuComment[]
  loadedCount: number
  visibleCount: number
  chips: DanmakuSourceChip[]
  toggleSource: (id: DanmakuPoolId) => void
  resetPools: () => void
  /** Props bag for VideoPlayer `danmakuPanel` */
  panel: DanmakuPanelState
  /** status line for side UI */
  statusLine: string
}

/**
 * Shared danmaku panel + auto-match used by PlayPage and SubjectPage.
 * Keeps pools / search / BV / XML / generation cancel in one place.
 */
export function useDanmakuSession(opts: UseDanmakuSessionOpts): DanmakuSession {
  const {
    bangumiId,
    episode,
    title,
    titleRefs,
    matchKey,
    initialKeyword,
    autoMatch = true,
  } = opts

  const [pools, setPools] = useState<DanmakuPools>(emptyDanmakuPools)
  const [status, setStatus] = useState('')
  const [keyword, setKeyword] = useState(initialKeyword ?? title)
  const [animes, setAnimes] = useState<DanmakuAnime[]>([])
  const [episodes, setEpisodes] = useState<DanmakuEpisode[]>([])
  const [animeId, setAnimeId] = useState<number | ''>('')
  const [episodeId, setEpisodeId] = useState<number | ''>('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [bvInput, setBvInput] = useState('')
  const [bvPage, setBvPage] = useState(1)
  const [bilibiliBusy, setBilibiliBusy] = useState(false)
  const autoMatchGen = useRef(0)

  // Keep keyword in sync when title changes (new subject / deep link)
  useEffect(() => {
    setKeyword(initialKeyword ?? title)
  }, [title, initialKeyword])

  const visibleComments = useMemo(() => flattenEnabledPools(pools), [pools])
  const loadedCount = useMemo(() => totalLoadedCount(pools), [pools])
  const visibleCount = useMemo(() => enabledCount(pools), [pools])
  const chips = useMemo(() => sourceChips(pools), [pools])

  const toggleSource = useCallback((id: DanmakuPoolId) => {
    setPools((p) => togglePool(p, id))
  }, [])

  const resetPools = useCallback(() => {
    setPools(emptyDanmakuPools())
    setStatus('')
    setAnimes([])
    setEpisodes([])
    setAnimeId('')
    setEpisodeId('')
  }, [])

  const loadCommentsByEpisodeId = useCallback(async (epId: number) => {
    const comments = await danmakuApi.comments(epId)
    setPools((p) =>
      writePool(p, 'dandan', comments.data, 'replace', `ep ${epId}`),
    )
    setEpisodeId(epId)
    setStatus(`弹弹 · 已加载 ${comments.count} 条（其它源保留）`)
    return comments
  }, [])

  const scoreAnime = useCallback(
    (animeTitle: string) => {
      if (titleRefs?.length) {
        return bestTitleSimilarity(animeTitle, titleRefs)
      }
      return titleSimilarity(animeTitle, title)
    },
    [title, titleRefs],
  )

  // Auto-match (never blocks video resolve)
  useEffect(() => {
    if (!autoMatch || !bangumiId) return
    const gen = ++autoMatchGen.current
    let cancelled = false

    async function loadDanmaku() {
      setStatus('匹配弹幕…')
      // keep previous pools until dandan arrives (avoid empty flash)
      setAnimes([])
      setEpisodes([])
      setAnimeId('')
      setEpisodeId('')
      try {
        const [mappedResult, searchResult] = await Promise.allSettled([
          danmakuApi.bangumiByBgm(bangumiId),
          danmakuApi.search(title),
        ])

        if (cancelled || gen !== autoMatchGen.current) return

        let matchedEpisodeId = 0
        let matchedAnimeId = 0

        if (mappedResult.status === 'fulfilled') {
          const mapped = mappedResult.value
          if (mapped.data.episodes.length) {
            const ep =
              mapped.data.episodes[Math.max(0, episode - 1)] ||
              mapped.data.episodes[0]
            matchedEpisodeId = ep.episodeId
            matchedAnimeId = mapped.data.bangumiId
            setEpisodes(mapped.data.episodes)
            setAnimeId(matchedAnimeId || '')
          }
        }

        if (searchResult.status === 'fulfilled') {
          setAnimes(searchResult.value.data)
        }

        if (!matchedEpisodeId && searchResult.status === 'fulfilled') {
          let bestId = 0
          let bestScore = 0
          for (const a of searchResult.value.data) {
            if (a.animeId >= 100000 || a.animeId < 2) continue
            const score = scoreAnime(a.animeTitle)
            if (score > bestScore) {
              bestScore = score
              bestId = a.animeId
            }
          }
          if (bestId && bestScore >= 0.3) {
            matchedAnimeId = bestId
            const info = await danmakuApi.bangumi(bestId)
            if (cancelled || gen !== autoMatchGen.current) return
            setEpisodes(info.data.episodes)
            setAnimeId(bestId)
            const ep =
              info.data.episodes[Math.max(0, episode - 1)] ||
              info.data.episodes[0]
            if (ep) matchedEpisodeId = ep.episodeId
            else
              matchedEpisodeId = Number(
                `${bestId}${String(episode).padStart(4, '0')}`,
              )
          }
        }

        if (cancelled || gen !== autoMatchGen.current) return

        if (!matchedEpisodeId) {
          setStatus('未匹配到弹幕，点「设置」手动搜索或导入')
          return
        }
        await loadCommentsByEpisodeId(matchedEpisodeId)
        if (cancelled || gen !== autoMatchGen.current) return
      } catch (e) {
        if (!cancelled && gen === autoMatchGen.current) {
          setStatus(e instanceof Error ? e.message : '弹幕加载失败')
        }
      }
    }

    void loadDanmaku()
    return () => {
      cancelled = true
    }
  }, [
    autoMatch,
    bangumiId,
    episode,
    title,
    matchKey,
    scoreAnime,
    loadCommentsByEpisodeId,
  ])

  const handleEpisodeChange = useCallback(
    async (epId: number) => {
      setStatus('加载弹幕中…')
      try {
        await loadCommentsByEpisodeId(epId)
      } catch (e) {
        setStatus(e instanceof Error ? e.message : '弹幕加载失败')
      }
    },
    [loadCommentsByEpisodeId],
  )

  const handleAnimeChange = useCallback(
    async (id: number, list?: DanmakuAnime[]) => {
      setAnimeId(id)
      setStatus('正在搜索剧集…')
      try {
        const info = await danmakuApi.bangumi(id)
        setEpisodes(info.data.episodes)
        const name =
          (list || animes).find((a) => a.animeId === id)?.animeTitle || ''
        setStatus(
          name
            ? `${name} · ${info.data.episodes.length} 集`
            : `找到 ${info.data.episodes.length} 集`,
        )
        const ep =
          info.data.episodes[Math.max(0, episode - 1)] || info.data.episodes[0]
        if (ep) await handleEpisodeChange(ep.episodeId)
      } catch (e) {
        setStatus(e instanceof Error ? e.message : '剧集加载失败')
      }
    },
    [animes, episode, handleEpisodeChange],
  )

  const handleSearch = useCallback(async () => {
    const kw = keyword.trim()
    if (kw.length < 2) {
      setStatus('番剧名称不少于 2 个字')
      return
    }
    setSearchBusy(true)
    setStatus('正在搜索番剧…')
    try {
      const search = await danmakuApi.search(kw)
      setAnimes(search.data)
      setEpisodes([])
      setAnimeId('')
      setEpisodeId('')
      if (!search.data.length) {
        setStatus('无搜索结果')
        return
      }
      setStatus(`找到 ${search.data.length} 部番剧`)
      await handleAnimeChange(search.data[0].animeId, search.data)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '搜索失败')
    } finally {
      setSearchBusy(false)
    }
  }, [keyword, handleAnimeChange])

  const handleLoadBilibili = useCallback(async () => {
    const bvid = extractBvid(bvInput)
    if (!bvid) {
      setStatus('请输入有效 BV 号或视频链接')
      return
    }
    setBilibiliBusy(true)
    setStatus(`拉取 B 站弹幕 ${bvid}…`)
    try {
      const res = await danmakuApi.bilibili(bvid, bvPage)
      const part = res.meta.part ? ` · ${res.meta.part}` : ''
      const meta = `${res.meta.title || bvid}${part}`
      setPools((p) => writePool(p, 'bilibili', res.data, 'append', meta))
      setStatus(`已追加 B站 · ${meta} · +${res.count} 条（默认叠加显示）`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'B 站弹幕拉取失败')
    } finally {
      setBilibiliBusy(false)
    }
  }, [bvInput, bvPage])

  const handleLoadXmlFile = useCallback(async (file: File) => {
    setStatus(`解析 ${file.name}…`)
    try {
      const text = await file.text()
      const list = parseDanmakuXml(text)
      if (!list.length) {
        setStatus('XML 中未找到弹幕（需 bilibili / pakku 格式）')
        return
      }
      setPools((p) => writePool(p, 'upload', list, 'append', file.name))
      setStatus(
        `已追加 用户上传 · ${file.name} · +${list.length} 条（默认叠加显示）`,
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'XML 解析失败')
    }
  }, [])

  const panel: DanmakuPanelState = useMemo(
    () => ({
      status: status || poolsStatusLine(pools),
      commentsCount: loadedCount,
      visibleCount,
      keyword,
      onKeywordChange: setKeyword,
      onSearch: () => void handleSearch(),
      searchBusy,
      animes,
      episodes,
      animeId,
      episodeId,
      onAnimeChange: (id) => void handleAnimeChange(id),
      onEpisodeChange: (id) => void handleEpisodeChange(id),
      bvInput,
      onBvInputChange: setBvInput,
      bvPage,
      onBvPageChange: setBvPage,
      onLoadBilibili: () => void handleLoadBilibili(),
      bilibiliBusy,
      onLoadXmlFile: (f) => void handleLoadXmlFile(f),
      sources: chips,
      onToggleSource: toggleSource,
    }),
    [
      status,
      pools,
      loadedCount,
      visibleCount,
      keyword,
      searchBusy,
      animes,
      episodes,
      animeId,
      episodeId,
      bvInput,
      bvPage,
      bilibiliBusy,
      chips,
      handleSearch,
      handleAnimeChange,
      handleEpisodeChange,
      handleLoadBilibili,
      handleLoadXmlFile,
      toggleSource,
    ],
  )

  return {
    pools,
    setPools,
    status,
    setStatus,
    visibleComments,
    loadedCount,
    visibleCount,
    chips,
    toggleSource,
    resetPools,
    panel,
    statusLine: status || poolsStatusLine(pools),
  }
}
