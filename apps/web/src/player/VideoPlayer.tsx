/**
 * Native <video> + hls.js player (no Plyr / DPlayer).
 * Plyr fought MSE (black screen while .ts still 200). This path matches
 * what worked with DPlayer: attach HLS to a real video element and paint it full-size.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react'
import './plyr-overrides.css'
import Danmaku from '@ironkinoko/danmaku'
import type { Comment as IronComment } from '@ironkinoko/danmaku'
/** Instance type only — runtime constructor is dynamic-imported for m3u8 */
import type Hls from 'hls.js'
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
  /**
   * Unrecoverable media failure (e.g. direct CDN CORS / hotlink block).
   * Parent may switch to proxyUrl and remount. Called at most once per src.
   */
  onMediaLoadFailed?: (info: {
    position: number
    reason: string
  }) => void
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

/** Bilibili-style stroke (four-direction 1px black edge). */
const BILI_DANMAKU_SHADOW =
  '1px 0 1px #000, 0 1px 1px #000, 0 -1px 1px #000, -1px 0 1px #000'

/**
 * Base size ~B 站默认 25px at a mid-size player; user fontSize is a multiplier.
 * Small / phone windowed players scale down so 25px doesn't dominate the frame.
 */
const BILI_DANMAKU_BASE_PX = 25
/** Player width at which base 25px is used (≈ tablet / small desktop player). */
const DANMAKU_REF_WIDTH = 720
const DANMAKU_MIN_SCALE = 0.48 // ~12px @ default multiplier
const DANMAKU_MAX_SCALE = 1.1

function danmakuFontScale(containerWidth: number): number {
  if (!(containerWidth > 0)) return 1
  return Math.min(
    DANMAKU_MAX_SCALE,
    Math.max(DANMAKU_MIN_SCALE, containerWidth / DANMAKU_REF_WIDTH),
  )
}

function toIronComments(
  comments: DanmakuComment[],
  settings: DanmakuSettings,
  containerWidth = 0,
): IronComment[] {
  const scale = danmakuFontScale(containerWidth)
  const fontSize = `${Math.round(
    BILI_DANMAKU_BASE_PX * scale * (settings.fontSize || 1),
  )}px`
  return filterComments(comments, settings)
    .map((c) => ({
      time: c.time + (settings.timeOffset || 0),
      mode: c.mode || 'rtl',
      text: c.text,
      // Font family / weight also set in CSS (.kz-danmaku-layer .danmaku);
      // inline keeps per-comment color/size and stroke reliable under assign.
      style: {
        color: c.style?.color || '#ffffff',
        fontSize,
        fontFamily:
          "SimHei, 'Microsoft YaHei', 'Microsoft JhengHei', Arial, Helvetica, sans-serif",
        fontWeight: '700',
        lineHeight: '1.3',
        textShadow: BILI_DANMAKU_SHADOW,
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

/** Seconds of media buffered ahead of currentTime (0 if none). */
function bufferedAhead(video: HTMLVideoElement): number {
  const t = video.currentTime || 0
  try {
    const ranges = video.buffered
    for (let i = 0; i < ranges.length; i++) {
      const start = ranges.start(i)
      const end = ranges.end(i)
      if (t + 0.05 >= start && t <= end + 0.05) {
        return Math.max(0, end - t)
      }
    }
  } catch {
    /* ignore */
  }
  return 0
}

/** Min buffer before first play — reduces weak-net audio-before-picture. */
const MIN_START_BUFFER_SEC = 2.2
/** After rebuffer pause, wait for this much ahead before resume. */
const MIN_RESUME_BUFFER_SEC = 2.8
/** Don't stall forever on empty CDN; start anyway after this. */
const MAX_START_WAIT_MS = 14_000

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
  onMediaLoadFailed,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const danmakuCoreRef = useRef<Danmaku | null>(null)
  /** Last player width used for danmaku font scale (reload only on meaningful change). */
  const lastDanmakuWidthRef = useRef(0)
  const anime4kStopRef = useRef<Anime4KStop | null>(null)
  const genRef = useRef(0)
  const lastSaveRef = useRef(0)
  const skipBusyRef = useRef(false)
  const isSeekingRef = useRef(false)
  const resumedRef = useRef(false)
  /** User intentionally paused — do not auto-resume after rebuffer. */
  const userPausedRef = useRef(false)
  /** We paused because buffer emptied (weak net); resume when ahead is enough. */
  const bufferGatePausedRef = useRef(false)

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
  const onMediaLoadFailedRef = useRef(onMediaLoadFailed)
  const loadFailedOnceRef = useRef(false)
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
  /**
   * True while seeking or rebuffering (waiting for network).
   * Distinct copy: 跳转中… vs 缓冲中…
   */
  const [seekingUi, setSeekingUi] = useState(false)
  const [bufferingUi, setBufferingUi] = useState(false)
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
  onMediaLoadFailedRef.current = onMediaLoadFailed
  initialTimeRef.current = initialTime

  function reportLoadFailed(reason: string) {
    if (loadFailedOnceRef.current) return
    loadFailedOnceRef.current = true
    const pos = videoRef.current?.currentTime || 0
    onMediaLoadFailedRef.current?.({ position: pos, reason })
  }

  function applyDanmaku() {
    const video = videoRef.current
    const layer = layerRef.current
    if (!video || !layer) return
    const dm = danmakuRef.current
    // Prefer shell width (player frame); fall back to layer / video box.
    const w =
      shellRef.current?.clientWidth ||
      layer.clientWidth ||
      video.clientWidth ||
      0
    const iron = toIronComments(commentsRef.current, dm, w)
    lastDanmakuWidthRef.current = w
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
    const videoEl = videoRef.current
    if (!videoEl || !src) return
    // Local non-null alias — nested cleanups must not see `HTMLVideoElement | null`
    const video: HTMLVideoElement = videoEl

    const gen = ++genRef.current
    const alive = () => genRef.current === gen

    resumedRef.current = false
    skipBusyRef.current = false
    authRetryRef.current = false
    loadFailedOnceRef.current = false
    userPausedRef.current = false
    bufferGatePausedRef.current = false
    setMediaError('')
    setLoading(true)
    setSeekingUi(false)
    setBufferingUi(false)
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

    /** Clean up softPlay waiters on src change / unmount */
    let softPlayCleanup: (() => void) | null = null

    /**
     * Start playback only after enough buffered data (or timeout).
     * MANIFEST_PARSED / loadedmetadata alone often fire before video frames
     * are ready on weak nets → audio plays while picture freezes.
     */
    const softPlay = () => {
      if (!alive()) return
      if (!cfg.autoplay) {
        setLoading(false)
        setBufferingUi(false)
        setPaused(true)
        userPausedRef.current = true
        return
      }
      userPausedRef.current = false
      bufferGatePausedRef.current = false
      setBufferingUi(true)
      setLoading(true)

      const startedAt = Date.now()
      let settled = false

      const tryStart = () => {
        if (!alive() || settled) return
        const ahead = bufferedAhead(video)
        const waited = Date.now() - startedAt
        // Prefer real buffered seconds; HAVE_FUTURE_DATA alone is too early on weak net
        const readyEnough =
          ahead >= MIN_START_BUFFER_SEC ||
          (ahead >= 1.2 &&
            video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) ||
          waited >= MAX_START_WAIT_MS
        if (!readyEnough) return

        settled = true
        cleanupWaiters()
        // Read volume/speed from live ref — user may have changed them while loading
        const live = playerRef.current
        const vol = live.volume ?? 0.7
        video.playbackRate = live.speed || 1
        video.muted = true
        video
          .play()
          .then(() => {
            if (!alive()) return
            video.muted = false
            // Re-read after await: volume may change during muted autoplay
            video.volume = playerRef.current.volume ?? 0.7
            video.playbackRate = playerRef.current.speed || 1
            setPaused(false)
            setLoading(false)
            setBufferingUi(false)
          })
          .catch(() => {
            if (!alive()) return
            video.muted = false
            video.volume = playerRef.current.volume ?? 0.7
            setPaused(true)
            setLoading(false)
            setBufferingUi(false)
            userPausedRef.current = true
          })
      }

      const onProgress = () => tryStart()
      const onCanPlayThrough = () => tryStart()
      const onPlaying = () => {
        if (!alive()) return
        setLoading(false)
        setBufferingUi(false)
      }
      const poll = window.setInterval(tryStart, 200)
      const hardTimeout = window.setTimeout(tryStart, MAX_START_WAIT_MS)

      function cleanupWaiters() {
        window.clearInterval(poll)
        window.clearTimeout(hardTimeout)
        video.removeEventListener('progress', onProgress)
        video.removeEventListener('canplay', onProgress)
        video.removeEventListener('canplaythrough', onCanPlayThrough)
        video.removeEventListener('loadeddata', onProgress)
        video.removeEventListener('playing', onPlaying)
        if (softPlayCleanup === cleanupWaiters) softPlayCleanup = null
      }

      softPlayCleanup = cleanupWaiters
      video.addEventListener('progress', onProgress)
      video.addEventListener('canplay', onProgress)
      video.addEventListener('canplaythrough', onCanPlayThrough)
      video.addEventListener('loadeddata', onProgress)
      video.addEventListener('playing', onPlaying)
      // First probe immediately (may already have data)
      tryStart()
    }

    const onReady = () => {
      if (!alive()) return
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
      // Wait for buffer gate then play; attach danmaku after a frame
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

    /** Progressive mp4 path (sync). HLS path is async after dynamic import. */
    const attachProgressive = () => {
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
          const reason = video.error?.code
            ? `video_error_${video.error.code}`
            : 'video_load_failed'
          // Direct CDN (CORS / hotlink) → parent may switch to proxy
          if (!src.includes('/api/media/proxy')) {
            setMediaError('直链失败，尝试代理…')
            reportLoadFailed(reason)
            return
          }
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

    if (isM3u8(src)) {
      // Prefer MSE hls.js; fall back to Safari native HLS
      void import('hls.js')
        .then((mod) => {
          if (!alive()) return
          const HlsCtor = mod.default
          if (HlsCtor.isSupported()) {
            const hls = new HlsCtor({
              enableWorker: true,
              // Leaner defaults: less RAM / pre-fetch via proxy; still enough for weak links
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
              maxBufferHole: 0.5,
              startLevel: -1,
              abrEwmaDefaultEstimate: 500_000,
              maxBufferSize: 40 * 1000 * 1000,
              fragLoadingTimeOut: 20_000,
              manifestLoadingTimeOut: 15_000,
            })
            hlsRef.current = hls
            hls.loadSource(src)
            hls.attachMedia(video)
            hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
              if (!alive()) return
              console.info('[player] manifest ok')
              onReady()
            })
            hls.on(HlsCtor.Events.ERROR, (_e, data) => {
              if (!alive()) return
              if (!data.fatal) {
                if (
                  data.details === HlsCtor.ErrorDetails.BUFFER_STALLED_ERROR ||
                  data.details === HlsCtor.ErrorDetails.BUFFER_SEEK_OVER_HOLE
                ) {
                  setBufferingUi(true)
                }
                return
              }
              console.error('[player] hls fatal', data.type, data.details)
              // Direct CDN often fails CORS; let parent fall back to proxy
              const direct = !src.includes('/api/media/proxy')
              if (direct && data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
                setLoading(false)
                setBufferingUi(false)
                setMediaError('直链失败，尝试代理…')
                reportLoadFailed(String(data.details || 'hls_network'))
                return
              }
              if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
                setMediaError(`网络错误 ${data.details || ''}，重试…`)
                setBufferingUi(true)
                hls.startLoad()
              } else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
                setMediaError(`解码错误 ${data.details || ''}，恢复…`)
                hls.recoverMediaError()
              } else {
                setLoading(false)
                setBufferingUi(false)
                setMediaError(`播放失败: ${data.details || data.type}`)
                if (direct) reportLoadFailed(String(data.details || data.type))
              }
            })
            return
          }
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = src
            video.addEventListener('loadedmetadata', onReady, { once: true })
            video.addEventListener(
              'error',
              () => {
                if (!alive()) return
                setLoading(false)
                setMediaError('原生 HLS 加载失败')
                if (!src.includes('/api/media/proxy')) {
                  reportLoadFailed('native_hls')
                }
              },
              { once: true },
            )
            return
          }
          setLoading(false)
          setMediaError('当前浏览器不支持 HLS')
        })
        .catch((e) => {
          if (!alive()) return
          console.error('[player] hls import failed', e)
          setLoading(false)
          setMediaError('加载播放器失败')
        })
    } else {
      attachProgressive()
    }

    const onTime = () => {
      const d = video.duration
      const t = video.currentTime
      setCurrent(t)
      if (Number.isFinite(d) && d > 0) setDuration(d)

      if (!Number.isFinite(d) || d <= 0) return
      const now = Date.now()
      // Progress → history; store also debounces localStorage (~12s)
      if (now - lastSaveRef.current >= 10_000) {
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
      // If play resumed for any reason, clear buffer-gate flag when ahead is OK
      if (bufferedAhead(video) >= 0.5) {
        bufferGatePausedRef.current = false
        setBufferingUi(false)
      }
      bumpBar()
    }
    const onEndedHandler = () => {
      userPausedRef.current = false
      bufferGatePausedRef.current = false
      setBufferingUi(false)
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

    /**
     * Weak-net rebuffer: when decoder starves, pause so audio doesn't run ahead
     * of frozen frames; resume once we have MIN_RESUME_BUFFER_SEC ahead.
     */
    let resumePoll = 0
    const clearResumePoll = () => {
      if (resumePoll) {
        window.clearInterval(resumePoll)
        resumePoll = 0
      }
    }
    const tryResumeFromBuffer = () => {
      if (!alive()) {
        clearResumePoll()
        return
      }
      if (userPausedRef.current) {
        clearResumePoll()
        setBufferingUi(false)
        return
      }
      const ahead = bufferedAhead(video)
      if (
        ahead >= MIN_RESUME_BUFFER_SEC ||
        video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA
      ) {
        clearResumePoll()
        bufferGatePausedRef.current = false
        setBufferingUi(false)
        if (video.paused) {
          void video.play().catch(() => {
            /* autoplay / user gesture */
          })
        }
      }
    }
    const onWaiting = () => {
      // Network rebuffer (HLS + progressive via proxy)
      if (userPausedRef.current) return
      setBufferingUi(true)
      const ahead = bufferedAhead(video)
      // If almost empty and still "playing", force pause so A/V don't desync
      if (!video.paused && ahead < 0.35) {
        bufferGatePausedRef.current = true
        try {
          video.pause()
        } catch {
          /* ignore */
        }
      }
      if (!resumePoll) {
        resumePoll = window.setInterval(tryResumeFromBuffer, 250)
      }
    }
    const onStalledPlay = () => {
      if (userPausedRef.current) return
      setBufferingUi(true)
      if (!resumePoll) {
        resumePoll = window.setInterval(tryResumeFromBuffer, 250)
      }
    }
    const onCanPlay = () => {
      setSeekingUi(false)
      isSeekingRef.current = false
      tryResumeFromBuffer()
    }
    const onPlayingClear = () => {
      if (bufferedAhead(video) >= 0.3) {
        bufferGatePausedRef.current = false
        setBufferingUi(false)
        setSeekingUi(false)
        isSeekingRef.current = false
        clearResumePoll()
      }
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
    video.addEventListener('stalled', onStalledPlay)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('playing', onPlayingClear)
    video.addEventListener('progress', tryResumeFromBuffer)

    const ro = new ResizeObserver(() => {
      try {
        const w = shellRef.current?.clientWidth || 0
        // Font scale is width-based; re-apply when scale bucket would change
        // (≈ 24px width step at ref 720), not every pixel.
        const prev = lastDanmakuWidthRef.current
        const scaleChanged =
          w > 0 &&
          (prev <= 0 ||
            Math.abs(danmakuFontScale(w) - danmakuFontScale(prev)) >= 0.02)
        if (scaleChanged && danmakuCoreRef.current) {
          applyDanmaku()
        } else {
          danmakuCoreRef.current?.resize()
        }
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
        if (v.paused) {
          userPausedRef.current = false
          bufferGatePausedRef.current = false
          void v.play().catch(() => {
            userPausedRef.current = true
          })
        } else {
          userPausedRef.current = true
          bufferGatePausedRef.current = false
          setBufferingUi(false)
          v.pause()
        }
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
      // Invalidate generation so softPlay / HLS / auth async paths no-op
      genRef.current++
      window.removeEventListener('keydown', onKey)
      ro.disconnect()
      try {
        softPlayCleanup?.()
      } catch {
        /* ignore */
      }
      softPlayCleanup = null
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('ended', onEndedHandler)
      video.removeEventListener('volumechange', onVol)
      video.removeEventListener('ratechange', onRate)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('stalled', onStalledPlay)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('playing', onPlayingClear)
      video.removeEventListener('progress', tryResumeFromBuffer)
      clearResumePoll()
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

  function flashSrHint(msg: string, ms = 4500) {
    setOffsetHint(msg)
    window.clearTimeout(offsetHintTimer.current)
    offsetHintTimer.current = window.setTimeout(() => setOffsetHint(''), ms)
  }

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

    const unsupportedReason = (): string => {
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        return '超分需要 HTTPS 或 localhost（当前 HTTP 远程访问无 WebGPU）'
      }
      return '当前浏览器 / 环境不支持 WebGPU 超分'
    }

    const run = async () => {
      try {
        // Always re-probe if not confirmed true — localStorage may have mode on
        // while first paint had no gpu (e.g. insecure context).
        let ok = webGpuOk === true
        if (!ok) {
          ok = await supportsAnime4K()
          if (cancelled) return
          setWebGpuOk(ok)
        }
        if (!ok) {
          setSrActive(false)
          flashSrHint(unsupportedReason())
          return
        }

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
            // Don't hang forever if metadata never arrives
            window.setTimeout(done, 12_000)
          })
        }
        if (cancelled) return
        if (!(video.videoWidth > 0)) {
          flashSrHint('超分等待视频尺寸超时，请等画面出来后再开')
          setSrActive(false)
          return
        }

        try {
          anime4kStopRef.current?.()
        } catch {
          /* ignore */
        }
        anime4kStopRef.current = null

        flashSrHint(
          mode === 'quality' ? '超分：质量档启动中…' : '超分：效率档启动中…',
          2000,
        )

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
        flashSrHint(
          mode === 'quality' ? '超分已开启（质量）' : '超分已开启（效率）',
          2200,
        )
      } catch (e) {
        console.warn('[player] Anime4K failed', e)
        if (!cancelled) {
          setSrActive(false)
          flashSrHint(
            e instanceof Error
              ? `超分启动失败：${e.message}`
              : '超分启动失败（见控制台）',
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
    // Do not depend on playerFs/webFs — fullscreen must not tear down WebGPU
    // (black frame while pipeline rebuilds). Layout uses ResizeObserver inside startAnime4K.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- webGpuOk set inside after probe
  }, [src, player.superResolution])

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      userPausedRef.current = false
      bufferGatePausedRef.current = false
      // Prefer waiting for a small buffer if empty (manual play after lag)
      if (bufferedAhead(v) < 0.5 && v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        setBufferingUi(true)
      }
      void v.play().catch(() => {
        userPausedRef.current = true
      })
    } else {
      userPausedRef.current = true
      bufferGatePausedRef.current = false
      setBufferingUi(false)
      v.pause()
    }
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

      {(loading || seekingUi || bufferingUi) && !mediaError && (
        <div className="kz-status-layer">
          <div className="kz-status-hint">
            {loading
              ? '加载视频中…'
              : seekingUi
                ? '跳转中…'
                : '缓冲中…'}
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
      {paused && !loading && !seekingUi && !bufferingUi && !mediaError && (
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
          <button
            type="button"
            className="kz-ctrl kz-ctrl-icon"
            onClick={togglePlay}
            title={paused ? '播放' : '暂停'}
            aria-label={paused ? '播放' : '暂停'}
          >
            {paused ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7L8 5z" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M7 5h3v14H7V5zm7 0h3v14h-3V5z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="kz-ctrl kz-ctrl-icon"
            onClick={() => onPrev?.()}
            title="上一集 (P)"
            aria-label="上一集"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z" />
            </svg>
          </button>
          <button
            type="button"
            className="kz-ctrl kz-ctrl-icon"
            onClick={() => onNext?.()}
            title="下一集 (N)"
            aria-label="下一集"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16 6h2v12h-2V6zM6 6v12l8.5-6L6 6z" />
            </svg>
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
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
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
              data-active={srMode !== 'off'}
              onClick={() => {
                setPanelOpen(false)
                setSpeedMenuOpen(false)
                setSrMenuOpen((v) => !v)
              }}
              title={
                webGpuOk === false
                  ? typeof window !== 'undefined' && !window.isSecureContext
                    ? '超分需要安全上下文（HTTPS 或 localhost）。当前为 HTTP 远程访问，WebGPU 不可用'
                    : '当前浏览器不支持 WebGPU 超分'
                  : srMode === 'off'
                    ? '超分（Anime4K，默认关；需 WebGPU）'
                    : `超分：${SUPER_RESOLUTION_LABELS[srMode]}${
                        srActive ? ' · 已生效' : ' · 启动中…'
                      }`
              }
            >
              {srMode === 'off'
                ? '超分'
                : `${SUPER_RESOLUTION_LABELS[srMode]}${srActive ? '' : '…'}`}
            </button>
            {srMenuOpen && (
              <div className="kz-speed-menu">
                {webGpuOk === false && (
                  <div
                    className="px-2 py-1.5 text-[11px] leading-snug text-amber-200/90"
                    style={{ maxWidth: '12rem' }}
                  >
                    {typeof window !== 'undefined' && !window.isSecureContext
                      ? 'WebGPU 需 HTTPS 或 localhost；用局域网 IP 的 HTTP 访问时不可用'
                      : '当前环境无 WebGPU，选档会提示失败'}
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
                    onClick={() => {
                      // Always update preference so button / settings reflect choice.
                      // Start effect shows toast if WebGPU unavailable.
                      onPlayerChange?.({ superResolution: m })
                      setSrMenuOpen(false)
                      if (m === 'off') {
                        flashSrHint('超分已关闭', 1600)
                      }
                    }}
                  >
                    {SUPER_RESOLUTION_LABELS[m]}
                    {m === srMode && srActive && m !== 'off' ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="kz-vol-wrap">
            <div className="kz-vol-rail" aria-hidden>
              <div
                className="kz-vol-fill"
                style={{
                  width: `${Math.round((player.volume ?? 0.7) * 100)}%`,
                }}
              />
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
              aria-label="音量"
            />
          </div>
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
