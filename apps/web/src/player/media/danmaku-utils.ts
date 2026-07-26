import type { DanmakuComment, DanmakuSettings } from '@aniku/shared'

/**
 * Pixel speed helpers for canvas (and legacy) danmaku.
 * Canvas engine uses duration = (stageW + textW) / speed → constant visual px/s.
 */
export const BASE_DANMAKU_SPEED = 130

/**
 * Base size ~B 站默认 25px at a mid-size player; user fontSize is a multiplier.
 * Desktop scales with container width. Mobile is height-based with hard caps so
 * phone fullscreen (wide CSS width, short physical stage) does not blow up to
 * ~27px and blanket the frame.
 */
const DANMAKU_REF_WIDTH = 720
const DANMAKU_MIN_SCALE = 0.48 // ~12px @ default multiplier (desktop)
const DANMAKU_MAX_SCALE = 1.1
/** Matches canvas BILI_BASE_PX — scale is targetPx / this. */
const DANMAKU_BASE_PX = 25

export type DanmakuPointerMode = 'desktop' | 'mobile'

/** Layout context for font/speed — desktop keeps width curve; mobile is separate. */
export type DanmakuLayoutHints = {
  mode?: DanmakuPointerMode
  /** DOM / CSS / iOS video fullscreen */
  fullscreen?: boolean
  /** Stage CSS height; mobile sizes by height so landscape width does not inflate. */
  height?: number
}

type CompiledFilter =
  | { kind: 're'; re: RegExp }
  | { kind: 'sub'; text: string }

/** Compile keyword filters once per settings change (not per comment). */
function compileFilters(filters: string[] | undefined): CompiledFilter[] {
  const out: CompiledFilter[] = []
  if (!filters?.length) return out
  for (const rule of filters) {
    if (!rule) continue
    if (rule.startsWith('/') && rule.lastIndexOf('/') > 0) {
      try {
        const body = rule.slice(1, rule.lastIndexOf('/'))
        const flags = rule.slice(rule.lastIndexOf('/') + 1)
        out.push({ kind: 're', re: new RegExp(body, flags) })
      } catch {
        /* ignore bad regex */
      }
    } else {
      out.push({ kind: 'sub', text: rule })
    }
  }
  return out
}

export function filterComments(
  comments: DanmakuComment[],
  settings: DanmakuSettings,
): DanmakuComment[] {
  const compiled = compileFilters(settings.filters)
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
    for (const f of compiled) {
      if (f.kind === 're') {
        if (f.re.test(c.text)) return false
      } else if (c.text.includes(f.text)) {
        return false
      }
    }
    return true
  })
}

/**
 * Font scale relative to 25px base × user fontSize multiplier.
 * - desktop: width / 720, clamped [0.48, 1.1]
 * - mobile windowed: ~4.2% of stage height, clamped ~12–18px
 * - mobile fullscreen: ~3.2% of stage height, clamped ~11–14.5px (was ~27px on
 *   phone landscape because width≈844 hit the desktop max)
 */
export function danmakuFontScale(
  containerWidth: number,
  hints?: DanmakuLayoutHints,
): number {
  if (hints?.mode === 'mobile') {
    const w = containerWidth > 0 ? containerWidth : DANMAKU_REF_WIDTH
    const h =
      hints.height && hints.height > 0 ? hints.height : w * (9 / 16)
    // Height drives mobile size: landscape phones are wide but short.
    if (hints.fullscreen) {
      const targetPx = Math.min(14.5, Math.max(11, h * 0.032))
      return targetPx / DANMAKU_BASE_PX
    }
    const targetPx = Math.min(18, Math.max(12, h * 0.042))
    return targetPx / DANMAKU_BASE_PX
  }

  if (!(containerWidth > 0)) return 1
  return Math.min(
    DANMAKU_MAX_SCALE,
    Math.max(DANMAKU_MIN_SCALE, containerWidth / DANMAKU_REF_WIDTH),
  )
}

/** Coarse bucket for “did font scale meaningfully change?” checks. */
export function danmakuFontScaleBucket(
  containerWidth: number,
  hints?: DanmakuLayoutHints,
): number {
  const modeBit = hints?.mode === 'mobile' ? 1 : 0
  const fsBit = hints?.fullscreen ? 1 : 0
  return (
    Math.round(danmakuFontScale(containerWidth, hints) * 50) +
    modeBit * 1000 +
    fsBit * 2000
  )
}

/** Pixel speed for scroll comments; slower on narrow stages, × user multiplier. */
export function danmakuPixelSpeed(
  containerWidth: number,
  userSpeed: number,
  hints?: DanmakuLayoutHints,
): number {
  const mult = userSpeed > 0 ? userSpeed : 1
  const w = containerWidth > 0 ? containerWidth : DANMAKU_REF_WIDTH
  // Cap at 1: never faster than desktop base for the same user multiplier
  let scale = Math.min(1, Math.max(0.45, w / DANMAKU_REF_WIDTH))
  // Mobile fullscreen: slightly slower so dense text is readable at smaller size
  if (hints?.mode === 'mobile' && hints.fullscreen) {
    scale *= 0.88
  } else if (hints?.mode === 'mobile') {
    scale *= 0.94
  }
  return Math.max(40, BASE_DANMAKU_SPEED * scale * mult)
}
