/**
 * Native <video> + hls.js player (no Plyr / DPlayer).
 * Plyr fought MSE (black screen while .ts still 200). This path matches
 * what worked with DPlayer: attach HLS to a real video element and paint it full-size.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react'
import './plyr-overrides.css'
import Danmaku from '@ironkinoko/danmaku'
import type { Comment as IronComment } from '@ironkinoko/danmaku'
import Hls from 'hls.js'
import {
  PLAYER_SPEEDS,
  type DanmakuAnime,
  type DanmakuComment,
  type DanmakuEpisode,
  type DanmakuSettings,
  type PlayerSettings,
} from '@aniku/shared'
import { DanmakuPanel, type DanmakuPanelTab } from './DanmakuPanel'
import type {
  DanmakuPoolId,
  DanmakuSourceChip,
} from '../lib/danmaku-pools'

export interface DanmakuPanelState {
  status: string
  commentsCount: number
  /** currently drawn after source toggles */
  visibleCount?: number
  keyword: string
  onKeywordChange: (v: string) => void
  onSearch: () => void
  searchBusy?: boolean
  animes: DanmakuAnime[]
  episodes: DanmakuEpisode[]
  animeId: number | ''
  episodeId: number | ''
  onAnimeChange: (id: number) => void
  onEpisodeChange: (id: number) => void
  bvInput: string
  onBvInputChange: (v: string) => void
  bvPage: number
  onBvPageChange: (p: number) => void
  onLoadBilibili: () => void
  bilibiliBusy?: boolean
  onLoadXmlFile: (file: File) => void
  sources?: DanmakuSourceChip[]
  onToggleSource?: (id: DanmakuPoolId) => void
}

interface Props {
  src: string
  initialTime?: number
  comments: DanmakuComment[]
  danmaku: DanmakuSettings
  player: PlayerSettings
  onPlayerChange?: (partial: Partial<PlayerSettings>) => void
  onProgress?: (position: number, duration: number) => void
  onToggleDanmaku?: () => void
  onDanmakuChange?: (partial: Partial<DanmakuSettings>) => void
  onEnded?: () => void
  onPrev?: () => void
  onNext?: () => void
  embedded?: boolean
  hideHints?: boolean
  danmakuPanel?: DanmakuPanelState
}

const BASE_DANMAKU_SPEED = 130

function filterComments(
  comments: DanmakuComment[],
  settings: DanmakuSettings,
): DanmakuComment[] {
  return comments.filter((c) => {
    if (!settings.showScroll && c.mode === 'rtl') return false
    if (!settings.showTop && c.mode === 'top') return false
    if (!settings.showBottom && c.mode === 'bottom') return false
    if (
      !settings.showColor &&
      c.style?.color &&
      c.style.color.toLowerCase() !== '#ffffff'
    ) {
      return false
    }
    for (const rule of settings.filters) {
      if (!rule) continue
      if (rule.startsWith('/') && rule.lastIndexOf('/') > 0) {
        try {
          const body = rule.slice(1, rule.lastIndexOf('/'))
          const flags = rule.slice(rule.lastIndexOf('/') + 1)
          if (new RegExp(body, flags).test(c.text)) return false
        } catch {
          /* ignore */
        }
      } else if (c.text.includes(rule)) {
        return false
      }
    }
    return true
  })
}

function toIronComments(
  comments: DanmakuComment[],
  settings: DanmakuSettings,
): IronComment[] {
  const fontSize = `${Math.round(22 * (settings.fontSize || 1))}px`
  return filterComments(comments, settings)
    .map((c) => ({
      time: c.time + (settings.timeOffset || 0),
      mode: c.mode || 'rtl',
      text: c.text,
      style: {
        color: c.style?.color || '#ffffff',
        fontSize,
        textShadow: '1px 1px 2px rgba(0,0,0,.85)',
        opacity: String(settings.opacity ?? 0.85),
      } as Partial<CSSStyleDeclaration>,
    }))
    .sort((a, b) => a.time - b.time)
}

function isM3u8(url: string) {
  try {
    const d = decodeURIComponent(url).toLowerCase()
    return d.includes('.m3u8') || d.includes('mpegurl') || d.includes('m3u8')
  } catch {
    const u = url.toLowerCase()
    return u.includes('.m3u8') || u.includes('mpegurl') || u.includes('m3u8')
  }
}

function isXmlDanmakuFile(file: File) {
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.xml') ||
    file.type === 'text/xml' ||
    file.type === 'application/xml' ||
    file.type === 'text/plain'
  )
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec % 60)
  const m = Math.floor(sec / 60) % 60
  const h = Math.floor(sec / 3600)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

export function VideoPlayer({
  src,
  initialTime = 0,
  comments,
  danmaku,
  player,
  onPlayerChange,
  onProgress,
  onToggleDanmaku,
  onDanmakuChange,
  onEnded,
  onPrev,
  onNext,
  embedded = false,
  danmakuPanel,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const danmakuCoreRef = useRef<Danmaku | null>(null)
  const genRef = useRef(0)
  const lastSaveRef = useRef(0)
  const skipBusyRef = useRef(false)
  const isSeekingRef = useRef(false)
  const resumedRef = useRef(false)

  const playerRef = useRef(player)
  const danmakuRef = useRef(danmaku)
  const commentsRef = useRef(comments)
  const onNextRef = useRef(onNext)
  const onPrevRef = useRef(onPrev)
  const onEndedRef = useRef(onEnded)
  const onProgressRef = useRef(onProgress)
  const onPlayerChangeRef = useRef(onPlayerChange)
  const onToggleDanmakuRef = useRef(onToggleDanmaku)
  const onDanmakuChangeRef = useRef(onDanmakuChange)
  const initialTimeRef = useRef(initialTime)
  const [offsetHint, setOffsetHint] = useState('')
  const offsetHintTimer = useRef(0)

  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<DanmakuPanelTab>('search')
  const [filterDraft, setFilterDraft] = useState('')
  const [dropActive, setDropActive] = useState(false)
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(true)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [showBar, setShowBar] = useState(true)
  /** player shell Fullscreen API */
  const [playerFs, setPlayerFs] = useState(false)
  /** CSS fill viewport without Fullscreen API (agefans-style webpage FS) */
  const [webFs, setWebFs] = useState(false)
  const hideBarTimer = useRef(0)
  const xmlInputRef = useRef<HTMLInputElement>(null)
  const toggleFsRef = useRef<() => void>(() => {})

  playerRef.current = player
  danmakuRef.current = danmaku
  commentsRef.current = comments
  onNextRef.current = onNext
  onPrevRef.current = onPrev
  onEndedRef.current = onEnded
  onProgressRef.current = onProgress
  onPlayerChangeRef.current = onPlayerChange
  onToggleDanmakuRef.current = onToggleDanmaku
  onDanmakuChangeRef.current = onDanmakuChange
  initialTimeRef.current = initialTime

  function applyDanmaku() {
    const video = videoRef.current
    const layer = layerRef.current
    if (!video || !layer) return
    const dm = danmakuRef.current
    const iron = toIronComments(commentsRef.current, dm)
    try {
      if (!danmakuCoreRef.current) {
        danmakuCoreRef.current = new Danmaku({
          container: layer,
          media: video,
          comments: iron,
          merge: false,
          overlap: false,
          scrollAreaPercent: Math.min(1, Math.max(0.15, dm.area || 0.5)),
          opacity: dm.opacity ?? 0.85,
          speed: BASE_DANMAKU_SPEED * (dm.speed || 1),
        })
      } else {
        const core = danmakuCoreRef.current
        core.reload(iron)
        core.opacity = dm.opacity ?? 0.85
        core.speed = BASE_DANMAKU_SPEED * (dm.speed || 1)
        core.scrollAreaPercent = Math.min(1, Math.max(0.15, dm.area || 0.5))
      }
      const core = danmakuCoreRef.current
      if (dm.enabled === false) core.hide()
      else {
        core.show()
        core.resize()
      }
    } catch (e) {
      console.warn('[danmaku]', e)
    }
  }

  function bumpBar() {
    setShowBar(true)
    window.clearTimeout(hideBarTimer.current)
    hideBarTimer.current = window.setTimeout(() => {
      const v = videoRef.current
      if (v && !v.paused) setShowBar(false)
    }, 2800)
  }

  // Load media
  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    const gen = ++genRef.current
    const alive = () => genRef.current === gen

    resumedRef.current = false
    skipBusyRef.current = false
    setMediaError('')
    setLoading(true)
    setPaused(true)
    setCurrent(0)
    setDuration(0)

    try {
      danmakuCoreRef.current?.destroy()
    } catch {
      /* ignore */
    }
    danmakuCoreRef.current = null

    if (hlsRef.current) {
      try {
        hlsRef.current.destroy()
      } catch {
        /* ignore */
      }
      hlsRef.current = null
    }

    video.removeAttribute('src')
    video.load()

    const cfg = playerRef.current
    video.volume = cfg.volume ?? 0.7
    video.playbackRate = cfg.speed || 1
    video.playsInline = true

    const softPlay = () => {
      if (!cfg.autoplay || !alive()) return
      const vol = cfg.volume ?? 0.7
      video.muted = true
      video
        .play()
        .then(() => {
          if (!alive()) return
          video.muted = false
          video.volume = vol
          setPaused(false)
        })
        .catch(() => {
          if (!alive()) return
          video.muted = false
          setPaused(true)
        })
    }

    const onReady = () => {
      if (!alive()) return
      setLoading(false)
      setDuration(video.duration || 0)
      const t0 = initialTimeRef.current
      if (!resumedRef.current && cfg.continuePlay && t0 > 15) {
        resumedRef.current = true
        try {
          video.currentTime = t0
        } catch {
          /* ignore */
        }
      }
      // Play first so video paints; attach danmaku after a frame
      // (early full-size GPU stage above video blacks out some Chrome builds)
      softPlay()
      requestAnimationFrame(() => {
        if (!alive()) return
        applyDanmaku()
        requestAnimationFrame(() => {
          if (!alive()) return
          try {
            danmakuCoreRef.current?.resize()
          } catch {
            /* ignore */
          }
        })
      })
    }

    console.info('[player] load', src.slice(0, 120), 'm3u8=', isM3u8(src))

    if (isM3u8(src) && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      })
      hlsRef.current = hls
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!alive()) return
        console.info('[player] manifest ok')
        onReady()
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!alive() || !data.fatal) return
        console.error('[player] hls fatal', data.type, data.details)
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setMediaError(`网络错误 ${data.details || ''}，重试…`)
          hls.startLoad()
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          setMediaError(`解码错误 ${data.details || ''}，恢复…`)
          hls.recoverMediaError()
        } else {
          setLoading(false)
          setMediaError(`播放失败: ${data.details || data.type}`)
        }
      })
    } else if (
      isM3u8(src) &&
      video.canPlayType('application/vnd.apple.mpegurl')
    ) {
      video.src = src
      video.addEventListener('loadedmetadata', onReady, { once: true })
      video.addEventListener(
        'error',
        () => {
          if (!alive()) return
          setLoading(false)
          setMediaError('原生 HLS 加载失败')
        },
        { once: true },
      )
    } else {
      video.src = src
      video.addEventListener('loadedmetadata', onReady, { once: true })
      video.addEventListener(
        'error',
        () => {
          if (!alive()) return
          setLoading(false)
          setMediaError(
            video.error?.code
              ? `视频错误 code=${video.error.code}（请重新选集）`
              : '视频加载失败，请重新选集',
          )
        },
        { once: true },
      )
    }

    const onTime = () => {
      const d = video.duration
      const t = video.currentTime
      setCurrent(t)
      if (Number.isFinite(d) && d > 0) setDuration(d)

      if (!Number.isFinite(d) || d <= 0) return
      const now = Date.now()
      if (now - lastSaveRef.current >= 5000) {
        lastSaveRef.current = now
        onProgressRef.current?.(t, d)
      }

      const p = playerRef.current
      if (isSeekingRef.current || skipBusyRef.current || t >= d - 3) return
      const safeMax = d - 0.1
      if (p.skipOp.enabled && p.skipOp.duration > 0) {
        const start = p.skipOp.start || 0
        const diff = Math.abs(p.skipOp.duration)
        if (t >= start && t < start + 0.4) {
          skipBusyRef.current = true
          video.currentTime = Math.min(start + diff, safeMax)
          setTimeout(() => {
            skipBusyRef.current = false
          }, 1500)
        }
      } else if (p.skipEd.enabled && p.skipEd.duration > 0) {
        const start = p.skipEd.start || 0
        const diff = Math.abs(p.skipEd.duration)
        if (start <= 0) {
          if (t >= d - diff && t < d - diff + 0.4) {
            skipBusyRef.current = true
            video.currentTime = Math.min(d, safeMax)
            setTimeout(() => {
              skipBusyRef.current = false
            }, 1500)
          }
        } else if (t >= start && t < start + 0.4) {
          skipBusyRef.current = true
          video.currentTime = Math.min(start + diff, safeMax)
          setTimeout(() => {
            skipBusyRef.current = false
          }, 1500)
        }
      }
    }

    const onPause = () => {
      setPaused(true)
      setShowBar(true)
      if (Number.isFinite(video.duration) && video.duration > 0) {
        onProgressRef.current?.(video.currentTime, video.duration)
      }
    }
    const onPlay = () => {
      setPaused(false)
      setLoading(false)
      bumpBar()
    }
    const onEndedHandler = () => {
      onPause()
      if (playerRef.current.autoNext && onNextRef.current) onNextRef.current()
      else onEndedRef.current?.()
    }
    const onVol = () => onPlayerChangeRef.current?.({ volume: video.volume })
    const onRate = () =>
      onPlayerChangeRef.current?.({ speed: video.playbackRate })
    const onSeeking = () => {
      isSeekingRef.current = true
    }
    const onSeeked = () => {
      setTimeout(() => {
        isSeekingRef.current = false
      }, 400)
    }

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('pause', onPause)
    video.addEventListener('play', onPlay)
    video.addEventListener('ended', onEndedHandler)
    video.addEventListener('volumechange', onVol)
    video.addEventListener('ratechange', onRate)
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('seeked', onSeeked)

    const ro = new ResizeObserver(() => {
      try {
        danmakuCoreRef.current?.resize()
      } catch {
        /* ignore */
      }
    })
    if (shellRef.current) ro.observe(shellRef.current)

    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const v = videoRef.current
      if (!v) return
      const k = e.key.toLowerCase()
      if (k === ' ' || k === 'k') {
        e.preventDefault()
        if (v.paused) void v.play()
        else v.pause()
      } else if (k === 'arrowleft') {
        v.currentTime = Math.max(0, v.currentTime - 5)
      } else if (k === 'arrowright') {
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 5)
      } else if (k === 'arrowup') {
        e.preventDefault()
        v.volume = Math.min(1, v.volume + 0.05)
      } else if (k === 'arrowdown') {
        e.preventDefault()
        v.volume = Math.max(0, v.volume - 0.05)
      } else if (k === 'f') {
        e.preventDefault()
        toggleFsRef.current()
      } else if (k === 'p') onPrevRef.current?.()
      else if (k === 'n') onNextRef.current?.()
      else if (k === 'd') {
        e.preventDefault()
        onToggleDanmakuRef.current?.()
      } else if (k === ',' || e.key === '，') {
        // agefans: lag danmaku +0.5s
        e.preventDefault()
        const cur = danmakuRef.current.timeOffset || 0
        const next = Math.round((cur + 0.5) * 10) / 10
        onDanmakuChangeRef.current?.({ timeOffset: next })
        setOffsetHint(`弹幕滞后 0.5s（偏移 ${next > 0 ? '+' : ''}${next}s）`)
        window.clearTimeout(offsetHintTimer.current)
        offsetHintTimer.current = window.setTimeout(
          () => setOffsetHint(''),
          1500,
        )
      } else if (k === '.' || e.key === '。') {
        // agefans: advance danmaku -0.5s
        e.preventDefault()
        const cur = danmakuRef.current.timeOffset || 0
        const next = Math.round((cur - 0.5) * 10) / 10
        onDanmakuChangeRef.current?.({ timeOffset: next })
        setOffsetHint(`弹幕超前 0.5s（偏移 ${next > 0 ? '+' : ''}${next}s）`)
        window.clearTimeout(offsetHintTimer.current)
        offsetHintTimer.current = window.setTimeout(
          () => setOffsetHint(''),
          1500,
        )
      } else if (k === '/' || e.key === '、') {
        // agefans: restore offset
        e.preventDefault()
        onDanmakuChangeRef.current?.({ timeOffset: 0 })
        setOffsetHint('弹幕偏移已复位')
        window.clearTimeout(offsetHintTimer.current)
        offsetHintTimer.current = window.setTimeout(
          () => setOffsetHint(''),
          1500,
        )
      } else if (k === 'm' && e.altKey) {
        e.preventDefault()
        setPanelOpen((x) => !x)
      } else if (k === 'escape') {
        setPanelOpen(false)
        setSpeedMenuOpen(false)
        // web-fs exit (Fullscreen API escape is handled by browser)
        setWebFs(false)
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
      ro.disconnect()
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('ended', onEndedHandler)
      video.removeEventListener('volumechange', onVol)
      video.removeEventListener('ratechange', onRate)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('seeked', onSeeked)
      try {
        danmakuCoreRef.current?.destroy()
      } catch {
        /* ignore */
      }
      danmakuCoreRef.current = null
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy()
        } catch {
          /* ignore */
        }
        hlsRef.current = null
      }
      window.clearTimeout(hideBarTimer.current)
      window.clearTimeout(offsetHintTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  useEffect(() => {
    applyDanmaku()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, danmaku])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (Math.abs(video.playbackRate - (player.speed || 1)) > 0.01) {
      video.playbackRate = player.speed || 1
    }
  }, [player.speed])

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }

  useEffect(() => {
    const onFs = () => {
      setPlayerFs(document.fullscreenElement === shellRef.current)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  /** Player container fullscreen (Fullscreen API on shell) */
  async function togglePlayerFs() {
    setWebFs(false)
    const shell = shellRef.current
    if (!shell) return
    try {
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen()
        return
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      }
      await shell.requestFullscreen()
    } catch (e) {
      console.warn('[player] player fullscreen failed', e)
    }
  }

  /** Expand player to viewport via CSS (no Fullscreen API) */
  function toggleWebFs() {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    }
    setWebFs((v) => !v)
  }

  async function exitAnyFs() {
    setWebFs(false)
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen()
      } catch {
        /* ignore */
      }
    }
  }

  /** F key: toggle player fullscreen (exit web-fs / any FS first) */
  function toggleFs() {
    if (webFs || document.fullscreenElement) {
      void exitAnyFs()
    } else {
      void togglePlayerFs()
    }
  }
  toggleFsRef.current = toggleFs

  function seekRatio(ratio: number) {
    const v = videoRef.current
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return
    v.currentTime = Math.max(0, Math.min(v.duration, ratio * v.duration))
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDropActive(false)
    const file = e.dataTransfer?.files?.[0]
    if (!file || !isXmlDanmakuFile(file)) return
    danmakuPanel?.onLoadXmlFile(file)
    setPanelTab('import')
    setPanelOpen(true)
  }

  function addFilter() {
    const rule = filterDraft.trim()
    if (!rule) return
    if (danmaku.filters.includes(rule)) {
      setFilterDraft('')
      return
    }
    onDanmakuChange?.({ filters: [...danmaku.filters, rule] })
    setFilterDraft('')
  }

  const progress =
    duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0

  return (
    <div
      ref={shellRef}
      className={
        webFs
          ? 'kz-player-shell kz-web-fs'
          : embedded
            ? // fill parent without overflow-hidden (Chrome blacks out video otherwise)
              'kz-player-shell absolute inset-0'
            : // 16:9, capped by viewport so small laptop screens don't overflow
              'kz-player-shell kz-player-frame relative rounded-2xl border border-zinc-800'
      }
      onMouseMove={bumpBar}
      onMouseLeave={() => {
        if (!paused) setShowBar(false)
      }}
      onDrop={danmakuPanel ? handleDrop : undefined}
      onDragOver={
        danmakuPanel
          ? (e) => {
              e.preventDefault()
              setDropActive(true)
            }
          : undefined
      }
      onDragLeave={
        danmakuPanel
          ? (e) => {
              if (e.currentTarget === e.target) setDropActive(false)
            }
          : undefined
      }
    >
      {/* Full-size video — never reparented by a third-party UI library */}
      <video
        ref={videoRef}
        className="kz-native-video"
        playsInline
        // Ensure decoder paints (some GPUs need this after MSE attach)
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          background: '#000',
          zIndex: 0,
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.kz-bar')) return
          togglePlay()
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          toggleFs()
        }}
      />

      {/* Danmaku overlay — transparent, no 3d transform (see CSS) */}
      <div
        ref={layerRef}
        className="kz-danmaku-layer"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          zIndex: 1,
          pointerEvents: 'none',
          background: 'transparent',
          overflow: 'hidden',
        }}
      />

      {loading && !mediaError && (
        <div className="kz-status-layer">
          <div className="kz-status-hint">加载视频中…</div>
        </div>
      )}

      {mediaError && (
        <div className="kz-status-layer">
          <div className="kz-media-error">{mediaError}</div>
        </div>
      )}

      {offsetHint && !mediaError && (
        <div className="kz-status-layer" style={{ alignItems: 'flex-start', paddingTop: '12%' }}>
          <div className="kz-status-hint">{offsetHint}</div>
        </div>
      )}

      {dropActive && (
        <div className="kz-drop-overlay">松开以加载弹幕 XML</div>
      )}

      {/* Center play when paused */}
      {paused && !loading && !mediaError && (
        <button
          type="button"
          className="kz-big-play"
          aria-label="播放"
          onClick={togglePlay}
        >
          ▶
        </button>
      )}

      {/* Control bar */}
      <div
        className={`kz-bar ${showBar || paused || panelOpen ? 'kz-bar--show' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          type="range"
          className="kz-seek"
          min={0}
          max={1000}
          value={Math.round(progress * 10)}
          onChange={(e) => seekRatio(Number(e.target.value) / 1000)}
          style={{ ['--kz-progress' as string]: `${progress}%` }}
          aria-label="进度"
        />
        <div className="kz-bar-row">
          <button type="button" className="kz-ctrl" onClick={togglePlay}>
            {paused ? '▶' : '❚❚'}
          </button>
          <button
            type="button"
            className="kz-ctrl"
            onClick={() => onPrev?.()}
            title="上一集 (P)"
          >
            上
          </button>
          <button
            type="button"
            className="kz-ctrl"
            onClick={() => onNext?.()}
            title="下一集 (N)"
          >
            下
          </button>
          <span className="kz-time">
            {formatTime(current)} / {formatTime(duration)}
          </span>
          <div className="kz-bar-spacer" />
          <button
            type="button"
            className="kz-ctrl"
            data-active={danmaku.enabled}
            onClick={() => onToggleDanmaku?.()}
            title="弹幕开关 (D)"
          >
            {danmaku.enabled ? '弹' : '关'}
          </button>
          {danmakuPanel && (
            <button
              type="button"
              className="kz-ctrl"
              onClick={() => {
                setSpeedMenuOpen(false)
                setPanelOpen((v) => !v)
              }}
              title="弹幕设置 (Alt+M)"
            >
              幕
            </button>
          )}
          <div className="kz-speed-wrap">
            <button
              type="button"
              className="kz-ctrl"
              onClick={() => {
                setPanelOpen(false)
                setSpeedMenuOpen((v) => !v)
              }}
            >
              {player.speed || 1}x
            </button>
            {speedMenuOpen && (
              <div className="kz-speed-menu">
                {[...PLAYER_SPEEDS].reverse().map((s) => (
                  <button
                    key={s}
                    type="button"
                    data-active={Math.abs((player.speed || 1) - s) < 0.01}
                    onClick={() => {
                      const v = videoRef.current
                      if (v) v.playbackRate = s
                      onPlayerChange?.({ speed: s })
                      setSpeedMenuOpen(false)
                    }}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            type="range"
            className="kz-vol"
            min={0}
            max={100}
            value={Math.round((player.volume ?? 0.7) * 100)}
            onChange={(e) => {
              const vol = Number(e.target.value) / 100
              if (videoRef.current) videoRef.current.volume = vol
              onPlayerChange?.({ volume: vol })
            }}
            style={{
              ['--kz-progress' as string]: `${Math.round((player.volume ?? 0.7) * 100)}%`,
            }}
            aria-label="音量"
          />
          <button
            type="button"
            className="kz-ctrl"
            data-active={playerFs}
            onClick={() => void togglePlayerFs()}
            title="播放器全屏 (F)"
          >
            {playerFs ? '退出' : '全屏'}
          </button>
          <button
            type="button"
            className="kz-ctrl"
            data-active={webFs}
            onClick={toggleWebFs}
            title="网页全屏（铺满视口，保留浏览器标签栏）"
          >
            {webFs ? '退出网页' : '网页全屏'}
          </button>
        </div>
      </div>

      {danmakuPanel && panelOpen && (
        <div
          className="kz-danmaku-panel-root"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <DanmakuPanel
            open
            tab={panelTab}
            onTabChange={setPanelTab}
            onClose={() => setPanelOpen(false)}
            status={danmakuPanel.status}
            commentsCount={danmakuPanel.commentsCount}
            visibleCount={danmakuPanel.visibleCount}
            danmaku={danmaku}
            onDanmakuChange={(p) => onDanmakuChange?.(p)}
            keyword={danmakuPanel.keyword}
            onKeywordChange={danmakuPanel.onKeywordChange}
            onSearch={danmakuPanel.onSearch}
            searchBusy={danmakuPanel.searchBusy}
            animes={danmakuPanel.animes}
            episodes={danmakuPanel.episodes}
            animeId={danmakuPanel.animeId}
            episodeId={danmakuPanel.episodeId}
            onAnimeChange={danmakuPanel.onAnimeChange}
            onEpisodeChange={danmakuPanel.onEpisodeChange}
            bvInput={danmakuPanel.bvInput}
            onBvInputChange={danmakuPanel.onBvInputChange}
            bvPage={danmakuPanel.bvPage}
            onBvPageChange={danmakuPanel.onBvPageChange}
            onLoadBilibili={danmakuPanel.onLoadBilibili}
            bilibiliBusy={danmakuPanel.bilibiliBusy}
            onPickXmlFile={() => xmlInputRef.current?.click()}
            filterDraft={filterDraft}
            onFilterDraftChange={setFilterDraft}
            onAddFilter={addFilter}
            onRemoveFilter={(rule) =>
              onDanmakuChange?.({
                filters: danmaku.filters.filter((r) => r !== rule),
              })
            }
            sources={danmakuPanel.sources}
            onToggleSource={danmakuPanel.onToggleSource}
            bottomOffset={72}
          />
        </div>
      )}

      {danmakuPanel && (
        <input
          ref={xmlInputRef}
          type="file"
          accept=".xml,text/xml,application/xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) danmakuPanel.onLoadXmlFile(f)
            e.target.value = ''
          }}
        />
      )}
    </div>
  )
}
