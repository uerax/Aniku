import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Road } from '@aniku/shared'
import { pluginApi } from '../lib/plugin-api'
import { pickPlaybackSrc } from '../lib/playback-src'
import {
  findRoadsForPlay,
  writeRoadsForSource,
} from '../lib/roads-cache'
import { useDanmakuSession } from '../lib/use-danmaku-session'
import { usePluginStore } from '../stores/plugins'
import { useHistoryStore } from '../stores/history'
import { useSettingsStore } from '../stores/settings'
import { ErrorState, LoadingState, PageHeader } from '../components/ui'
import {
  EmbedPlayerSuspense,
  VideoPlayerSuspense,
} from '../player/lazy'
import { EMPTY_ARRAY, FALLBACK_DANMAKU, FALLBACK_PLAYER } from '../lib/stable'

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
  const danmakuSettings = useSettingsStore((s) => s.danmaku ?? FALLBACK_DANMAKU)
  const setDanmaku = useSettingsStore((s) => s.setDanmaku)
  const playerSettings = useSettingsStore((s) => s.player ?? FALLBACK_PLAYER)
  const setPlayer = useSettingsStore((s) => s.setPlayer)

  const [roads, setRoads] = useState<Road[]>([])
  /** Force VideoPlayer remount when auth refresh returns the same proxyUrl */
  const [playerRemount, setPlayerRemount] = useState(0)
  /** After direct CDN fails (CORS/hotlink), force media proxy */
  const [forceProxy, setForceProxy] = useState(false)
  const resumeRef = useRef(0)

  const dm = useDanmakuSession({
    bangumiId,
    episode,
    title,
    matchKey: `${pluginName}|${pageUrl}`,
    autoMatch: Boolean(bangumiId),
  })

  // Resume position once per episode key — do not subscribe to full history
  useEffect(() => {
    const items = useHistoryStore.getState().items
    const list = Array.isArray(items) ? items : []
    const h = list.find(
      (i) =>
        i.bangumiId === bangumiId &&
        i.pluginName === pluginName &&
        i.episode === episode &&
        i.road === road,
    )
    resumeRef.current = h?.position || 0
  }, [bangumiId, pluginName, episode, road, pageUrl])

  // Sibling episode list: multi-source cache, then chapters API using pageUrl as source
  useEffect(() => {
    let cancelled = false
    async function loadRoads() {
      if (!plugin || !pageUrl || !pluginName || !bangumiId) return

      const hit = findRoadsForPlay({
        bangumiId,
        pluginName,
        pageUrl,
      })
      if (hit?.length) {
        if (!cancelled) setRoads(hit)
        return
      }

      // Cache miss (history resume / deep link): fetch chapters with play page as source
      try {
        const res = await pluginApi.chapters(plugin, pageUrl)
        if (cancelled) return
        const list = res.data.roads || []
        if (list.length) {
          writeRoadsForSource(bangumiId, pluginName, pageUrl, list)
          setRoads(list)
        } else {
          setRoads([])
        }
      } catch {
        if (!cancelled) setRoads([])
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

  // New episode → retry direct CDN first
  useEffect(() => {
    setForceProxy(false)
  }, [pageUrl, pluginName])

  const proxyUrl = resolve.data?.data.proxyUrl
  const playUrl = resolve.data?.data.playUrl
  const forceAdFilter = Boolean(playerSettings.forceAdBlocker)
  const playback = useMemo(
    () =>
      pickPlaybackSrc({
        playUrl,
        proxyUrl,
        forceProxy,
        forceAdFilter,
      }),
    [playUrl, proxyUrl, forceProxy, forceAdFilter],
  )
  const mediaSrc = playback.src

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

      {/* Native player: prefer direct CDN, fall back to media proxy */}
      {mediaSrc && (
        <VideoPlayerSuspense
          key={`${mediaSrc}#${playerRemount}#${playback.mode}`}
          src={mediaSrc}
          initialTime={
            playerSettings.continuePlay && resumeRef.current > 15
              ? resumeRef.current
              : 0
          }
          comments={dm.visibleComments}
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
          onMediaAuthExpired={async (position) => {
            if (position > 5) resumeRef.current = position
            await resolve.refetch()
            // Same proxyUrl string would not remount; force reload after re-auth
            setPlayerRemount((n) => n + 1)
          }}
          onMediaLoadFailed={({ position }) => {
            if (position > 5) resumeRef.current = position
            // Direct failed → use server proxy (CORS / hotlink)
            if (playback.mode === 'direct' && proxyUrl) {
              setForceProxy(true)
              setPlayerRemount((n) => n + 1)
            }
          }}
          danmakuPanel={dm.panel}
        />
      )}

      {/*
        Fallback: embed source play page in iframe so site JS can run.
        Not equal to desktop WebView (no media intercept / no danmaku sync).
      */}
      {plugin && pageUrl && resolve.isError && !mediaSrc && (
        <EmbedPlayerSuspense
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
          <div className="text-sm text-zinc-400">{dm.statusLine || '—'}</div>
          <p className="text-xs text-zinc-500">
            控制栏「弹」开关 / 「设置」打开面板（搜索 · 设置 · 导入）。支持拖入
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
