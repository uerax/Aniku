import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type {
  DanmakuAnime,
  DanmakuEpisode,
  Road,
} from '@aniku/shared'
import { extractBvid, parseDanmakuXml } from '@aniku/shared'
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
import { useHistoryStore } from '../stores/history'
import { useSettingsStore } from '../stores/settings'
import { ErrorState, LoadingState, PageHeader } from '../components/ui'
import { VideoPlayer } from '../player/VideoPlayer'
import { EmbedPlayer } from '../player/EmbedPlayer'
import { EMPTY_ARRAY, FALLBACK_DANMAKU, FALLBACK_PLAYER } from '../lib/stable'

function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase().replace(/\s+/g, '')
  const s2 = b.toLowerCase().replace(/\s+/g, '')
  if (!s1 || !s2) return 0
  if (s1 === s2) return 1
  if (s1.includes(s2) || s2.includes(s1)) return 0.9
  const set1 = new Set(s1)
  let inter = 0
  for (const ch of s2) if (set1.has(ch)) inter++
  return inter / Math.max(s1.length, s2.length)
}

export function PlayPage() {
  const { id } = useParams()
  const bangumiId = Number(id)
  const [params, setParams] = useSearchParams()
  const pluginName = params.get('plugin') || ''
  const pageUrl = params.get('pageUrl') || ''
  const episode = Number(params.get('ep') || '1')
  const road = Number(params.get('road') || '0')
  const title = params.get('title') || `番剧 ${bangumiId}`
  const cover = params.get('cover') || ''

  const plugins = usePluginStore((s) =>
    Array.isArray(s.plugins) ? s.plugins : EMPTY_ARRAY,
  )
  const plugin = plugins.find((p) => p.name === pluginName)
  const upsertHistory = useHistoryStore((s) => s.upsert)
  const items = useHistoryStore((s) =>
    Array.isArray(s.items) ? s.items : EMPTY_ARRAY,
  )
  const history = items.find(
    (i) =>
      i.bangumiId === bangumiId &&
      i.pluginName === pluginName &&
      i.episode === episode &&
      i.road === road,
  )
  const danmakuSettings = useSettingsStore((s) => s.danmaku ?? FALLBACK_DANMAKU)
  const setDanmaku = useSettingsStore((s) => s.setDanmaku)
  const playerSettings = useSettingsStore((s) => s.player ?? FALLBACK_PLAYER)
  const setPlayer = useSettingsStore((s) => s.setPlayer)

  const [roads, setRoads] = useState<Road[]>([])
  const [danmakuPools, setDanmakuPools] = useState<DanmakuPools>(emptyDanmakuPools)
  const [danmakuStatus, setDanmakuStatus] = useState('')
  const [keyword, setKeyword] = useState(title)
  const [animes, setAnimes] = useState<DanmakuAnime[]>([])
  const [episodes, setEpisodes] = useState<DanmakuEpisode[]>([])
  const [animeId, setAnimeId] = useState<number | ''>('')
  const [episodeId, setEpisodeId] = useState<number | ''>('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [bvInput, setBvInput] = useState('')
  const [bvPage, setBvPage] = useState(1)
  const [bilibiliBusy, setBilibiliBusy] = useState(false)
  const resumeRef = useRef(history?.position || 0)
  const autoMatchGen = useRef(0)

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

  useEffect(() => {
    resumeRef.current = history?.position || 0
  }, [history?.position, pageUrl])

  useEffect(() => {
    setKeyword(title)
  }, [title])

  // load sibling episodes for sidebar
  useEffect(() => {
    let cancelled = false
    async function loadRoads() {
      if (!plugin || !pageUrl) return
      const cacheKey = `roads:${bangumiId}:${pluginName}`
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        try {
          if (!cancelled) setRoads(JSON.parse(cached) as Road[])
          return
        } catch {
          /* ignore */
        }
      }
    }
    void loadRoads()
    return () => {
      cancelled = true
    }
  }, [plugin, pageUrl, bangumiId, pluginName])

  const resolve = useQuery({
    queryKey: ['resolve', pluginName, pageUrl],
    queryFn: () => {
      if (!plugin) throw new Error('未找到插件，请先在设置中导入规则')
      if (!pageUrl) throw new Error('缺少播放页地址')
      return pluginApi.resolve(plugin, pageUrl)
    },
    enabled: Boolean(plugin && pageUrl),
    retry: 1,
  })

  const loadCommentsByEpisodeId = useCallback(async (epId: number) => {
    const comments = await danmakuApi.comments(epId)
    setDanmakuPools((p) =>
      writePool(p, 'dandan', comments.data, 'replace', `ep ${epId}`),
    )
    setEpisodeId(epId)
    setDanmakuStatus(`弹弹 · 已加载 ${comments.count} 条（其它源保留）`)
    return comments
  }, [])

  // auto match danmaku (弹弹) — never blocks video resolve; only replaces dandan pool
  useEffect(() => {
    const gen = ++autoMatchGen.current
    let cancelled = false

    async function loadDanmaku() {
      setDanmakuStatus('匹配弹幕中…')
      // keep previous pools until dandan arrives (avoid empty flash)
      setAnimes([])
      setEpisodes([])
      setAnimeId('')
      setEpisodeId('')
      try {
        // bgm mapping and title search in parallel
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
            const score = similarity(a.animeTitle, title)
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
          setDanmakuStatus('未匹配到弹幕库，可在播放器「幕」中手动搜索或导入')
          return
        }
        await loadCommentsByEpisodeId(matchedEpisodeId)
      } catch (e) {
        if (!cancelled && gen === autoMatchGen.current) {
          setDanmakuStatus(e instanceof Error ? e.message : '弹幕加载失败')
        }
      }
    }
    if (bangumiId) void loadDanmaku()
    return () => {
      cancelled = true
    }
  }, [bangumiId, episode, title, loadCommentsByEpisodeId])

  async function handleSearch() {
    const kw = keyword.trim()
    if (kw.length < 2) {
      setDanmakuStatus('番剧名称不少于 2 个字')
      return
    }
    setSearchBusy(true)
    setDanmakuStatus('正在搜索番剧…')
    try {
      const search = await danmakuApi.search(kw)
      setAnimes(search.data)
      setEpisodes([])
      setAnimeId('')
      setEpisodeId('')
      if (!search.data.length) {
        setDanmakuStatus('无搜索结果')
        return
      }
      setDanmakuStatus(`找到 ${search.data.length} 部番剧`)
      // auto pick first
      const first = search.data[0]
      await handleAnimeChange(first.animeId, search.data)
    } catch (e) {
      setDanmakuStatus(e instanceof Error ? e.message : '搜索失败')
    } finally {
      setSearchBusy(false)
    }
  }

  async function handleAnimeChange(
    id: number,
    list?: DanmakuAnime[],
  ) {
    setAnimeId(id)
    setDanmakuStatus('正在搜索剧集…')
    try {
      const info = await danmakuApi.bangumi(id)
      setEpisodes(info.data.episodes)
      const name =
        (list || animes).find((a) => a.animeId === id)?.animeTitle || ''
      setDanmakuStatus(
        name
          ? `${name} · ${info.data.episodes.length} 集`
          : `找到 ${info.data.episodes.length} 集`,
      )
      const ep =
        info.data.episodes[Math.max(0, episode - 1)] || info.data.episodes[0]
      if (ep) await handleEpisodeChange(ep.episodeId)
    } catch (e) {
      setDanmakuStatus(e instanceof Error ? e.message : '剧集加载失败')
    }
  }

  async function handleEpisodeChange(epId: number) {
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

  const proxyUrl = resolve.data?.data.proxyUrl

  function onProgress(position: number, duration: number) {
    if (!plugin || !pageUrl) return
    upsertHistory({
      bangumiId,
      title,
      cover,
      episode,
      road,
      pluginName,
      pageUrl,
      playUrl: resolve.data?.data.playUrl,
      position,
      duration,
    })
  }

  function switchEpisode(roadIndex: number, epIndex: number, roadItem: Road) {
    const nextUrl = roadItem.data[epIndex]
    if (!nextUrl) return
    const q = new URLSearchParams(params)
    q.set('pageUrl', nextUrl)
    q.set('ep', String(epIndex + 1))
    q.set('road', String(roadIndex))
    setParams(q)
  }

  function goAdjacentEpisode(delta: number) {
    const roadItem = roads[road]
    if (!roadItem?.data?.length) return
    const nextIdx = episode - 1 + delta
    if (nextIdx < 0 || nextIdx >= roadItem.data.length) return
    switchEpisode(road, nextIdx, roadItem)
  }

  useEffect(() => {
    const cacheKey = `roads:${bangumiId}:${pluginName}`
    const onStorage = () => {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        try {
          setRoads(JSON.parse(cached) as Road[])
        } catch {
          /* ignore */
        }
      }
    }
    onStorage()
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [bangumiId, pluginName])

  const currentRoad = roads[road]

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={`${pluginName || '未知源'} · 第 ${episode} 集`}
        actions={
          <Link
            to={`/subject/${bangumiId}`}
            className="text-sm text-sky-400 hover:underline"
          >
            返回详情
          </Link>
        }
      />

      {!plugin && (
        <ErrorState
          error={new Error('未找到规则插件，请在设置中导入并确保名称一致')}
        />
      )}
      {plugin && resolve.isLoading && <LoadingState text="解析播放地址…" />}

      {/* Native player when static resolve found m3u8/mp4 */}
      {proxyUrl && (
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
          }}
        />
      )}

      {/*
        Fallback: embed source play page in iframe so site JS can run.
        Not equal to desktop WebView (no media intercept / no danmaku sync).
      */}
      {plugin && pageUrl && resolve.isError && !proxyUrl && (
        <EmbedPlayer
          pageUrl={pageUrl}
          title={title}
          reason={
            resolve.error instanceof Error
              ? resolve.error.message
              : '静态解析失败'
          }
          onRetryResolve={() => void resolve.refetch()}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="font-medium">弹幕</h3>
          <div className="text-sm text-zinc-400">{danmakuStatus || '—'}</div>
          <p className="text-xs text-zinc-500">
            控制栏「弹」开关 / 「幕」打开面板（搜索 · 设置 · 导入）。支持拖入
            XML、B 站 BV。快捷键 D 开关弹幕，Alt+M 开关面板。
          </p>
          {resolve.data?.data.diagnostics && (
            <details className="text-xs text-zinc-500">
              <summary>解析诊断</summary>
              <ul className="mt-1 list-disc pl-4">
                {resolve.data.data.diagnostics.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="mb-2 font-medium">选集</h3>
          {!currentRoad && (
            <p className="text-sm text-zinc-500">
              从详情页进入时可切换分集。也可返回详情重新选源。
            </p>
          )}
          {roads.map((r, ri) => (
            <div key={r.name + ri} className="mb-3">
              <div className="mb-1 text-xs text-zinc-500">{r.name}</div>
              <div className="flex flex-wrap gap-1">
                {r.identifier.map((name, ei) => (
                  <button
                    key={r.data[ei]}
                    type="button"
                    onClick={() => switchEpisode(ri, ei, r)}
                    className={
                      ri === road && ei + 1 === episode
                        ? 'rounded bg-sky-600 px-2 py-1 text-xs'
                        : 'rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700'
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
