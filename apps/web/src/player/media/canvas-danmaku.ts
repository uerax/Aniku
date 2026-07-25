/**
 * Canvas danmaku engine — media-time driven, constant px/s, single layer.
 *
 * Why not @ironkinoko/danmaku DOM+CSS transition:
 * - In-flight X was wall-clock; video stalls → parallax nausea
 * - duration = stageW/speed made long lines faster than short ones
 * - Per-node text-shadow was expensive under density
 *
 * Here every frame: x = f(video.currentTime). Pause/hitch freezes text with picture.
 * Scroll duration = (stageW + textW) / speed → uniform visual velocity.
 */
import type { DanmakuComment, DanmakuMode, DanmakuSettings } from '@aniku/shared'
import {
  danmakuFontScale,
  danmakuPixelSpeed,
  filterComments,
} from './danmaku-utils'

const BILI_BASE_PX = 25
const REF_WIDTH = 720
/** Soft cap concurrent draws — density budget, not collision alone */
const MAX_RUNNING = 80
/** Top/bottom static hold (seconds), clamped */
const STATIC_MIN_S = 4
const STATIC_MAX_S = 6
/** Gap between successive scroll comments on same lane (px) */
const LANE_GAP_PX = 24

export type CanvasDanmakuOptions = {
  container: HTMLElement
  media: HTMLMediaElement
  comments: DanmakuComment[]
  settings: DanmakuSettings
  /** Container CSS width hint for font/speed (updated on resize) */
  width?: number
}

type Prepared = {
  time: number
  mode: DanmakuMode
  text: string
  color: string
  /** Measured text width at current font */
  width: number
  height: number
  /** Scroll: seconds to cross (W + textW) / speed. Static: hold duration. */
  duration: number
}

type Running = Prepared & {
  /** Lane top (scroll/top) or bottom offset (bottom mode) */
  y: number
  /** Binary-search index into prepared list when spawned */
  idx: number
}

function parseColor(c?: string): string {
  if (!c) return '#ffffff'
  const s = c.trim()
  if (!s) return '#ffffff'
  if (s.startsWith('#')) return s
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    if (!Number.isFinite(n)) return '#ffffff'
    return `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`
  }
  return s
}

export class CanvasDanmaku {
  private container: HTMLElement
  private media: HTMLMediaElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private prepared: Prepared[] = []
  private running: Running[] = []
  /** Next index in prepared to consider for spawn */
  private cursor = 0
  private raf = 0
  private visible = true
  private destroyed = false
  private dpr = 1
  private cssW = 0
  private cssH = 0
  private fontPx = 25
  private font = '700 25px sans-serif'
  private speedPx = 130
  private _opacity = 0.85
  private area = 0.5
  private settings: DanmakuSettings
  /** Lane free-at media time (scroll). Key = lane index */
  private scrollLaneFree: number[] = []
  private topLaneFree: number[] = []
  private bottomLaneFree: number[] = []
  private laneH = 28
  private onPlay: () => void
  private onPause: () => void
  private onSeeked: () => void
  private onRate: () => void
  private onSize: ResizeObserver

  constructor(opts: CanvasDanmakuOptions) {
    this.container = opts.container
    this.media = opts.media
    this.settings = opts.settings
    this._opacity = opts.settings.opacity ?? 0.85
    this.area = Math.min(1, Math.max(0.15, opts.settings.area || 0.5))

    const canvas = document.createElement('canvas')
    canvas.className = 'kz-danmaku-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    Object.assign(canvas.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '0',
      display: 'block',
    } as CSSStyleDeclaration)
    this.canvas = canvas
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) throw new Error('CanvasDanmaku: 2d context unavailable')
    this.ctx = ctx
    this.container.appendChild(canvas)

    this.onPlay = () => this.ensureLoop()
    this.onPause = () => {
      // Stop rAF while paused — positions freeze via media.currentTime on next play/seek
      this.stopLoop()
      this.paint()
    }
    this.onSeeked = () => this.seek()
    this.onRate = () => {
      /* positions are media-time based; rate only affects how fast currentTime moves */
    }

    this.media.addEventListener('play', this.onPlay)
    this.media.addEventListener('pause', this.onPause)
    this.media.addEventListener('seeked', this.onSeeked)
    this.media.addEventListener('ratechange', this.onRate)

    this.onSize = new ResizeObserver(() => this.resize())
    this.onSize.observe(this.container)

    this.resize(opts.width)
    this.reload(opts.comments, opts.settings)
    if (!this.media.paused) this.ensureLoop()
    else this.paint()
  }

  get speed(): number {
    return this.speedPx
  }
  set speed(v: number) {
    if (!(v > 0) || !Number.isFinite(v)) return
    this.speedPx = v
    this.recomputeDurations()
  }

  /** Mirror ironkinoko API used by VideoPlayer */
  get opacity(): number {
    return this._opacity
  }
  set opacity(v: number) {
    if (!Number.isFinite(v)) return
    this._opacity = Math.min(1, Math.max(0, v))
  }

  get scrollAreaPercent(): number {
    return this.area
  }
  set scrollAreaPercent(v: number) {
    this.area = Math.min(1, Math.max(0.15, v || 0.5))
    this.initLanes()
    this.seek()
  }

  show(): this {
    this.visible = true
    this.canvas.style.visibility = 'visible'
    this.ensureLoop()
    this.paint()
    return this
  }

  hide(): this {
    this.visible = false
    this.canvas.style.visibility = 'hidden'
    this.running = []
    this.clearCanvas()
    return this
  }

  resize(widthHint?: number): this {
    if (this.destroyed) return this
    const cw = this.container.clientWidth || widthHint || 0
    const ch = this.container.clientHeight || 0
    if (cw <= 0 || ch <= 0) return this

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const sizeChanged =
      Math.abs(cw - this.cssW) > 0.5 ||
      Math.abs(ch - this.cssH) > 0.5 ||
      dpr !== this.dpr

    this.cssW = cw
    this.cssH = ch
    this.dpr = dpr

    if (sizeChanged) {
      this.canvas.width = Math.max(1, Math.floor(cw * dpr))
      this.canvas.height = Math.max(1, Math.floor(ch * dpr))
      this.canvas.style.width = `${cw}px`
      this.canvas.style.height = `${ch}px`
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const scale = danmakuFontScale(cw)
    this.fontPx = Math.round(
      BILI_BASE_PX * scale * (this.settings.fontSize || 1),
    )
    this.font = `700 ${this.fontPx}px SimHei, "Microsoft YaHei", "Microsoft JhengHei", Arial, Helvetica, sans-serif`
    this.laneH = Math.max(18, Math.ceil(this.fontPx * 1.35))
    this.speedPx = danmakuPixelSpeed(cw, this.settings.speed || 1)

    // Remeasure text widths at new font
    this.ctx.font = this.font
    for (const p of this.prepared) {
      p.width = Math.ceil(this.ctx.measureText(p.text).width)
      p.height = this.laneH
    }
    this.recomputeDurations()
    this.initLanes()
    // Keep progress continuous: re-seek from media time (no CSS restart jump)
    this.seek()
    return this
  }

  reload(comments: DanmakuComment[], settings?: DanmakuSettings): this {
    if (settings) {
      this.settings = settings
      this._opacity = settings.opacity ?? 0.85
      this.area = Math.min(1, Math.max(0.15, settings.area || 0.5))
      const scale = danmakuFontScale(this.cssW || REF_WIDTH)
      this.fontPx = Math.round(
        BILI_BASE_PX * scale * (settings.fontSize || 1),
      )
      this.font = `700 ${this.fontPx}px SimHei, "Microsoft YaHei", "Microsoft JhengHei", Arial, Helvetica, sans-serif`
      this.laneH = Math.max(18, Math.ceil(this.fontPx * 1.35))
      this.speedPx = danmakuPixelSpeed(
        this.cssW || REF_WIDTH,
        settings.speed || 1,
      )
    }

    const offset = this.settings.timeOffset || 0
    const filtered = filterComments(comments, this.settings)
    this.ctx.font = this.font
    this.prepared = filtered
      .map((c) => {
        const text = c.text || ''
        const width = Math.ceil(this.ctx.measureText(text).width) || 1
        const mode = c.mode || 'rtl'
        const p: Prepared = {
          time: c.time + offset,
          mode,
          text,
          color: parseColor(c.style?.color),
          width,
          height: this.laneH,
          duration: 0,
        }
        p.duration = this.durationFor(p)
        return p
      })
      .sort((a, b) => a.time - b.time)

    this.initLanes()
    this.seek()
    return this
  }

  /** Visual-only settings without rebuilding the comment list */
  applyVisual(settings: DanmakuSettings): this {
    this.settings = settings
    this._opacity = settings.opacity ?? 0.85
    const nextArea = Math.min(1, Math.max(0.15, settings.area || 0.5))
    const areaChanged = Math.abs(nextArea - this.area) > 0.001
    this.area = nextArea
    this.speedPx = danmakuPixelSpeed(
      this.cssW || REF_WIDTH,
      settings.speed || 1,
    )
    this.recomputeDurations()
    if (areaChanged) {
      this.initLanes()
      this.seek()
    }
    if (settings.enabled === false) this.hide()
    else this.show()
    return this
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stopLoop()
    this.media.removeEventListener('play', this.onPlay)
    this.media.removeEventListener('pause', this.onPause)
    this.media.removeEventListener('seeked', this.onSeeked)
    this.media.removeEventListener('ratechange', this.onRate)
    this.onSize.disconnect()
    this.running = []
    this.prepared = []
    try {
      this.canvas.remove()
    } catch {
      /* ignore */
    }
  }

  private durationFor(p: Prepared): number {
    if (p.mode === 'top' || p.mode === 'bottom') {
      return Math.min(
        STATIC_MAX_S,
        Math.max(STATIC_MIN_S, (this.cssW || REF_WIDTH) / this.speedPx),
      )
    }
    // Constant px/s across full path (stage + text)
    const path = (this.cssW || REF_WIDTH) + p.width
    return Math.max(0.5, path / Math.max(40, this.speedPx))
  }

  private recomputeDurations(): void {
    for (const p of this.prepared) p.duration = this.durationFor(p)
    for (const r of this.running) r.duration = this.durationFor(r)
  }

  private initLanes(): void {
    const h = this.cssH || 1
    const scrollH = h * this.area
    const nScroll = Math.max(1, Math.floor(scrollH / this.laneH))
    const nStatic = Math.max(1, Math.floor((h * 0.45) / this.laneH))
    this.scrollLaneFree = Array.from({ length: nScroll }, () => -1e9)
    this.topLaneFree = Array.from({ length: nStatic }, () => -1e9)
    this.bottomLaneFree = Array.from({ length: nStatic }, () => -1e9)
  }

  private seek(): void {
    this.running = []
    this.initLanes()
    const t = this.mediaTime()
    // Cursor: first comment that might still be on screen or upcoming
    let lo = 0
    let hi = this.prepared.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.prepared[mid].time < t - 30) lo = mid + 1
      else hi = mid
    }
    this.cursor = lo
    // Retroactively spawn anything still visible at t (without drawing history dump)
    while (this.cursor < this.prepared.length) {
      const p = this.prepared[this.cursor]
      if (p.time > t) break
      if (t - p.time <= p.duration) {
        this.trySpawn(p, this.cursor, t, true)
      }
      this.cursor++
    }
    this.paint()
    if (!this.media.paused && this.visible) this.ensureLoop()
  }

  private mediaTime(): number {
    const t = this.media.currentTime
    return Number.isFinite(t) ? t : 0
  }

  private ensureLoop(): void {
    if (this.destroyed || this.raf || !this.visible) return
    if (this.media.paused) {
      this.paint()
      return
    }
    const tick = () => {
      this.raf = 0
      if (this.destroyed || !this.visible) return
      this.tick()
      // Media-time driven: only pump frames while playing (saves CPU when paused)
      if (!this.destroyed && this.visible && !this.media.paused) {
        this.raf = requestAnimationFrame(tick)
      }
    }
    this.raf = requestAnimationFrame(tick)
  }

  private stopLoop(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
  }

  private tick(): void {
    const t = this.mediaTime()

    // Drop finished
    this.running = this.running.filter((r) => t - r.time < r.duration)

    // Spawn newly due comments
    while (this.cursor < this.prepared.length) {
      const p = this.prepared[this.cursor]
      if (p.time > t) break
      // Too late to show (jumped forward past duration)
      if (t - p.time > p.duration) {
        this.cursor++
        continue
      }
      if (this.running.length < MAX_RUNNING) {
        this.trySpawn(p, this.cursor, t, false)
      }
      this.cursor++
    }

    this.paint()
  }

  private trySpawn(
    p: Prepared,
    idx: number,
    now: number,
    retro: boolean,
  ): boolean {
    if (this.running.length >= MAX_RUNNING) return false

    if (p.mode === 'rtl') {
      const lanes = this.scrollLaneFree
      if (!lanes.length) return false
      const path = (this.cssW || REF_WIDTH) + p.width
      const pxPerSec = path / p.duration
      // Time until this comment's right edge clears the left of stage enough for next
      // Free when previous has traveled far enough that gap is LANE_GAP
      let chosen = -1
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] <= p.time) {
          chosen = i
          break
        }
      }
      if (chosen < 0) return false // no lane — drop (overlap false)
      // Reserve lane until this comment has advanced so a follower won't collide
      // Follower may start when lead's tail is LANE_GAP past the right edge entry.
      // Lead starts at x=W (rtl right edge of text at W). Tail clears spawn zone when
      // travel >= textW + gap → time += (textW + gap) / pxPerSec
      const clearIn = (p.width + LANE_GAP_PX) / Math.max(1, pxPerSec)
      lanes[chosen] = p.time + clearIn
      const y = chosen * this.laneH
      if (!retro || now - p.time < p.duration) {
        this.running.push({ ...p, y, idx })
      }
      return true
    }

    if (p.mode === 'top') {
      const lanes = this.topLaneFree
      let chosen = -1
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] <= p.time) {
          chosen = i
          break
        }
      }
      if (chosen < 0) return false
      lanes[chosen] = p.time + p.duration
      this.running.push({ ...p, y: chosen * this.laneH, idx })
      return true
    }

    if (p.mode === 'bottom') {
      const lanes = this.bottomLaneFree
      let chosen = -1
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] <= p.time) {
          chosen = i
          break
        }
      }
      if (chosen < 0) return false
      lanes[chosen] = p.time + p.duration
      this.running.push({ ...p, y: chosen * this.laneH, idx })
      return true
    }

    return false
  }

  private clearCanvas(): void {
    const { ctx, cssW, cssH } = this
    if (cssW <= 0 || cssH <= 0) return
    ctx.clearRect(0, 0, cssW, cssH)
  }

  private paint(): void {
    if (this.destroyed || !this.visible) return
    const { ctx, cssW, cssH } = this
    if (cssW <= 0 || cssH <= 0) return

    ctx.clearRect(0, 0, cssW, cssH)
    if (!this.running.length) return

    ctx.save()
    ctx.globalAlpha = this._opacity
    ctx.font = this.font
    ctx.textBaseline = 'top'
    // Light stroke (cheaper than 4-way DOM text-shadow, still readable)
    ctx.lineWidth = Math.max(2, this.fontPx * 0.12)
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'

    const t = this.mediaTime()
    const W = cssW

    for (const r of this.running) {
      const age = t - r.time
      if (age < 0 || age >= r.duration) continue

      ctx.fillStyle = r.color || '#ffffff'

      if (r.mode === 'rtl') {
        const path = W + r.width
        const x = W - (age / r.duration) * path
        const y = r.y + (this.laneH - this.fontPx) * 0.5
        ctx.strokeText(r.text, x, y)
        ctx.fillText(r.text, x, y)
      } else if (r.mode === 'top') {
        const x = (W - r.width) * 0.5
        const y = r.y + (this.laneH - this.fontPx) * 0.5
        ctx.strokeText(r.text, x, y)
        ctx.fillText(r.text, x, y)
      } else if (r.mode === 'bottom') {
        const x = (W - r.width) * 0.5
        const y =
          cssH - r.height - r.y + (this.laneH - this.fontPx) * 0.5
        ctx.strokeText(r.text, x, y)
        ctx.fillText(r.text, x, y)
      }
    }

    ctx.restore()
  }
}
