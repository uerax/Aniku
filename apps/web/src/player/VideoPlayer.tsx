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
  type SuperResolutionMode,
} from '@aniku/shared'
import { DanmakuPanel, type DanmakuPanelTab } from './DanmakuPanel'
import type {
  DanmakuPoolId,
  DanmakuSourceChip,
} from '../lib/danmaku-pools'
import {
  hasWebGPU,
  startAnime4K,
  SUPER_RESOLUTION_LABELS,
  supportsAnime4K,
  type Anime4KStop,
} from './anime4k'

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
  /**
   * Cookie / signed media expired (proxy 403 auth_expired or media error on cookie URL).
   * Parent should re-resolve and pass a new src; return a Promise to await.
   */
  onMediaAuthExpired?: (position: number) => void | Promise<void>
}

const BASE_DANMAKU_SPEED = 130

/* -------------------------------------------------------------------------- */
/* Fullscreen helpers — iOS Safari has no Element.requestFullscreen for divs  */
/* -------------------------------------------------------------------------- */

type FsEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullScreen?: () => Promise<void> | void
  webkitExitFullscreen?: () => Promise<void> | void
}

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
  webkitCancelFullScreen?: () => Promise<void> | void
}

type IosVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void
  webkitExitFullscreen?: () => void
  webkitDisplayingFullscreen?: boolean
  webkitSupportsFullscreen?: boolean
}

function getFullscreenElement(): Element | null {
  const d = document as FsDoc
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null
}

function isShellFullscreen(shell: HTMLElement | null): boolean {
  if (!shell) return false
  return getFullscreenElement() === shell
}

function canRequestDomFullscreen(el: HTMLElement): boolean {
  const e = el as FsEl
  return Boolean(
    e.requestFullscreen || e.webkitRequestFullscreen || e.webkitRequestFullScreen,
  )
}

async function requestDomFullscreen(el: HTMLElement): Promise<void> {
  const e = el as FsEl
  if (e.requestFullscreen) {
    await e.requestFullscreen()
    return
  }
  if (e.webkitRequestFullscreen) {
    await e.webkitRequestFullscreen()
    return
  }
  if (e.webkitRequestFullScreen) {
    await e.webkitRequestFullScreen()
    return
  }
  throw new Error('Fullscreen API not available')
}

async function exitDomFullscreen(): Promise<void> {
  const d = document as FsDoc
  if (!getFullscreenElement()) return
  if (document.exitFullscreen) {
    await document.exitFullscreen()
    return
  }
  if (d.webkitExitFullscreen) {
    await d.webkitExitFullscreen()
    return
  }
  if (d.webkitCancelFullScreen) {
    await d.webkitCancelFullScreen()
  }
}

function canIosVideoFullscreen(video: HTMLVideoElement | null): boolean {
  if (!video) return false
  const v = video as IosVideo
  // iPhone: webkitEnterFullscreen exists; webkitSupportsFullscreen may be true
  return typeof v.webkitEnterFullscreen === 'function'
}

function isIosVideoFullscreen(video: HTMLVideoElement | null): boolean {
  if (!video) return false
  return Boolean((video as IosVideo).webkitDisplayingFullscreen)
}

function enterIosVideoFullscreen(video: HTMLVideoElement): void {
  const v = video as IosVideo
  v.webkitEnterFullscreen?.()
}

function exitIosVideoFullscreen(video: HTMLVideoElement | null): void {
  if (!video) return
  const v = video as IosVideo
  if (v.webkitDisplayingFullscreen) {
    try {
      v.webkitExitFullscreen?.()
    } catch {
      /* ignore */
    }
  }
}

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
  onMediaAuthExpired,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const danmakuCoreRef = useRef<Danmaku | null>(null)
  const anime4kStopRef = useRef<Anime4KStop | null>(null)
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
  const onMediaAuthExpiredRef = useRef(onMediaAuthExpired)
  const initialTimeRef = useRef(initialTime)
  const authRetryRef = useRef(false)
  const [offsetHint, setOffsetHint] = useState('')
  const offsetHintTimer = useRef(0)

  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<DanmakuPanelTab>('search')
  const [filterDraft, setFilterDraft] = useState('')
  const [dropActive, setDropActive] = useState(false)
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
  const [srMenuOpen, setSrMenuOpen] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(true)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  /** Progressive mp4 seek often waits on network — show feedback while seeking/waiting */
  const [seekingUi, setSeekingUi] = useState(false)
  const [showBar, setShowBar] = useState(true)
  /** player shell Fullscreen API */
  const [playerFs, setPlayerFs] = useState(false)
  /** CSS fill viewport without Fullscreen API (agefans-style webpage FS) */
  const [webFs, setWebFs] = useState(false)
  /** WebGPU Anime4K pipeline currently painting to canvas */
  const [srActive, setSrActive] = useState(false)
  /** null = not probed yet; false = no WebGPU / no adapter */
  const [webGpuOk, setWebGpuOk] = useState<boolean | null>(
    () => (typeof navigator !== 'undefined' && hasWebGPU() ? null : false),
  )
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
  onMediaAuthExpiredRef.current = onMediaAuthExpired
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
    authRetryRef.current = false
    setMediaError('')
    setLoading(true)
    setSeekingUi(false)
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

      const tryAuthRefresh = () => {
        if (!alive() || authRetryRef.current) return false
        // cookie-backed progressive sources (anime1 etc.)
        if (!/[?&]cookie=/.test(src) || !onMediaAuthExpiredRef.current) {
          return false
        }
        authRetryRef.current = true
        const pos = video.currentTime || 0
        setMediaError('')
        setLoading(true)
        setOffsetHint('播放凭证失效，正在重新获取…')
        window.clearTimeout(offsetHintTimer.current)
        offsetHintTimer.current = window.setTimeout(
          () => setOffsetHint(''),
          4000,
        )
        void Promise.resolve(onMediaAuthExpiredRef.current(pos)).catch(() => {
          if (!alive()) return
          setLoading(false)
          setMediaError('凭证刷新失败，请重新选集')
        })
        return true
      }

      video.addEventListener(
        'error',
        () => {
          if (!alive()) return
          if (tryAuthRefresh()) return
          setLoading(false)
          setMediaError(
            video.error?.code
              ? `视频错误 code=${video.error.code}（请重新选集）`
              : '视频加载失败，请重新选集',
          )
        },
        { once: true },
      )

      // Mid-play 403 often surfaces as stalled buffer; probe proxy once
      const onStalled = () => {
        if (!alive() || authRetryRef.current) return
        if (!/[?&]cookie=/.test(src) || !onMediaAuthExpiredRef.current) return
        const pos = video.currentTime || 0
        // lightweight HEAD-ish GET with range to detect auth_expired JSON
        void fetch(src, {
          headers: { Range: 'bytes=0-1' },
          credentials: 'same-origin',
        }).then(async (r) => {
          if (!alive() || authRetryRef.current) return
          if (r.status === 403 || r.status === 401) {
            try {
              const j = (await r.json()) as { error?: string }
              if (j?.error === 'auth_expired' || r.status === 403) {
                tryAuthRefresh()
              }
            } catch {
              tryAuthRefresh()
            }
            return
          }
          // if still ok, ignore stall
          void pos
        })
      }
      video.addEventListener('stalled', onStalled)
      video.addEventListener('error', onStalled)

      // cleanup extra listeners with effect teardown below via video events list
      ;(video as HTMLVideoElement & { __a1Stalled?: () => void }).__a1Stalled =
        onStalled
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
      setSeekingUi(true)
    }
    const onSeeked = () => {
      // Progressive files may still be waiting for data after seeked fires
      const clearSeekUi = () => {
        isSeekingRef.current = false
        setSeekingUi(false)
      }
      // If buffer covers currentTime, clear quickly; else keep spinner until canplay
      try {
        const t = video.currentTime
        for (let i = 0; i < video.buffered.length; i++) {
          if (t >= video.buffered.start(i) && t <= video.buffered.end(i) - 0.1) {
            setTimeout(clearSeekUi, 120)
            return
          }
        }
      } catch {
        /* ignore */
      }
      setTimeout(clearSeekUi, 800)
    }
    const onWaiting = () => {
      // Network rebuffer (common after long seek on progressive mp4 via proxy)
      if (!video.paused) setSeekingUi(true)
    }
    const onCanPlay = () => {
      setSeekingUi(false)
      isSeekingRef.current = false
    }

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('pause', onPause)
    video.addEventListener('play', onPlay)
    video.addEventListener('ended', onEndedHandler)
    video.addEventListener('volumechange', onVol)
    video.addEventListener('ratechange', onRate)
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('playing', onCanPlay)

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
        setSrMenuOpen(false)
        // Exit CSS web-fs + any DOM fullscreen (browser also exits DOM FS)
        setWebFs(false)
        setPlayerFs(false)
        void exitDomFullscreen()
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
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('playing', onCanPlay)
      const stalled = (
        video as HTMLVideoElement & { __a1Stalled?: () => void }
      ).__a1Stalled
      if (stalled) {
        video.removeEventListener('stalled', stalled)
        video.removeEventListener('error', stalled)
        delete (video as HTMLVideoElement & { __a1Stalled?: () => void })
          .__a1Stalled
      }
      try {
        danmakuCoreRef.current?.destroy()
      } catch {
        /* ignore */
      }
      danmakuCoreRef.current = null
      try {
        anime4kStopRef.current?.()
      } catch {
        /* ignore */
      }
      anime4kStopRef.current = null
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

  // Probe WebGPU once when user opens SR menu or has a non-off preference
  useEffect(() => {
    const mode = player.superResolution || 'off'
    if (mode === 'off' && !srMenuOpen) return
    if (webGpuOk !== null) return
    let cancelled = false
    void supportsAnime4K().then((ok) => {
      if (!cancelled) setWebGpuOk(ok)
    })
    return () => {
      cancelled = true
    }
  }, [player.superResolution, srMenuOpen, webGpuOk])

  /**
   * Anime4K: only when mode !== off. Dynamic-import + disposable GPU controller.
   * Off path does not load anime4k-webgpu or touch WebGPU.
   */
  useEffect(() => {
    const mode = (player.superResolution || 'off') as SuperResolutionMode
    const video = videoRef.current
    const canvas = canvasRef.current
    if (mode === 'off' || !video || !canvas) {
      try {
        anime4kStopRef.current?.()
      } catch {
        /* ignore */
      }
      anime4kStopRef.current = null
      setSrActive(false)
      return
    }

    let cancelled = false
    let stop: Anime4KStop | null = null

    const run = async () => {
      try {
        if (webGpuOk === false) {
          setSrActive(false)
          return
        }
        const ok = webGpuOk === true ? true : await supportsAnime4K()
        if (cancelled) return
        if (!ok) {
          setWebGpuOk(false)
          setSrActive(false)
          return
        }
        setWebGpuOk(true)

        // wait for dimensions if needed
        if (!(video.videoWidth > 0)) {
          await new Promise<void>((resolve) => {
            const done = () => {
              video.removeEventListener('loadedmetadata', done)
              resolve()
            }
            video.addEventListener('loadedmetadata', done)
            if (video.videoWidth > 0) {
              video.removeEventListener('loadedmetadata', done)
              resolve()
            }
          })
        }
        if (cancelled || !(video.videoWidth > 0)) return

        try {
          anime4kStopRef.current?.()
        } catch {
          /* ignore */
        }
        anime4kStopRef.current = null

        stop = await startAnime4K({
          video,
          canvas,
          mode: mode === 'quality' ? 'quality' : 'efficiency',
          layoutEl: shellRef.current,
        })
        if (cancelled) {
          stop()
          return
        }
        anime4kStopRef.current = stop
        setSrActive(true)
      } catch (e) {
        console.warn('[player] Anime4K failed', e)
        if (!cancelled) {
          setSrActive(false)
          setOffsetHint(
            e instanceof Error
              ? `超分启动失败：${e.message}`
              : '超分启动失败（见控制台）',
          )
          window.clearTimeout(offsetHintTimer.current)
          offsetHintTimer.current = window.setTimeout(
            () => setOffsetHint(''),
            4000,
          )
        }
      }
    }

    void run()

    return () => {
      cancelled = true
      try {
        stop?.()
      } catch {
        /* ignore */
      }
      try {
        anime4kStopRef.current?.()
      } catch {
        /* ignore */
      }
      anime4kStopRef.current = null
      setSrActive(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- webGpuOk set inside after probe
  }, [src, player.superResolution, playerFs, webFs])

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }

  useEffect(() => {
    const onFs = () => {
      setPlayerFs(isShellFullscreen(shellRef.current))
    }
    // Standard + legacy webkit (older Safari / iPadOS)
    document.addEventListener('fullscreenchange', onFs)
    document.addEventListener('webkitfullscreenchange', onFs as EventListener)
    // iOS native video fullscreen (video.webkitEnterFullscreen)
    const video = videoRef.current
    const onVideoFsBegin = () => setPlayerFs(true)
    const onVideoFsEnd = () => {
      // If CSS web-fs still on, keep "expanded" feel via that path
      setPlayerFs(isShellFullscreen(shellRef.current))
    }
    video?.addEventListener('webkitbeginfullscreen', onVideoFsBegin)
    video?.addEventListener('webkitendfullscreen', onVideoFsEnd)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      document.removeEventListener(
        'webkitfullscreenchange',
        onFs as EventListener,
      )
      video?.removeEventListener('webkitbeginfullscreen', onVideoFsBegin)
      video?.removeEventListener('webkitendfullscreen', onVideoFsEnd)
    }
  }, [src])

  /**
   * Player fullscreen:
   * 1) Standard / webkit Fullscreen API on shell (desktop / iPadOS 15+ often)
   * 2) iOS Safari: only <video> can go native FS via webkitEnterFullscreen
   * 3) Fallback: CSS webpage fullscreen (kz-web-fs) — works when FS API is missing
   */
  async function togglePlayerFs() {
    const shell = shellRef.current
    const video = videoRef.current
    if (!shell) return

    // Already in CSS webpage FS → exit that first if user hits 「全屏」
    if (webFs && !isShellFullscreen(shell) && !isIosVideoFullscreen(video)) {
      setWebFs(false)
      // continue into enter path below
    }

    // Exit if already in any "true" fullscreen
    if (isShellFullscreen(shell) || isIosVideoFullscreen(video)) {
      try {
        await exitDomFullscreen()
      } catch {
        /* ignore */
      }
      exitIosVideoFullscreen(video)
      setPlayerFs(false)
      return
    }

    setWebFs(false)

    // Prefer DOM Fullscreen on shell when available (Chrome / desktop Safari / many iPads)
    if (canRequestDomFullscreen(shell)) {
      try {
        await exitDomFullscreen()
        await requestDomFullscreen(shell)
        setPlayerFs(true)
        return
      } catch (e) {
        console.warn('[player] shell fullscreen failed, trying fallbacks', e)
      }
    }

    // iPhone Safari: only video element supports native fullscreen
    if (canIosVideoFullscreen(video)) {
      try {
        enterIosVideoFullscreen(video!)
        // webkitbeginfullscreen will set playerFs; set optimistically
        setPlayerFs(true)
        return
      } catch (e) {
        console.warn('[player] iOS video fullscreen failed', e)
      }
    }

    // Last resort: CSS fill viewport (works without Fullscreen API)
    setWebFs(true)
  }

  /** Expand player to viewport via CSS (no Fullscreen API) */
  function toggleWebFs() {
    if (isShellFullscreen(shellRef.current) || isIosVideoFullscreen(videoRef.current)) {
      void exitAnyFs()
      return
    }
    void exitDomFullscreen()
    exitIosVideoFullscreen(videoRef.current)
    setWebFs((v) => !v)
  }

  async function exitAnyFs() {
    setWebFs(false)
    setPlayerFs(false)
    exitIosVideoFullscreen(videoRef.current)
    try {
      await exitDomFullscreen()
    } catch {
      /* ignore */
    }
  }

  /** F key / double-click: toggle fullscreen (with iOS / CSS fallbacks) */
  function toggleFs() {
    if (
      webFs ||
      isShellFullscreen(shellRef.current) ||
      isIosVideoFullscreen(videoRef.current)
    ) {
      void exitAnyFs()
    } else {
      void togglePlayerFs()
    }
  }
  toggleFsRef.current = toggleFs

  function seekRatio(ratio: number) {
    const v = videoRef.current
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return
    const target = Math.max(0, Math.min(v.duration, ratio * v.duration))
    // Progressive MP4 (anime1 etc.) must re-Range from CDN via proxy — expect 0.5–2s lag.
    // Scrubbing without waiting for keyframes looks "stuck" until data arrives.
    setSeekingUi(true)
    isSeekingRef.current = true
    try {
      v.currentTime = target
    } catch {
      setSeekingUi(false)
      isSeekingRef.current = false
    }
    // If already buffered at target, clear UI on next frame
    try {
      for (let i = 0; i < v.buffered.length; i++) {
        if (target >= v.buffered.start(i) && target <= v.buffered.end(i) - 0.15) {
          requestAnimationFrame(() => {
            setSeekingUi(false)
            isSeekingRef.current = false
          })
          break
        }
      }
    } catch {
      /* ignore */
    }
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

  const srMode = (player.superResolution || 'off') as SuperResolutionMode
  const shellClass = [
    'kz-player-shell',
    webFs ? 'kz-web-fs' : '',
    !webFs && embedded ? 'absolute inset-0' : '',
    !webFs && !embedded
      ? 'kz-player-frame relative rounded-2xl border border-zinc-800'
      : '',
    srActive ? 'kz-sr-on' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={shellRef}
      className={shellClass}
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

      {/*
        Anime4K output. Keep in layout when mode≠off (display:none collapses size
        and breaks sizing). Hide picture with opacity until pipeline is live so
        we don't flash a black canvas over the video.
      */}
      <canvas
        ref={canvasRef}
        className="kz-sr-canvas"
        aria-hidden={srMode === 'off' || !srActive}
        style={{
          display: srMode === 'off' ? 'none' : 'block',
          opacity: srActive ? 1 : 0,
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
          zIndex: 2,
          pointerEvents: 'none',
          background: 'transparent',
          overflow: 'hidden',
        }}
      />

      {(loading || seekingUi) && !mediaError && (
        <div className="kz-status-layer">
          <div className="kz-status-hint">
            {loading ? '加载视频中…' : '跳转中…'}
          </div>
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
      {paused && !loading && !seekingUi && !mediaError && (
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
        className={`kz-bar ${showBar || paused || panelOpen || srMenuOpen || speedMenuOpen ? 'kz-bar--show' : ''}`}
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
            aria-label="上一集"
          >
            ⏮
          </button>
          <button
            type="button"
            className="kz-ctrl"
            onClick={() => onNext?.()}
            title="下一集 (N)"
            aria-label="下一集"
          >
            ⏭
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
              className="kz-ctrl kz-ctrl-icon"
              data-active={panelOpen}
              onClick={() => {
                setSpeedMenuOpen(false)
                setSrMenuOpen(false)
                setPanelOpen((v) => !v)
              }}
              title="弹幕设置 (Alt+M)"
              aria-label="设置"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                {/* simple gear */}
                <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.15 7.15 0 0 0-1.63-.94l-.36-2.54A.48.48 0 0 0 14 2h-4a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.49.49 0 0 0-.59.22L2.25 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.37 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.39.3.59.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.05.24.25.41.48.41h4c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
              </svg>
            </button>
          )}
          <div className="kz-speed-wrap">
            <button
              type="button"
              className="kz-ctrl"
              onClick={() => {
                setPanelOpen(false)
                setSrMenuOpen(false)
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
          <div className="kz-speed-wrap">
            <button
              type="button"
              className="kz-ctrl"
              data-active={srMode !== 'off' && srActive}
              onClick={() => {
                setPanelOpen(false)
                setSpeedMenuOpen(false)
                setSrMenuOpen((v) => !v)
              }}
              title={
                webGpuOk === false
                  ? typeof window !== 'undefined' &&
                    !window.isSecureContext
                    ? '超分需要安全上下文（HTTPS 或 localhost）。当前为 HTTP 远程访问，WebGPU 不可用'
                    : '当前浏览器不支持 WebGPU 超分'
                  : srMode === 'off'
                    ? '超分（Anime4K，默认关；需 WebGPU）'
                    : `超分：${SUPER_RESOLUTION_LABELS[srMode]}${
                        srActive ? '' : '（启动中…）'
                      }`
              }
            >
              {srMode === 'off'
                ? '超分'
                : SUPER_RESOLUTION_LABELS[srMode]}
            </button>
            {srMenuOpen && (
              <div className="kz-speed-menu">
                {webGpuOk === false && (
                  <div
                    className="px-2 py-1.5 text-[11px] leading-snug text-amber-200/90"
                    style={{ maxWidth: '11rem' }}
                  >
                    {typeof window !== 'undefined' && !window.isSecureContext
                      ? 'WebGPU 需 HTTPS 或 localhost；用局域网 IP 的 HTTP 访问时不可用'
                      : '当前环境无 WebGPU，超分无法启用'}
                  </div>
                )}
                {(
                  [
                    'off',
                    'efficiency',
                    'quality',
                  ] as SuperResolutionMode[]
                ).map((m) => (
                  <button
                    key={m}
                    type="button"
                    data-active={srMode === m}
                    disabled={m !== 'off' && webGpuOk === false}
                    onClick={() => {
                      onPlayerChange?.({ superResolution: m })
                      setSrMenuOpen(false)
                    }}
                  >
                    {SUPER_RESOLUTION_LABELS[m]}
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
            data-active={playerFs || webFs}
            onClick={() => void togglePlayerFs()}
            title="全屏（iPhone 为系统视频全屏；其它环境为播放器/网页全屏）"
          >
            {playerFs || webFs ? '退出' : '全屏'}
          </button>
          <button
            type="button"
            className="kz-ctrl kz-ctrl-web-fs"
            data-active={webFs}
            onClick={toggleWebFs}
            title="网页全屏（铺满视口；iOS 上可作无 API 时的替代）"
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
