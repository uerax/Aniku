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
 *
 * Dense-desktop hot path (2026-07):
 * - Glyph atlas: stroke+fill once into offscreen, paint via drawImage
 * - Lazy measureText only on spawn / font change (not full list every reload paint)
 * - In-place running prune (no per-frame filter alloc)
 * - Desktop concurrent cap + DPR soft clamp under load
 */
import type { DanmakuComment, DanmakuMode, DanmakuSettings } from '@aniku/shared'
import {
  danmakuFontScale,
  danmakuPixelSpeed,
  filterComments,
  type DanmakuLayoutHints,
} from './danmaku-utils'

const BILI_BASE_PX = 25
const REF_WIDTH = 720
/** Soft cap concurrent draws — density budget, not collision alone */
const MAX_RUNNING = 80
/** Desktop default: slightly lower than absolute max; room for adaptive raise */
const MAX_RUNNING_DESKTOP = 64
/** Mobile fullscreen: fewer concurrent lines so small screens stay readable */
const MAX_RUNNING_MOBILE_FS = 48
/** Top/bottom static hold (seconds), clamped */
const STATIC_MIN_S = 4
const STATIC_MAX_S = 6
/** Gap between successive scroll comments on same lane (px) */
const LANE_GAP_PX = 24
/** Glyph cache entries before LRU-ish clear (font change clears anyway) */
const GLYPH_CACHE_MAX = 256
/** Pad around glyph so stroke does not clip */
const GLYPH_PAD = 4
/**
 * When stage CSS pixels exceed this, drop effective DPR toward 1 so we are not
 * filling ~4–8M px of transparent canvas every frame on 2×/3× desktop monitors.
 */
const DPR_SOFT_AREA = 1280 * 720

export type CanvasDanmakuOptions = {
  container: HTMLElement
  media: HTMLMediaElement
  comments: DanmakuComment[]
  settings: DanmakuSettings
  /** Container CSS width hint for font/speed (updated on resize) */
  width?: number
  /** Desktop vs mobile + fullscreen — drives font scale curve */
  layout?: DanmakuLayoutHints
}

type GlyphEntry = {
  canvas: HTMLCanvasElement | OffscreenCanvas
  /** CSS-pixel width of drawable text (not including pad) */
  textW: number
  /** Full bitmap css width / height including pad */
  bw: number
  bh: number
  /** Draw offset so text baseline matches previous stroke/fill coords */
  ox: number
  oy: number
}

type Prepared = {
  time: number
  mode: DanmakuMode
  text: string
  color: string
  /** Measured text width at current font; 0 = not measured yet */
  width: number
  height: number
  /** Scroll: seconds to cross (W + textW) / speed. Static: hold duration. */
  duration: number
  /** True after measureText for current font */
  measured: boolean
}

type Running = Prepared & {
  /** Lane top (scroll/top) or bottom offset (bottom mode) */
  y: number
  /** Binary-search index into prepared list when spawned */
  idx: number
  /** Cached glyph (null until first paint after spawn) */
  glyph: GlyphEntry | null
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

function makeOffscreen(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  const tw = Math.max(1, Math.ceil(w))
  const th = Math.max(1, Math.ceil(h))
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(tw, th)
    } catch {
      /* fall through */
    }
  }
  const c = document.createElement('canvas')
  c.width = tw
  c.height = th
  return c
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
  private layout: DanmakuLayoutHints = {}
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
  /** color|fontPx|text → pre-rasterized glyph */
  private glyphCache = new Map<string, GlyphEntry>()
  /** Scratch for measure-only (avoids thrashing main ctx state) */
  private measureCtx: CanvasRenderingContext2D | null = null

  constructor(opts: CanvasDanmakuOptions) {
    this.container = opts.container
    this.media = opts.media
    this.settings = opts.settings
    this.layout = opts.layout ? { ...opts.layout } : {}
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
    // desynchronized: lower latency compositing when browser supports it
    const ctx =
      canvas.getContext('2d', {
        alpha: true,
        desynchronized: true,
      } as CanvasRenderingContext2DSettings) ||
      canvas.getContext('2d', { alpha: true })
    if (!ctx) throw new Error('CanvasDanmaku: 2d context unavailable')
    this.ctx = ctx
    this.container.appendChild(canvas)

    const measureEl = document.createElement('canvas')
    measureEl.width = 1
    measureEl.height = 1
    this.measureCtx = measureEl.getContext('2d')

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

  /** Update desktop/mobile + fullscreen hints; triggers font recompute via resize. */
  setLayout(hints: DanmakuLayoutHints): this {
    const prev = this.layout
    const next: DanmakuLayoutHints = {
      mode: hints.mode ?? prev.mode,
      fullscreen: hints.fullscreen ?? prev.fullscreen,
      height: hints.height ?? prev.height,
    }
    const changed =
      prev.mode !== next.mode ||
      prev.fullscreen !== next.fullscreen ||
      Math.abs((prev.height || 0) - (next.height || 0)) > 0.5
    this.layout = next
    if (changed) this.resize()
    return this
  }

  private layoutHints(heightOverride?: number): DanmakuLayoutHints {
    return {
      mode: this.layout.mode,
      fullscreen: this.layout.fullscreen,
      height:
        heightOverride && heightOverride > 0
          ? heightOverride
          : this.layout.height || this.cssH || undefined,
    }
  }

  private maxRunning(): number {
    if (this.layout.mode === 'mobile' && this.layout.fullscreen) {
      return MAX_RUNNING_MOBILE_FS
    }
    // Mobile windowed: small stage already; keep full budget
    if (this.layout.mode === 'mobile') return MAX_RUNNING
    // Desktop: lane-aware soft cap — dense 1080p was hitting 80×strokeText/frame
    const lanes = this.scrollLaneFree.length || 1
    return Math.min(
      MAX_RUNNING,
      Math.max(48, Math.min(MAX_RUNNING_DESKTOP, lanes * 3)),
    )
  }

  /** Effective device pixel ratio — soft-clamp on large desktop stages. */
  private effectiveDpr(cw = this.cssW, ch = this.cssH): number {
    const raw = window.devicePixelRatio || 1
    if (this.layout.mode === 'mobile') return Math.min(raw, 2)
    const area = Math.max(1, cw) * Math.max(1, ch)
    if (area <= DPR_SOFT_AREA) return Math.min(raw, 2)
    // Large window: prefer ~1–1.5× so clear+blit stays cheap under dense text
    const scale = Math.sqrt(DPR_SOFT_AREA / area)
    return Math.min(2, Math.max(1, Math.min(raw, raw * scale)))
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
    this.running.length = 0
    this.clearCanvas()
    return this
  }

  resize(widthHint?: number): this {
    if (this.destroyed) return this
    const cw = this.container.clientWidth || widthHint || 0
    const ch = this.container.clientHeight || 0
    if (cw <= 0 || ch <= 0) return this

    const prevW = this.cssW
    const prevH = this.cssH
    const prevDpr = this.dpr
    const dprNow = this.effectiveDpr(cw, ch)
    const sizeChanged =
      Math.abs(cw - prevW) > 0.5 ||
      Math.abs(ch - prevH) > 0.5 ||
      Math.abs(dprNow - prevDpr) > 0.01

    this.cssW = cw
    this.cssH = ch
    this.layout = { ...this.layout, height: ch }
    this.dpr = dprNow

    if (sizeChanged) {
      this.canvas.width = Math.max(1, Math.floor(cw * dprNow))
      this.canvas.height = Math.max(1, Math.floor(ch * dprNow))
      this.canvas.style.width = `${cw}px`
      this.canvas.style.height = `${ch}px`
      this.ctx.setTransform(dprNow, 0, 0, dprNow, 0, 0)
      // Glyph bitmaps are rasterized at dpr — rebuild when backing store scale moves
      if (Math.abs(dprNow - prevDpr) > 0.01) this.clearGlyphCache()
    }

    const hints = this.layoutHints(ch)
    const scale = danmakuFontScale(cw, hints)
    const nextFontPx = Math.round(
      BILI_BASE_PX * scale * (this.settings.fontSize || 1),
    )
    const fontChanged = nextFontPx !== this.fontPx
    this.fontPx = nextFontPx
    this.font = `700 ${this.fontPx}px SimHei, "Microsoft YaHei", "Microsoft JhengHei", Arial, Helvetica, sans-serif`
    // Mobile fullscreen: tighter lane spacing so more tracks fit without huge glyphs
    const laneMult =
      this.layout.mode === 'mobile' && this.layout.fullscreen ? 1.22 : 1.35
    this.laneH = Math.max(16, Math.ceil(this.fontPx * laneMult))
    this.speedPx = danmakuPixelSpeed(cw, this.settings.speed || 1, hints)

    if (fontChanged) {
      this.clearGlyphCache()
      // Invalidate measurements; remeasure lazily on spawn
      for (const p of this.prepared) {
        p.measured = false
        p.width = 0
        p.height = this.laneH
        p.duration = 0
      }
    } else {
      for (const p of this.prepared) {
        p.height = this.laneH
      }
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
      const hints = this.layoutHints()
      const scale = danmakuFontScale(this.cssW || REF_WIDTH, hints)
      const nextFontPx = Math.round(
        BILI_BASE_PX * scale * (settings.fontSize || 1),
      )
      if (nextFontPx !== this.fontPx) this.clearGlyphCache()
      this.fontPx = nextFontPx
      this.font = `700 ${this.fontPx}px SimHei, "Microsoft YaHei", "Microsoft JhengHei", Arial, Helvetica, sans-serif`
      const laneMult =
        this.layout.mode === 'mobile' && this.layout.fullscreen ? 1.22 : 1.35
      this.laneH = Math.max(16, Math.ceil(this.fontPx * laneMult))
      this.speedPx = danmakuPixelSpeed(
        this.cssW || REF_WIDTH,
        settings.speed || 1,
        hints,
      )
    }

    const offset = this.settings.timeOffset || 0
    const filtered = filterComments(comments, this.settings)
    // Lazy width: measure only when spawning / computing duration for visible ones
    this.prepared = filtered
      .map((c) => {
        const text = c.text || ''
        const mode = c.mode || 'rtl'
        const p: Prepared = {
          time: c.time + offset,
          mode,
          text,
          color: parseColor(c.style?.color),
          width: 0,
          height: this.laneH,
          duration: 0,
          measured: false,
        }
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
      this.layoutHints(),
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
    this.running.length = 0
    this.prepared = []
    this.clearGlyphCache()
    try {
      this.canvas.remove()
    } catch {
      /* ignore */
    }
  }

  private ensureMeasured(p: Prepared): void {
    if (p.measured && p.width > 0) return
    const mctx = this.measureCtx || this.ctx
    mctx.font = this.font
    p.width = Math.ceil(mctx.measureText(p.text).width) || 1
    p.height = this.laneH
    p.measured = true
    p.duration = this.durationFor(p)
  }

  private durationFor(p: Prepared): number {
    if (p.mode === 'top' || p.mode === 'bottom') {
      return Math.min(
        STATIC_MAX_S,
        Math.max(STATIC_MIN_S, (this.cssW || REF_WIDTH) / this.speedPx),
      )
    }
    // Need width for constant px/s; estimate if not measured yet
    const tw = p.measured && p.width > 0 ? p.width : Math.max(40, p.text.length * this.fontPx * 0.6)
    const path = (this.cssW || REF_WIDTH) + tw
    return Math.max(0.5, path / Math.max(40, this.speedPx))
  }

  private recomputeDurations(): void {
    for (const p of this.prepared) {
      if (p.measured) p.duration = this.durationFor(p)
      else p.duration = 0
    }
    for (const r of this.running) {
      this.ensureMeasured(r)
      r.duration = this.durationFor(r)
    }
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
    this.running.length = 0
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
      this.ensureMeasured(p)
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

    // In-place drop finished (avoid filter() alloc every frame)
    const run = this.running
    let w = 0
    for (let i = 0; i < run.length; i++) {
      if (t - run[i].time < run[i].duration) {
        if (w !== i) run[w] = run[i]
        w++
      }
    }
    run.length = w

    // Spawn newly due comments
    const cap = this.maxRunning()
    while (this.cursor < this.prepared.length) {
      const p = this.prepared[this.cursor]
      if (p.time > t) break
      this.ensureMeasured(p)
      // Too late to show (jumped forward past duration)
      if (t - p.time > p.duration) {
        this.cursor++
        continue
      }
      if (run.length < cap) {
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
    if (this.running.length >= this.maxRunning()) return false
    this.ensureMeasured(p)

    if (p.mode === 'rtl') {
      const lanes = this.scrollLaneFree
      if (!lanes.length) return false
      const path = (this.cssW || REF_WIDTH) + p.width
      const pxPerSec = path / p.duration
      let chosen = -1
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] <= p.time) {
          chosen = i
          break
        }
      }
      if (chosen < 0) return false // no lane — drop (overlap false)
      const clearIn = (p.width + LANE_GAP_PX) / Math.max(1, pxPerSec)
      lanes[chosen] = p.time + clearIn
      const y = chosen * this.laneH
      if (!retro || now - p.time < p.duration) {
        this.running.push({ ...p, y, idx, glyph: null })
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
      this.running.push({
        ...p,
        y: chosen * this.laneH,
        idx,
        glyph: null,
      })
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
      this.running.push({
        ...p,
        y: chosen * this.laneH,
        idx,
        glyph: null,
      })
      return true
    }

    return false
  }

  private clearGlyphCache(): void {
    this.glyphCache.clear()
    for (const r of this.running) r.glyph = null
  }

  private glyphKeyOf(text: string, color: string): string {
    return `${this.fontPx}|${color}|${text}`
  }

  private getGlyph(text: string, color: string, textW: number): GlyphEntry {
    const key = this.glyphKeyOf(text, color)
    const hit = this.glyphCache.get(key)
    if (hit) {
      // refresh insertion order for simple LRU
      this.glyphCache.delete(key)
      this.glyphCache.set(key, hit)
      return hit
    }

    const pad = Math.max(GLYPH_PAD, Math.ceil(this.fontPx * 0.2))
    const lineW = Math.max(2, this.fontPx * 0.12)
    const bw = textW + pad * 2 + lineW * 2
    const bh = this.fontPx + pad * 2 + lineW * 2
    const g = makeOffscreen(bw * this.dpr, bh * this.dpr)
    const gctx = g.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
    if (!gctx) {
      // Fallback empty — paint path will stroke/fill
      const empty: GlyphEntry = {
        canvas: g,
        textW,
        bw,
        bh,
        ox: pad,
        oy: pad,
      }
      return empty
    }
    gctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    gctx.font = this.font
    gctx.textBaseline = 'top'
    gctx.lineWidth = lineW
    gctx.lineJoin = 'round'
    gctx.miterLimit = 2
    gctx.strokeStyle = 'rgba(0,0,0,0.85)'
    gctx.fillStyle = color || '#ffffff'
    const tx = pad + lineW
    const ty = pad + lineW * 0.5
    gctx.strokeText(text, tx, ty)
    gctx.fillText(text, tx, ty)

    const entry: GlyphEntry = {
      canvas: g,
      textW,
      bw,
      bh,
      ox: tx,
      oy: ty,
    }
    if (this.glyphCache.size >= GLYPH_CACHE_MAX) {
      // drop oldest
      const first = this.glyphCache.keys().next().value
      if (first !== undefined) this.glyphCache.delete(first)
    }
    this.glyphCache.set(key, entry)
    return entry
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
    const n = this.running.length
    if (!n) return

    ctx.save()
    ctx.globalAlpha = this._opacity
    // drawImage path — no per-frame font/stroke setup needed when glyphs hit

    const t = this.mediaTime()
    const W = cssW
    const laneMid = (this.laneH - this.fontPx) * 0.5

    for (let i = 0; i < n; i++) {
      const r = this.running[i]
      const age = t - r.time
      if (age < 0 || age >= r.duration) continue

      let x: number
      let y: number
      if (r.mode === 'rtl') {
        const path = W + r.width
        x = W - (age / r.duration) * path
        y = r.y + laneMid
      } else if (r.mode === 'top') {
        x = (W - r.width) * 0.5
        y = r.y + laneMid
      } else if (r.mode === 'bottom') {
        x = (W - r.width) * 0.5
        y = cssH - r.height - r.y + laneMid
      } else {
        continue
      }

      const entry = r.glyph || this.getGlyph(r.text, r.color, r.width)
      r.glyph = entry
      // drawImage ≪ strokeText+fillText under density (glyph built once)
      ctx.drawImage(
        entry.canvas as CanvasImageSource,
        x - entry.ox,
        y - entry.oy,
        entry.bw,
        entry.bh,
      )
    }

    ctx.restore()
  }
}
