import type { Comment as IronComment } from '@ironkinoko/danmaku'
import type { DanmakuComment, DanmakuSettings } from '@aniku/shared'

/**
 * ironkinoko `speed` is px/s; duration = stage.width / speed.
 * Fixed 130 makes ~10s on desktop and ~2.8s on a 360px phone — too fast on mobile.
 * Scale down only when narrower than DANMAKU_REF_WIDTH so desktop stay the same.
 */
export const BASE_DANMAKU_SPEED = 130

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

export function filterComments(
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

export function danmakuFontScale(containerWidth: number): number {
  if (!(containerWidth > 0)) return 1
  return Math.min(
    DANMAKU_MAX_SCALE,
    Math.max(DANMAKU_MIN_SCALE, containerWidth / DANMAKU_REF_WIDTH),
  )
}

/** Pixel speed for scroll comments; slower on narrow stages, × user multiplier. */
export function danmakuPixelSpeed(
  containerWidth: number,
  userSpeed: number,
): number {
  const mult = userSpeed > 0 ? userSpeed : 1
  const w = containerWidth > 0 ? containerWidth : DANMAKU_REF_WIDTH
  // Cap at 1: never faster than desktop base for the same user multiplier
  const scale = Math.min(1, Math.max(0.45, w / DANMAKU_REF_WIDTH))
  return Math.max(40, BASE_DANMAKU_SPEED * scale * mult)
}

export function toIronComments(
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
